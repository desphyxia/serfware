import * as THREE from "three/webgpu";
import { GOODS } from "../sim/econ/defs";
import type { Economy, Settler } from "../sim/econ/economy";
import { SurfaceFrames } from "./frames";
import type { Emitter } from "./smoke";
import { PAINT, PainterlyMaterial } from "./painterly";
import { SpriteBatch } from "./sprites";
import { mrt, output, vec4 } from "three/tsl";
import { playerColor } from "./players";
import { Anim, FigureBatch, Hat, Tool } from "./figures";
import {
  LANTERN_FLAME,
  WINDMILL_HUB,
  windmillRotor,
  buildingGeometry,
  constructionSite,
  goodGeometry,
  flagGeometry,
  pennantGeometry,
} from "./models";

export const GOOD_COLORS: Record<string, string> = {
  blade: "#c9d3de",
  bow: "#8a5a2b",
  mount: "#7a5236",
  log: "#9a6a42",
  stone: "#a9a59d",
  plank: "#e0b27a",
  grain: "#e2c46e",
  flour: "#f1e6cc",
  bread: "#d98f4e",
  fish: "#7fc4c8",
  livestock: "#f0c8b8",
  meat: "#b8574a",
  coal: "#2e2e34",
  ironore: "#a0583f",
  iron: "#8f96a3",
  goldore: "#c9a24a",
  gold: "#f0c85a",
};

const ROLE_COLORS = { carrier: new THREE.Color("#c98a4a"), builder: new THREE.Color("#4f7fb0"), worker: new THREE.Color("#6f9a4a"), geologist: new THREE.Color("#9a6fb0"), warden: new THREE.Color("#d8b25a"), attacker: new THREE.Color("#c0504a") };
const HIDDEN_STATES = new Set(["rest", "craft", "guard"]);
const MAX_SETTLERS = 4000;
const MAX_GOODS_EACH = 2500;

/** Roads, flags, buildings, goods and settlers drawn from the economy each frame. */
export class EconView {
  readonly group = new THREE.Group();
  private readonly frames: SurfaceFrames;
  private readonly buildingMat = new PainterlyMaterial({ vertexColors: true, flatShading: true, windows: true, brush: 0.8, snowy: true });
  /** Stranded buildings: greyed and dim, like something left behind. */
  private readonly strandedMat = new PainterlyMaterial({ vertexColors: true, flatShading: true, color: "#7d7a74", brush: 1.2 });
  private readonly buildings = new Map<number, { mesh: THREE.Mesh; key: string }>();
  private readonly flagPoles: THREE.InstancedMesh;
  private readonly pennants: THREE.InstancedMesh;
  private readonly figures = new FigureBatch(MAX_SETTLERS);
  private figureCount = 0;
  /** Goods miniatures, one instanced mesh per good type (on flags and carried). */
  private readonly goodMeshes: THREE.InstancedMesh[];
  private readonly goodCounts: number[];
  private structure = "";
  private readonly flames: THREE.InstancedMesh;
  private readonly halos = new SpriteBatch(1024, { additive: true, renderOrder: 9, glow: 1 });
  /** The player whose view this is: other players' things are hidden in the fog. */
  viewer = 0;
  /** Fog of war on or off (off in the debug view). */
  fog = true;
  private readonly display = new Map<number, THREE.Vector3>();
  /** Settler id drawn at each body instance, for picking. */
  readonly instanceSettler: number[] = [];
  /** Night factor 0..1 (shared with the painterly window glow). */
  readonly night = PAINT.night;
  private readonly emitterCache = new Map<string, Emitter>();
  private rotorGeo: THREE.BufferGeometry | null = null;

