import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import { SurfaceFrames } from "./frames";
import { hiddenAt, type FogMask } from "./fogMask";
import { PainterlyMaterial } from "./painterly";
import type { RiverView } from "./rivers";
import type { Emitter } from "./smoke";
import { ROAD_HALF } from "./terrain/field";
import * as kit from "./kit";
import { rowboatGeometry } from "./models";
import { Region } from "../sim/biomes/regions";

/** Causeway deck colours across the ribbon: kerb, setts, crown, setts, kerb. */
const STONE = [
  [0.52, 0.5, 0.46],
  [0.7, 0.66, 0.6],
  [0.62, 0.59, 0.54],
  [0.74, 0.7, 0.63],
  [0.62, 0.59, 0.54],
  [0.7, 0.66, 0.6],
  [0.52, 0.5, 0.46],
];

/** A causeway pier: a squat six-sided stack of dressed stone from the flats up to the deck. */
function causewayPadGeometry(): THREE.BufferGeometry {
  return kit.assemble([
    [new THREE.CylinderGeometry(0.42, 0.5, 0.6, 6).translate(0, -0.3, 0), "#7c766d"],
    [new THREE.CylinderGeometry(0.46, 0.46, 0.06, 6).translate(0, -0.02, 0), "#9a948a"],
  ]);
}

/** How long an eruption keeps throwing ash and embers, in seconds of real time. */
const ERUPTION_SECONDS = 30;

/**
 * The frontier regions' moving parts: lake ice (with the ice roads drawn on it, since the ground
 * material cannot reach under the lake), steam from the Emberglass vents, and the ash column
 * and embers of an eruption.
 */
