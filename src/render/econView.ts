import * as THREE from "three";
import { GOODS } from "../sim/econ/defs";
import type { Economy, Settler } from "../sim/econ/economy";
import { SurfaceFrames } from "./frames";
import { patchWindows, type Emitter } from "./smoke";
import { playerColor } from "./players";
import {
  LANTERN_FLAME,
  WINDMILL_HUB,
  windmillRotor,
  buildingGeometry,
  constructionSite,
  crateGeometry,
  flagGeometry,
  pennantGeometry,
  settlerBodyGeometry,
  settlerHeadGeometry,
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
const MAX_GOODS = 6000;

/** Roads, flags, buildings, goods and settlers drawn from the economy each frame. */
export class EconView {
  readonly group = new THREE.Group();
  private readonly frames: SurfaceFrames;
  private roadMesh: THREE.Mesh | null = null;
  private readonly roadMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -6,
  });
  private readonly buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  /** Stranded buildings: greyed and dim, like something left behind. */
  private readonly strandedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, color: "#7d7a74" });
  private readonly buildings = new Map<number, { mesh: THREE.Mesh; key: string }>();
  private readonly flagPoles: THREE.InstancedMesh;
  private readonly pennants: THREE.InstancedMesh;
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly carried: THREE.InstancedMesh;
  private readonly crates: THREE.InstancedMesh;
  private structure = "";
  private readonly flames: THREE.InstancedMesh;
  private readonly halos: THREE.InstancedMesh;
  /** The player whose view this is: other players' things are hidden in the fog. */
  viewer = 0;
  /** Fog of war on or off (off in the debug view). */
  fog = true;
  private readonly display = new Map<number, THREE.Vector3>();
  /** Settler id drawn at each body instance, for picking. */
  readonly instanceSettler: number[] = [];
  private readonly goodColors: THREE.Color[];
  readonly night = { value: 0 };
  private readonly emitterCache = new Map<string, Emitter>();
  private rotorGeo: THREE.BufferGeometry | null = null;

  constructor(
    private readonly eco: Economy,
    frames: SurfaceFrames,
  ) {
    this.frames = frames;
    patchWindows(this.buildingMat, this.night);
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide, emissive: "#3a2410" });
    const plain = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 });
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
    this.bodies = inst(settlerBodyGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), MAX_SETTLERS);
    this.heads = inst(settlerHeadGeometry(), propMat, MAX_SETTLERS);
    this.carried = inst(crateGeometry(), plain, MAX_SETTLERS);
    this.crates = inst(crateGeometry(), plain, MAX_GOODS);
    this.flames = inst(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), 1024, false);
    this.halos = inst(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            vUv = uv;
            #ifdef USE_INSTANCING_COLOR
              vCol = instanceColor;
            #else
              vCol = vec3(1.0);
            #endif
            // Billboard: keep the instance position, face the camera.
            vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float sc = length(instanceMatrix[0].xyz);
            c.xy += position.xy * sc;
            gl_Position = projectionMatrix * c;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = pow(max(0.0, 1.0 - d), 2.2);
            gl_FragColor = vec4(vCol * a, a);
          }`,
      }),
      1024,
      false,
    );
    this.halos.renderOrder = 9;
    for (const mesh of [this.flames, this.halos]) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3), 3);
    this.goodColors = GOODS.map((g) => new THREE.Color(GOOD_COLORS[g.id] ?? (g.tool ? "#9aa1b3" : "#ffffff")));
    this.group.name = "economy";
  }

  update(time: number, dt: number): void {
    this.spin(dt);
    const key = `${this.eco.structureVersion}:${this.fog ? this.eco.visionVersion : -1}:${this.viewer}`;
    if (key !== this.structure) {
      this.structure = key;
      this.rebuildRoads();
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
      m.compose(p, q, s.setScalar(big * (1.3 + night * 1.6) * flicker));
      this.halos.setMatrixAt(n, m);
      this.halos.setColorAt(n, c.multiplyScalar(0.25 + night * 0.45));
      n++;
    }
    for (const mesh of [this.flames, this.halos]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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

  private rebuildRoads(): void {
    if (this.roadMesh) {
      this.group.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
    }
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const edge = new THREE.Color("#8f7654");
    const mid = new THREE.Color("#c7ab80");
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (const road of this.eco.roads) {
      if (!road.alive || !this.seen(road.tiles[1] ?? road.tiles[0] as number, road.owner)) continue;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < road.tiles.length - 1; i++) {
        const a = road.tiles[i] as number;
        const b = road.tiles[i + 1] as number;
        for (let k = 0; k < 6; k++) pts.push(this.frames.between(a, b, k / 6, 0.22, new THREE.Vector3()));
      }
      pts.push(this.frames.pos(road.tiles[road.tiles.length - 1] as number, 0.22));
      const base = pos.length / 3;
      pts.forEach((pt, i) => {
        const prev = pts[Math.max(0, i - 1)] as THREE.Vector3;
        const next = pts[Math.min(pts.length - 1, i + 1)] as THREE.Vector3;
        p.copy(next).sub(prev).normalize();
        const up = q.copy(pt).normalize();
        const side = new THREE.Vector3().crossVectors(p, up).normalize().multiplyScalar(0.36);
        const l = pt.clone().add(side);
        const r = pt.clone().sub(side);
        pos.push(l.x, l.y, l.z, pt.x, pt.y + 0, pt.z, r.x, r.y, r.z);
        col.push(edge.r, edge.g, edge.b, mid.r, mid.g, mid.b, edge.r, edge.g, edge.b);
        if (i > 0) {
          const o = base + (i - 1) * 3;
          const n = base + i * 3;
          idx.push(o, n, o + 1, o + 1, n, n + 1, o + 1, n + 1, o + 2, o + 2, n + 1, n + 2);
        }
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(g, this.roadMat);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.renderOrder = 1;
    this.group.add(this.roadMesh);
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
      const geo = b.built ? buildingGeometry(b.def.id) : constructionSite(b.consumed / Math.max(1, b.costTotal));
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

  private updateGoods(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
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
        if (n >= MAX_GOODS) return;
        const g = this.eco.goods[gid];
        if (!g) return;
        const a = (i / 8) * Math.PI * 2;
        const p = center.clone().addScaledVector(tA, Math.cos(a) * 0.42).addScaledVector(tB, Math.sin(a) * 0.42);
        m.compose(p, q, s);
        this.crates.setMatrixAt(n, m);
        this.crates.setColorAt(n, this.goodColors[g.type] as THREE.Color);
        n++;
      });
    }
    this.crates.count = n;
    this.crates.instanceMatrix.needsUpdate = true;
    if (this.crates.instanceColor) this.crates.instanceColor.needsUpdate = true;
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
    const k = 1 - Math.exp(-dt * 12);
    let n = 0;
    let c = 0;
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
      const working = s.state === "work" || s.state === "duel";
      const bob = moving ? Math.abs(Math.sin(time * 13 + s.id)) * 0.05 : working ? Math.abs(Math.sin(time * 6 + s.id)) * 0.06 : 0;
      const p = d.clone().addScaledVector(d.clone().normalize(), bob);
      this.frames.orient(p, p.clone().add(heading), q);
      m.compose(p, q, one);
      this.bodies.setMatrixAt(n, m);
      this.bodies.setColorAt(n, ROLE_COLORS[s.role]);
      this.instanceSettler[n] = s.id;
      this.heads.setMatrixAt(n, m);
      n++;
      if (s.carrying >= 0 && c < MAX_SETTLERS) {
        const up = p.clone().normalize();
        m.compose(p.clone().addScaledVector(up, 0.56), q, one);
        this.carried.setMatrixAt(c, m);
        this.carried.setColorAt(c, this.goodColors[s.carrying] as THREE.Color);
        c++;
      }
    }
    for (const id of this.display.keys()) if (!alive.has(id)) this.display.delete(id);
    this.bodies.count = n;
    this.heads.count = n;
    this.carried.count = c;
    for (const mesh of [this.bodies, this.heads, this.carried]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Settler under a ray, or -1. */
  pickSettler(ray: THREE.Raycaster, reach = 0.45): number {
    // Settlers are small, so pick the visible one closest to the ray rather than needing an exact hit.
    let best = -1;
    let bestD = reach * reach;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.bodies.count; i++) {
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
    this.roadMesh?.geometry.dispose();
    for (const v of this.buildings.values()) if (v.mesh.userData.site) v.mesh.geometry.dispose();
    for (const mesh of [this.flagPoles, this.pennants, this.bodies, this.heads, this.carried, this.crates]) mesh.dispose();
  }
}