  constructor(
    private readonly eco: Economy,
    frames: SurfaceFrames,
  ) {
    this.frames = frames;
    const propMat = new PainterlyMaterial({ vertexColors: true, brush: 0.5 });
    const flagMat = new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: "#3a2410", brush: 0 });
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow = true) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      this.group.add(mesh);
      return mesh;
    };
    this.flagPoles = inst(flagGeometry(), propMat, 2000);
    this.pennants = inst(pennantGeometry(), flagMat, 2000, false);
    this.group.add(this.figures.mesh);
    const goodsMat = new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 0.3 });
    this.goodMeshes = GOODS.map((g) => inst(goodGeometry(g.id), goodsMat, MAX_GOODS_EACH));
    this.goodCounts = GOODS.map(() => 0);
    const flameMat = new THREE.MeshBasicNodeMaterial({ color: "#ffffff" });
    // Flames glow: they feed the emissive target for bloom.
    flameMat.mrtNode = mrt({ emissive: vec4(output.rgb.mul(1.2), 1) });
    this.flames = inst(new THREE.IcosahedronGeometry(0.1, 1), flameMat, 1024, false);
    this.flames.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3), 3);
    this.group.add(this.halos.mesh);
    this.group.name = "economy";
  }

  update(time: number, dt: number): void {
    this.spin(dt);
    const key = `${this.eco.structureVersion}:${this.fog ? this.eco.visionVersion : -1}:${this.viewer}`;
    if (key !== this.structure) {
      this.structure = key;
      this.rebuildFlags();
    }
    this.syncBuildings();
    this.updatePennants(time);
    this.updateFlames(time);
    this.updateGoods();
    this.updateSettlers(time, dt);
  }

  /** Whether the viewer can see something of `owner` at `t` (explored ground, or lit right now if `live`). */
  seen(t: number, owner: number, live = false): boolean {
    if (!this.fog || owner === this.viewer) return true;
    const arr = live ? this.eco.visible[this.viewer] : this.eco.explored[this.viewer];
    return !arr || arr[t] === 1;
  }

  /** Flames and soft halos over lit lanterns and each Hearthship, in the owner's colour. */
  private updateFlames(time: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const warm = new THREE.Color("#ffd9a0");
    const night = this.night.value;
    let n = 0;
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built || !b.lit || !b.def.light || n >= 1024) continue;
      const v = this.buildings.get(b.id);
      const at = LANTERN_FLAME[b.def.id];
      if (!v || !at) continue;
      v.mesh.updateMatrix();
      p.copy(at).applyMatrix4(v.mesh.matrix);
      const flicker = 0.9 + Math.sin(time * 7.1 + b.id * 1.7) * 0.06 + Math.sin(time * 13.3 + b.id) * 0.04;
      const big = b.def.id === "beacon" || b.def.id === "keep" ? 1.6 : b.def.id === "lamphouse" ? 1.2 : 1;
      c.copy(playerColor(b.owner)).lerp(warm, 0.45).multiplyScalar((1.4 + night * 1.6) * flicker);
      m.compose(p, q, s.setScalar(big * flicker));
      this.flames.setMatrixAt(n, m);
      this.flames.setColorAt(n, c);
      const h = this.halos;
      h.pos.set([p.x, p.y, p.z], n * 3);
      c.multiplyScalar(0.25 + night * 0.45);
      h.color.set([c.r, c.g, c.b], n * 3);
      h.size[n] = big * (0.55 + night * 0.6) * flicker;
      h.alpha[n] = 0.55 + night * 0.3;
      n++;
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
    this.halos.flush(n);
  }

  /** Windmill sails turn in the wind, faster while grinding. */
  private spin(dt: number): void {
    for (const [id, v] of this.buildings) {
      const rotor = v.mesh.getObjectByName("rotor");
      if (!rotor) continue;
      const b = this.eco.buildings[id];
      const busy = b && b.worker >= 0 && this.eco.settlers[b.worker]?.state === "craft";
      rotor.rotation.z -= dt * (busy ? 1.6 : 0.35);
    }
  }


  private rebuildFlags(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (const f of this.eco.flags) {
      if (!f.alive || n >= this.flagPoles.instanceMatrix.count || !this.seen(f.tile, f.owner)) continue;
      const p = this.frames.pos(f.tile);
      this.frames.orient(p, null, q);
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      this.flagPoles.setMatrixAt(n++, m);
    }
    this.flagPoles.count = n;
    this.flagPoles.instanceMatrix.needsUpdate = true;
  }

  private updatePennants(time: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const f of this.eco.flags) {
      if (!f.alive || n >= this.pennants.instanceMatrix.count || !this.seen(f.tile, f.owner)) continue;
      this.pennants.setColorAt(n, playerColor(f.owner));
      const p = this.frames.pos(f.tile);
      this.frames.orient(p, null, q);
      yaw.setFromAxisAngle(axis, 0.6 + Math.sin(time * 2.3 + f.id) * 0.35 + Math.sin(time * 5.1 + f.id * 3) * 0.08);
      q.multiply(yaw);
      m.compose(p, q, new THREE.Vector3(1, 1 + Math.sin(time * 3 + f.id) * 0.03, 1));
      this.pennants.setMatrixAt(n++, m);
    }
    this.pennants.count = n;
    this.pennants.instanceMatrix.needsUpdate = true;
    if (this.pennants.instanceColor) this.pennants.instanceColor.needsUpdate = true;
  }

  private syncBuildings(): void {
    const seen = new Set<number>();
    for (const b of this.eco.buildings) {
      if (!b.alive || !this.seen(b.tile, b.owner)) continue;
      seen.add(b.id);
      const stage = b.built ? "built" : `site${Math.min(4, Math.floor((b.consumed / Math.max(1, b.costTotal)) * 5))}`;
      const key = `${b.def.id}:${stage}:${b.stranded >= 0 ? "x" : ""}`;
      const cur = this.buildings.get(b.id);
      if (cur && cur.key === key) continue;
      if (cur) this.group.remove(cur.mesh);
      const geo = b.built ? buildingGeometry(b.def.id, b.id) : constructionSite(b.consumed / Math.max(1, b.costTotal));
      const mesh = new THREE.Mesh(geo, b.stranded >= 0 ? this.strandedMat : this.buildingMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const p = this.frames.pos(b.tile, -0.05);
      const flagPos = this.frames.pos((this.eco.flags[b.flag] as { tile: number }).tile);
      mesh.position.copy(p);
      this.frames.orient(p, flagPos, mesh.quaternion);
      mesh.userData.building = b.id;
      mesh.userData.site = !b.built;
      if (b.built && b.def.id === "mill") {
        this.rotorGeo ??= windmillRotor();
        const rotor = new THREE.Mesh(this.rotorGeo, this.buildingMat);
        rotor.position.copy(WINDMILL_HUB);
        rotor.name = "rotor";
        rotor.castShadow = true;
        mesh.add(rotor);
      }
      this.group.add(mesh);
      this.buildings.set(b.id, { mesh, key });
    }
    for (const [id, v] of this.buildings) {
      if (seen.has(id)) continue;
      this.group.remove(v.mesh);
      if (v.mesh.userData.site) v.mesh.geometry.dispose();
      this.buildings.delete(id);
    }
  }

  private addGood(type: number, m: THREE.Matrix4): void {
    const mesh = this.goodMeshes[type];
    const n = this.goodCounts[type] as number;
    if (!mesh || n >= MAX_GOODS_EACH) return;
    mesh.setMatrixAt(n, m);
    this.goodCounts[type] = n + 1;
  }

  /** Goods waiting at flags, set in a ring around the pole. Carried goods are added by `updateSettlers`. */
  private updateGoods(): void {
    this.goodCounts.fill(0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const Y = new THREE.Vector3(0, 1, 0);
    for (const f of this.eco.flags) {
      if (!f.alive || f.goods.length === 0 || !this.seen(f.tile, f.owner, true)) continue;
      const center = this.frames.pos(f.tile);
      const up = center.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      this.frames.orient(center, null, q);
      f.goods.forEach((gid, i) => {
        const g = this.eco.goods[gid];
        if (!g) return;
        const a = (i / 8) * Math.PI * 2;
        const p = center.clone().addScaledVector(tA, Math.cos(a) * 0.36).addScaledVector(tB, Math.sin(a) * 0.36);
        turn.setFromAxisAngle(Y, -a + ((gid * 0.37) % 0.6));
        m.compose(p, q.clone().multiply(turn), s);
        this.addGood(g.type, m);
      });
    }
  }

  private commitGoods(): void {
    this.goodMeshes.forEach((mesh, i) => {
      mesh.count = this.goodCounts[i] as number;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** Hat, tool and work motion for a settler. */
  private looks(s: Settler): { hat: Hat; tool: Tool; work: Anim } {
    switch (s.role) {
      case "carrier":
        return { hat: Hat.Cap, tool: Tool.None, work: Anim.Idle };
      case "builder":
        return { hat: Hat.Straw, tool: Tool.Hammer, work: Anim.Hammer };
      case "geologist":
        return { hat: Hat.Pointed, tool: Tool.Pick, work: Anim.Dig };
      case "warden":
      case "attacker":
        return { hat: Hat.Helmet, tool: Tool.Sword, work: Anim.Duel };
      default: {
        const b = s.building >= 0 ? this.eco.buildings[s.building] : undefined;
        switch (b?.def.id) {
          case "woodcutter":
            return { hat: Hat.Hood, tool: Tool.Axe, work: Anim.Chop };
          case "forester":
            return { hat: Hat.Hood, tool: Tool.Spade, work: Anim.Dig };
          case "quarry":
            return { hat: Hat.Cap, tool: Tool.Pick, work: Anim.Hammer };
          case "farm":
            return { hat: Hat.Straw, tool: Tool.Spade, work: Anim.Dig };
          case "coalmine":
          case "ironmine":
          case "goldmine":
          case "granitemine":
            return { hat: Hat.Helmet, tool: Tool.Pick, work: Anim.Hammer };
          default:
            return { hat: Hat.Hood, tool: Tool.None, work: Anim.Idle };
        }
      }
    }
  }

  private settlerTarget(s: Settler, out: THREE.Vector3): THREE.Vector3 {
    const a = s.path[s.pi] as number;
    const b = s.path[Math.min(s.pi + 1, s.path.length - 1)] as number;
    return this.frames.between(a, b, a === b ? 0 : s.prog / 1000, 0, out);
  }

  private updateSettlers(time: number, dt: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const target = new THREE.Vector3();
    const load = new THREE.Vector3();
    const k = 1 - Math.exp(-dt * 12);
    let n = 0;
    const alive = new Set<number>();
    for (const s of this.eco.settlers) {
      if (!s.alive) continue;
      alive.add(s.id);
      this.settlerTarget(s, target);
      let d = this.display.get(s.id);
      if (!d) {
        d = target.clone();
        this.display.set(s.id, d);
      }
      const moving = d.distanceToSquared(target) > 1e-6;
      const heading = target.clone().sub(d);
      if (heading.lengthSq() < 1e-8) {
        const nt = s.path[Math.min(s.pi + 1, s.path.length - 1)] as number;
        heading.copy(this.frames.pos(nt)).sub(d);
      }
      d.lerp(target, k);
      if (HIDDEN_STATES.has(s.state) || n >= MAX_SETTLERS || !this.seen(s.path[s.pi] as number, s.owner, true)) continue;
      const look = this.looks(s);
      const carrying = s.carrying >= 0;
      const anim = s.state === "duel" ? Anim.Duel : moving ? (carrying ? Anim.Carry : Anim.Walk) : s.state === "work" ? look.work : Anim.Idle;
      const bob = moving ? Math.abs(Math.sin(time * 11 + s.id * 1.7)) * 0.025 : 0;
      const p = d.clone().addScaledVector(d.clone().normalize(), bob);
      this.frames.orient(p, p.clone().add(heading), q);
      const colour = s.role === "warden" || s.role === "attacker" ? playerColor(s.owner) : ROLE_COLORS[s.role];
      this.figures.set(n, p, q, colour, anim, (s.id * 0.618) % 1 * 10, look.hat, anim === Anim.Carry ? Tool.None : look.tool);
      this.instanceSettler[n] = s.id;
      n++;
      if (carrying) {
        // Held over the head in the raised right hand.
        load.set(0.05, 0.6, 0.03).applyQuaternion(q).add(p);
        m.compose(load, q, one);
        this.addGood(s.carrying, m);
      }
    }
    for (const id of this.display.keys()) if (!alive.has(id)) this.display.delete(id);
    this.figureCount = n;
    this.figures.flush(n, time);
    this.commitGoods();
  }

  /** Settler under a ray, or -1. */
  pickSettler(ray: THREE.Raycaster, reach = 0.45): number {
    // Settlers are small, so pick the visible one closest to the ray rather than needing an exact hit.
    let best = -1;
    let bestD = reach * reach;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.figureCount; i++) {
      const id = this.instanceSettler[i] as number;
      const d = this.display.get(id);
      if (!d) continue;
      p.copy(d).addScaledVector(d, 0.3 / d.length());
      if (ray.ray.direction.dot(p.clone().sub(ray.ray.origin)) < 0) continue;
      const dist = ray.ray.distanceSqToPoint(p);
      if (dist < bestD) {
        bestD = dist;
        best = id;
      }
    }
    return best;
  }

  /** Smoothed display position of a settler. */
  settlerPosition(id: number): THREE.Vector3 | null {
    return this.display.get(id) ?? null;
  }

  /** Chimney smoke, sawmill steam and dust where settlers work. */
  emitters(): Emitter[] {
    const out: Emitter[] = [];
    const get = (key: string, kind: Emitter["kind"], rate: number) => {
      let e = this.emitterCache.get(key);
      if (!e) {
        e = { pos: new THREE.Vector3(), rate, kind };
        this.emitterCache.set(key, e);
      }
      e.rate = rate;
      out.push(e);
      return e;
    };
    const CHIMNEYS: Record<string, [number, number, number]> = {
      keep: [-0.25, 3.15, -0.95],
      house: [0.33, 1.38, -0.19],
      woodcutter: [0.39, 1.42, -0.2],
      forester: [0.33, 1.5, -0.2],
      farm: [-0.45, 1.72, 0.1],
      bakery: [0.95, 0.95, -0.3],
      butcher: [0.33, 1.4, -0.2],
      fisher: [0.3, 1.3, -0.18],
      toolsmith: [0.39, 1.5, -0.2],
      smelter: [0.65, 2.7, -0.1],
      goldsmith: [0.65, 2.7, -0.1],
    };
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built) continue;
      const mesh = this.buildings.get(b.id)?.mesh;
      if (!mesh) continue;
      const c = CHIMNEYS[b.def.id];
      const occupied = b.def.storage || b.worker >= 0 || (b.def.id === "house" && this.eco.people.some((p) => p.alive && p.house === b.id));
      if (c && occupied) get(`c${b.id}`, "smoke", b.def.storage ? 3 : 1.6).pos.set(...c).applyMatrix4(mesh.matrixWorld);
      if (b.def.id === "sawmill" && b.worker >= 0 && this.eco.settlers[b.worker]?.state === "craft")
        get(`s${b.id}`, "steam", 5).pos.set(0.95, 0.8, 0.3).applyMatrix4(mesh.matrixWorld);
    }
    // Duels at the door: dust and sparks.
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.duel || !this.seen(b.tile, b.owner, true)) continue;
      const f = this.eco.flags[b.flag];
      if (!f) continue;
      const p = this.frames.pos(f.tile, 0.35);
      get(`dd${b.id}`, "dust", 5).pos.copy(p);
      get(`dx${b.id}`, "spark", 14).pos.copy(p);
    }
    for (const s of this.eco.settlers) {
      if (!s.alive || s.state !== "work") continue;
      const d = this.display.get(s.id);
      if (d) get(`w${s.id}`, "dust", s.role === "builder" ? 2 : 3).pos.copy(d);
    }
    if (this.emitterCache.size > out.length * 3 + 50) {
      const keep = new Set(out);
      for (const [k, e] of this.emitterCache) if (!keep.has(e)) this.emitterCache.delete(k);
    }
    return out;
  }

  dispose(): void {
    for (const v of this.buildings.values()) if (v.mesh.userData.site) v.mesh.geometry.dispose();
    for (const mesh of [this.flagPoles, this.pennants, ...this.goodMeshes]) mesh.dispose();
    this.figures.mesh.geometry.dispose();
  }
}