export class FrontierView {
  readonly group = new THREE.Group();
  private readonly roadMat = new PainterlyMaterial({ vertexColors: true, brush: 0.4, side: THREE.DoubleSide });
  private readonly stoneMat = new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 0.5 });
  /** Causeway piers under each causeway tile, and boats moored by the waterside trades. */
  private readonly pads: THREE.InstancedMesh;
  private readonly boats: THREE.InstancedMesh;
  private roads: THREE.Mesh | null = null;
  private roadKey = "";
  private iceVersion = -1;
  private readonly emitters = new Map<string, Emitter>();
  private readonly seen = new Map<number, number>();
  /** Vent tile -> seconds of eruption left. */
  private readonly erupting = new Map<number, number>();

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
    private readonly rivers: RiverView,
    private readonly mask: FogMask,
  ) {
    const land = eco.land;
    frames.ice = { frozen: land.frozen, lake: land.hydro.lake, level: land.hydro.lakeLevel };
    frames.causeway = land.causeway;
    this.pads = new THREE.InstancedMesh(causewayPadGeometry(), this.stoneMat, 512);
    this.pads.count = 0;
    this.pads.castShadow = true;
    this.pads.receiveShadow = true;
    this.pads.frustumCulled = false;
    this.boats = new THREE.InstancedMesh(rowboatGeometry(), this.stoneMat, 128);
    this.boats.count = 0;
    this.boats.castShadow = true;
    this.boats.frustumCulled = false;
    this.group.add(this.pads, this.boats);
    this.roadMat.polygonOffset = true;
    this.roadMat.polygonOffsetFactor = -2;
    this.roadMat.polygonOffsetUnits = -4;
    this.group.name = "frontier";
  }

  /** Follow the ice, tides and vents; returns the particle emitters for steam, eruptions and storms. */
  update(dt: number, focus: THREE.Vector3, closeness: number, time = 0, tideLift = 0): Emitter[] {
    const land = this.eco.land;
    this.updateBoats(time, tideLift);
    if (land.iceVersion !== this.iceVersion) {
      this.iceVersion = land.iceVersion;
      this.rivers.setIce(land.frozen);
      this.frames.invalidate();
    }
    const key = `${this.eco.structureVersion}:${land.iceVersion}:${land.causewayVersion}`;
    if (key !== this.roadKey) {
      this.roadKey = key;
      this.buildIceRoads();
    }
    const out: Emitter[] = [];
    // Sandstorms: dust whirling over the storm's reach, near the view.
    for (const st of this.eco.storms) {
      if (this.far(st.tile, focus, 80)) continue;
      const ring = land.ring(st.tile, 3);
      for (let i = 0; i < 18; i++) {
        const t = ring[(i * 7 + st.tile) % ring.length] as number;
        out.push(this.emitter(`d${st.tile}:${i}`, "sand", 14, this.frames.pos(t, 0.4 + (i % 3) * 0.6)));
      }
    }
    for (const t of this.eco.vents()) {
      const p = land.amount[t] as number;
      const at = this.eco.eruptedAt.get(t) ?? -1;
      if (at !== (this.seen.get(t) ?? -1)) {
        this.seen.set(t, at);
        // Only a fresh eruption (not one from before this view was made) throws a column.
        if (this.eco.tick - at < 300) this.erupting.set(t, ERUPTION_SECONDS);
      }
      if (hiddenAt(this.mask, t)) continue;
      const base = this.frames.pos(t);
      const left = this.erupting.get(t) ?? 0;
      if (left > 0) {
        this.erupting.set(t, left - dt);
        const k = Math.min(1, left / 8);
        const up = base.clone().normalize();
        out.push(this.emitter(`a${t}`, "soot", 40 * k, base.clone().addScaledVector(up, 0.6)));
        out.push(this.emitter(`e${t}`, "ember", 30 * k, base.clone().addScaledVector(up, 0.4)));
        out.push(this.emitter(`k${t}`, "spark", 12 * k, base.clone().addScaledVector(up, 0.3)));
        continue;
      }
      // Steam, heavier as pressure builds; only near the view.
      if (closeness < 0.2 || this.far(t, focus, 60)) continue;
      out.push(this.emitter(`s${t}`, "steam", 1.5 + (p / 255) * 6, base.clone().addScaledVector(base.clone().normalize(), 0.3)));
    }
    return out;
  }

  /** More than `reach` world units from the view's focus (a unit direction). */
  private far(t: number, focus: THREE.Vector3, reach: number): boolean {
    const r = reach / this.frames.field.R;
    return this.frames.dir(t).distanceToSquared(focus) > r * r;
  }

  private emitter(key: string, kind: Emitter["kind"], rate: number, pos: THREE.Vector3): Emitter {
    let e = this.emitters.get(key);
    if (!e) {
      e = { pos: new THREE.Vector3(), rate, kind };
      this.emitters.set(key, e);
    }
    e.rate = rate;
    e.kind = kind;
    e.pos.copy(pos);
    return e;
  }

  /**
   * Ice roads: packed snow on the ice, two dark runner tracks and a brushed shoulder, laid as
   * ribbons between tile centres wherever a road touches a frozen lake.
   */
  private buildIceRoads(): void {
    if (this.roads) {
      this.group.remove(this.roads);
      this.roads.geometry.dispose();
      this.roads = null;
    }
    const land = this.eco.land;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    // Across the ribbon: shoulder, track, centre, track, shoulder.
    // Shoulders fade into the ice colour so the ribbon has no hard edge.
    const across = [-1.2, -0.62, -0.42, 0, 0.42, 0.62, 1.2];
    const shade = [
      [0.66, 0.8, 0.86],
      [0.9, 0.92, 0.95],
      [0.5, 0.55, 0.62],
      [0.88, 0.9, 0.93],
      [0.5, 0.55, 0.62],
      [0.9, 0.92, 0.95],
      [0.66, 0.8, 0.86],
    ];
    const a3 = new THREE.Vector3();
    const side = new THREE.Vector3();
    const STEPS = 6;
    for (const r of this.eco.roads) {
      if (!r.alive) continue;
      for (let i = 0; i < r.tiles.length - 1; i++) {
        const a = r.tiles[i] as number;
        const b = r.tiles[i + 1] as number;
        const special = (x: number) => land.isIce(x) || land.causeway[x] === 1;
        if (!special(a) && !special(b)) continue;
        const stone = land.causeway[a] === 1 || land.causeway[b] === 1;
        const pa = this.frames.pos(a);
        const pb = this.frames.pos(b);
        const along = pb.clone().sub(pa);
        for (let k = 0; k <= STEPS; k++) {
          const f = k / STEPS;
          // Only the stretch over the ice: the ground material paints the rest.
          this.frames.between(a, b, f, 0.015, a3);
          const up = a3.clone().normalize();
          side.copy(along).cross(up).normalize().multiplyScalar(ROAD_HALF);
          const onIce = f < 0.5 ? special(a) : special(b);
          for (let j = 0; j < across.length; j++) {
            const w = across[j] as number;
            const p = a3.clone().addScaledVector(side, w);
            pos.push(p.x, p.y, p.z);
            const c = (stone ? STONE : shade)[j] as number[];
            const n = 0.94 + SurfaceFrames.hash(a * 31 + k, j) * 0.08;
            col.push((c[0] as number) * n, (c[1] as number) * n, (c[2] as number) * n);
          }
          if (k > 0 && onIce) {
            const row = pos.length / 3 - across.length;
            const prev = row - across.length;
            for (let j = 0; j < across.length - 1; j++) idx.push(prev + j, row + j, prev + j + 1, prev + j + 1, row + j, row + j + 1);
          }
        }
      }
    }
    // Causeway piers.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let np = 0;
    for (let t = 0; t < land.causeway.length && np < this.pads.instanceMatrix.count; t++) {
      if (!land.causeway[t]) continue;
      const p = this.frames.pos(t);
      this.frames.orient(p, null, q);
      m.compose(p, q, one);
      this.pads.setMatrixAt(np++, m);
    }
    this.pads.count = np;
    this.pads.instanceMatrix.needsUpdate = true;
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.roads = new THREE.Mesh(g, this.roadMat);
    this.roads.receiveShadow = true;
    this.roads.frustumCulled = false;
    this.roads.renderOrder = 2;
    this.group.add(this.roads);
  }

  /** Boats moored by the shellfisher, fisher and tide mill ride the tide. */
  private updateBoats(time: number, tideLift: number): void {
    const land = this.eco.land;
    const grid = land.planet.grid;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let n = 0;
    for (const b of this.eco.buildings) {
      if (n >= this.boats.instanceMatrix.count) break;
      if (!b.alive || !b.built || !(b.def.id === "shellfisher" || b.def.id === "fisher" || b.def.id === "tidemill")) continue;
      if (hiddenAt(this.mask, b.tile)) continue;
      const water = grid.neighborsOf(b.tile).find((x) => !land.isLand(x)) ?? land.ring(b.tile, 2).find((x) => !land.isLand(x));
      if (water === undefined) continue;
      // Halfway between the shore and the water tile, on the sea (lifted by the tide near the flats).
      const d = this.frames.dir(b.tile).lerp(this.frames.dir(water), 0.7).normalize();
      const tidal = land.region[b.tile] === Region.TidewaterReach ? tideLift : 0;
      const bob = Math.sin(time * 1.3 + b.id) * 0.03;
      p.copy(d).multiplyScalar(Math.max(this.frames.field.R + tidal, this.frames.groundAt(d)) + 0.02 + bob);
      this.frames.orient(p, this.frames.pos(b.tile), q);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + Math.sin(time * 0.4 + b.id) * 0.15));
      m.compose(p, q, one);
      this.boats.setMatrixAt(n++, m);
    }
    this.boats.count = n;
    this.boats.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.roads?.geometry.dispose();
    this.roadMat.dispose();
    this.stoneMat.dispose();
    this.pads.geometry.dispose();
    this.boats.geometry.dispose();
  }
}
