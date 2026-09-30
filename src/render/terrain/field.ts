import * as THREE from "three/webgpu";
import type { LandUse } from "../../sim/econ/landuse";
import type { Planet } from "../../sim/planet/planet";
import { Biome } from "../../sim/planet/terrain";
import { Noise3 } from "../noise";
import { biomeColor, tileHash } from "../palette";
import { Region } from "../../sim/biomes/regions";

const CANOPY_FLOOR = new THREE.Color("#2c3a22");
/** Rimefall: lichen and frost-bitten moss, blue-grey. Emberglass: rust and ochre, iron-rich. */
const RIME_GROUND = new THREE.Color("#8a9690");
const EMBER_GROUND = new THREE.Color("#9a6a3c");
/** Saltglass: salt crust over pale clay, near white with a rose cast. */
const SALT_GROUND = new THREE.Color("#e9e1d8");

/** A levelled patch of ground under a building or flag. */
export interface Pad {
  tile: number;
  /** Angular radius of the flat area. */
  radius: number;
}

/** Half-width of a road's surface, in world units. */
export const ROAD_HALF = 0.34;

/** A point on a smoothed river course. */
export interface RiverPoint {
  /** Unit direction. */
  d: THREE.Vector3;
  /** Tile nearest the point. */
  tile: number;
  /** Bed half-width (tile spacings) and depth (world units). */
  width: number;
  depth: number;
  /** In the sea or a lake (the river's mouth). */
  wet: boolean;
}

export interface FieldSample {
  /** Height above the planet radius (world units). */
  h: number;
  /** Tile the point belongs to. */
  tile: number;
}

/**
 * The detailed ground everything stands on. Gameplay stays on hex tiles; this field turns tile
 * heights into a continuous, sculpted surface:
 *
 * - tile heights are blended with a smooth kernel over the nearest tile and its neighbours
 *   (the kernel radius is chosen so no tile outside that set ever contributes, so the surface is
 *   continuous everywhere);
 * - seeded noise adds rolling ground in the lowlands and ridged rock in the mountains;
 * - riverbeds are carved along the simulation's rivers, lake basins sit under the lake surface;
 * - pads level the ground under buildings and flags.
 *
 * Everything placed on the ground (buildings, settlers, roads, trees, goods) samples this field,
 * so nothing floats or sinks.
 */
export class TerrainField {
  readonly R: number;
  /** Chord distance between neighbouring tile centres (on the unit sphere). */
  readonly spacing: number;
  private readonly noise: Noise3;
  private readonly ridge: Noise3;
  private readonly kernel2: number;
  private readonly peak: number;
  private readonly baseH: Float32Array;
  private readonly tileCol: THREE.Color[];
  private pads = new Map<number, number>();
  /** Road edges (tile pairs) by tile, stored under both ends. */
  private roadEdges = new Map<number, [number, number][]>();
  /** Smoothed river courses, shared by the carved bed and the water surface. */
  readonly rivers: RiverPoint[][] = [];
  /** River segments: ax, ay, az, bx, by, bz, width, depth per segment. */
  private riverSeg: Float32Array = new Float32Array(0);
  private readonly tileRiverSegs = new Map<number, number[]>();
  /** Bumped when pads change; chunks near changed pads rebuild. */
  padVersion = 0;
  private hint = 0;

  constructor(
    readonly planet: Planet,
    readonly land: LandUse,
    seed: number,
  ) {
    const { grid, terrain } = planet;
    this.R = planet.params.radius;
    this.spacing = land.spacing;
    this.noise = new Noise3(seed ^ 0x51f3);
    this.ridge = new Noise3(seed ^ 0x2a77);
    const k = this.spacing * 1.1;
    this.kernel2 = k * k;
    this.peak = terrain.params.mountainHeight;
    // Per-tile heights used by the kernel: lakes sit in basins under their water surface.
    this.baseH = new Float32Array(grid.count);
    for (let t = 0; t < grid.count; t++) {
      const e = terrain.elevation[t] as number;
      this.baseH[t] = land.hydro.lake[t] ? (land.hydro.lakeLevel[t] as number) - 0.7 : e;
    }
    this.buildRivers();
    this.tileCol = [];
    const wet = (t: number) => !land.isLand(t) || land.hydro.lake[t] === 1;
    for (let t = 0; t < grid.count; t++) {
      let b = terrain.biome[t] as Biome;
      // Sand only where the water is: inland "beach" tiles are dry meadow.
      if (b === Biome.Beach && !wet(t) && !grid.neighborsOf(t).some(wet)) b = Biome.Steppe;
      const c = biomeColor(b, tileHash(t), new THREE.Color());
      if (b === Biome.Steppe && (terrain.biome[t] as Biome) === Biome.Beach) c.lerp(biomeColor(Biome.Meadow, tileHash(t), new THREE.Color()), 0.45);
      c.offsetHSL(0, 0, (0.5 - (terrain.moisture[t] as number)) * 0.05);
      // Canopy Deeps: the floor under the giants is dark, mossy and damp.
      if (land.region[t] === Region.CanopyDeeps) c.lerp(CANOPY_FLOOR, 0.6).offsetHSL(0, 0, (tileHash(t) - 0.5) * 0.04);
      else if (land.region[t] === Region.RimefallTundra && b !== Biome.Snow) c.lerp(RIME_GROUND, 0.35).offsetHSL(0, 0, (tileHash(t) - 0.5) * 0.05);
      else if (land.region[t] === Region.EmberglassSteppe) c.lerp(EMBER_GROUND, 0.3 + tileHash(t) * 0.15);
      else if (land.region[t] === Region.SaltglassFlats) c.lerp(SALT_GROUND, 0.55 + tileHash(t) * 0.2);
      this.tileCol.push(c);
    }
  }

  /**
   * River courses from each source (a river tile nothing flows into) down to the sea, a lake or
   * the river it joins; smoothed once (Chaikin) and sampled finely. The bed is carved along these
   * exact points, and the water surface is drawn on them.
   */
  private buildRivers(): void {
    const land = this.land;
    const { hydro } = land;
    const { grid } = this.planet;
    const n = grid.count;
    const fed = new Uint8Array(n);
    for (let t = 0; t < n; t++) if (land.isRiver(t) && (hydro.flowTo[t] as number) >= 0) fed[hydro.flowTo[t] as number] = 1;
    const used = new Uint8Array(n);
    const courses: number[][] = [];
    for (let t = 0; t < n; t++) {
      if (!land.isRiver(t) || fed[t]) continue;
      const course = [t];
      let c = t;
      used[c] = 1;
      for (;;) {
        const to = hydro.flowTo[c] as number;
        if (to < 0) break;
        course.push(to);
        if (!land.isRiver(to) || used[to]) break;
        used[to] = 1;
        c = to;
      }
      if (course.length > 1) courses.push(course);
    }
    for (let t = 0; t < n; t++) if (land.isRiver(t) && !used[t] && (hydro.flowTo[t] as number) >= 0) courses.push([t, hydro.flowTo[t] as number]);
    const dir = (t: number) => new THREE.Vector3(...grid.centerOf(t));
    const segs: number[] = [];
    let hint = 0;
    for (const course of courses) {
      let ctrl = course.map((t) => ({ d: dir(t), t }));
      // Two rounds of corner cutting: bends get a radius wider than the river.
      for (let round = 0; round < 2; round++) {
        const sm: typeof ctrl = [ctrl[0]!];
        for (let i = 0; i < ctrl.length - 1; i++) {
          const a = ctrl[i]!;
          const b = ctrl[i + 1]!;
          if (i > 0) sm.push({ d: a.d.clone().lerp(b.d, 0.25).normalize(), t: a.t });
          if (i < ctrl.length - 2) sm.push({ d: a.d.clone().lerp(b.d, 0.75).normalize(), t: b.t });
        }
        sm.push(ctrl[ctrl.length - 1]!);
        ctrl = sm;
      }
      const pts: RiverPoint[] = [];
      const lastRiver = course.filter((t) => land.isRiver(t)).pop() ?? course[0]!;
      for (let i = 0; i < ctrl.length; i++) {
        const a = ctrl[i]!;
        const b = ctrl[Math.min(i + 1, ctrl.length - 1)]!;
        const steps = i === ctrl.length - 1 ? 1 : 2;
        for (let k = 0; k < steps; k++) {
          const d = a.d.clone().lerp(b.d, k / steps).normalize();
          const tile = grid.nearestTile([d.x, d.y, d.z], hint);
          hint = tile;
          const src = land.isRiver(tile) ? tile : land.isRiver(a.t) ? a.t : lastRiver;
          const prof = this.riverProfile(src);
          const wet = !land.isLand(tile) || hydro.lake[tile] === 1;
          pts.push({ d, tile, width: prof.width, depth: prof.depth, wet });
        }
      }
      this.rivers.push(pts);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const id = segs.length / 8;
        segs.push(a.d.x, a.d.y, a.d.z, b.d.x, b.d.y, b.d.z, (a.width + b.width) / 2, (a.depth + b.depth) / 2);
        for (const t of new Set([a.tile, b.tile])) {
          for (const x of [t, ...grid.neighborsOf(t)]) {
            let l = this.tileRiverSegs.get(x);
            if (!l) this.tileRiverSegs.set(x, (l = []));
            if (l[l.length - 1] !== id) l.push(id);
          }
        }
      }
    }
    this.riverSeg = new Float32Array(segs);
  }

  /** Closest river segment to a point: distance (tile spacings) and its bed shape, or null. */
  private nearestRiver(x: number, y: number, z: number, t: number): { d: number; width: number; depth: number } | null {
    const ids = this.tileRiverSegs.get(t);
    if (!ids) return null;
    const S = this.riverSeg;
    let best: { d: number; width: number; depth: number } | null = null;
    for (const id of ids) {
      const o = id * 8;
      const ax = S[o] as number;
      const ay = S[o + 1] as number;
      const az = S[o + 2] as number;
      const vx = (S[o + 3] as number) - ax;
      const vy = (S[o + 4] as number) - ay;
      const vz = (S[o + 5] as number) - az;
      const len2 = vx * vx + vy * vy + vz * vz || 1e-12;
      const k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) / len2));
      const dx = x - (ax + vx * k);
      const dy = y - (ay + vy * k);
      const dz = z - (az + vz * k);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / this.spacing;
      const width = S[o + 6] as number;
      // Rank by distance relative to the bed width, so a wide river wins where beds meet.
      if (!best || d / width < best.d / best.width) best = { d, width, depth: S[o + 7] as number };
    }
    return best;
  }

  /**
   * Distance (world units) from a point to the edge of the river water: negative in the water,
   * positive on the bank; a large value away from rivers.
   */
  riverEdge(x: number, y: number, z: number, hint?: number): number {
    const t = this.tileAt(x, y, z, hint);
    const r = this.nearestRiver(x, y, z, t);
    if (!r) return 99;
    return (r.d - r.width * RIVER_SURFACE) * this.spacing * this.R;
  }

  /** Replace the set of roads (pairs of neighbouring tiles). Returns tiles whose ground changes. */
  setRoads(edges: readonly [number, number][]): number[] {
    const next = new Map<number, [number, number][]>();
    const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const nextKeys = new Set<string>();
    for (const [a, b] of edges) {
      const k = key(a, b);
      if (nextKeys.has(k)) continue;
      nextKeys.add(k);
      for (const t of [a, b]) {
        let l = next.get(t);
        if (!l) next.set(t, (l = []));
        l.push([a, b]);
      }
    }
    const oldKeys = new Set<string>();
    for (const l of this.roadEdges.values()) for (const [a, b] of l) oldKeys.add(key(a, b));
    const changed = new Set<number>();
    for (const k of nextKeys) if (!oldKeys.has(k)) for (const t of k.split(":")) changed.add(Number(t));
    for (const k of oldKeys) if (!nextKeys.has(k)) for (const t of k.split(":")) changed.add(Number(t));
    if (changed.size) this.roadEdges = next;
    return [...changed];
  }

  /** Nearest road centreline to a point: distance (world units) and the closest centreline point. */
  roadAt(x: number, y: number, z: number, hint?: number): { d: number; cx: number; cy: number; cz: number } | null {
    if (this.roadEdges.size === 0) return null;
    const t = this.tileAt(x, y, z, hint);
    const c = this.planet.grid.center;
    let best: { d: number; cx: number; cy: number; cz: number } | null = null;
    const test = (list: [number, number][] | undefined) => {
      if (!list) return;
      for (const [a, b] of list) {
        const ax = c[a * 3] as number;
        const ay = c[a * 3 + 1] as number;
        const az = c[a * 3 + 2] as number;
        const vx = (c[b * 3] as number) - ax;
        const vy = (c[b * 3 + 1] as number) - ay;
        const vz = (c[b * 3 + 2] as number) - az;
        const len2 = vx * vx + vy * vy + vz * vz;
        const k = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) / len2));
        const px = ax + vx * k;
        const py = ay + vy * k;
        const pz = az + vz * k;
        const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2) * this.R;
        if (!best || d < best.d) best = { d, cx: px, cy: py, cz: pz };
      }
    };
    test(this.roadEdges.get(t));
    for (const n of this.planet.grid.neighborsOf(t)) test(this.roadEdges.get(n));
    return best;
  }

  /** Distance (world units) from a point to the nearest road centreline; large away from roads. */
  roadDistance(x: number, y: number, z: number, hint?: number): number {
    return this.roadAt(x, y, z, hint)?.d ?? 99;
  }

  /** Replace the set of levelled pads (buildings and flags). */
  setPads(pads: readonly Pad[]): number[] {
    const next = new Map<number, number>();
    for (const p of pads) next.set(p.tile, p.radius);
    const changed: number[] = [];
    for (const [t, r] of next) if (this.pads.get(t) !== r) changed.push(t);
    for (const t of this.pads.keys()) if (!next.has(t)) changed.push(t);
    if (changed.length) {
      this.pads = next;
      this.padVersion++;
    }
    return changed;
  }

  /** Nearest tile to a unit direction (cached walk). */
  tileAt(x: number, y: number, z: number, hint = this.hint): number {
    const t = this.planet.grid.nearestTile([x, y, z], hint);
    this.hint = t;
    return t;
  }

  /** Smooth blend of tile heights (no detail), and the blend's colour. */
  private blend(x: number, y: number, z: number, t: number, col: THREE.Color | null): number {
    const { grid } = this.planet;
    const c = grid.center;
    let wsum = 0;
    let hsum = 0;
    if (col) col.setRGB(0, 0, 0);
    const add = (n: number) => {
      const dx = x - (c[n * 3] as number);
      const dy = y - (c[n * 3 + 1] as number);
      const dz = z - (c[n * 3 + 2] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= this.kernel2) return;
      const q = 1 - d2 / this.kernel2;
      const w = q * q;
      wsum += w;
      hsum += w * (this.baseH[n] as number);
      if (col) {
        const tc = this.tileCol[n] as THREE.Color;
        col.r += tc.r * w;
        col.g += tc.g * w;
        col.b += tc.b * w;
      }
    };
    add(t);
    for (const n of grid.neighborsOf(t)) add(n);
    if (col && wsum > 0) col.multiplyScalar(1 / wsum);
    return wsum > 0 ? hsum / wsum : (this.baseH[t] as number);
  }

  /** Height above the planet radius at a unit direction. */
  height(x: number, y: number, z: number, hint?: number, col: THREE.Color | null = null, withPads = true, withRoads = true): FieldSample {
    const t = this.tileAt(x, y, z, hint);
    let h = this.blend(x, y, z, t, col);
    // Sculpting: gentle rolling ground; ridged rock in the mountains; calm near the shore.
    const f = 1 / this.spacing;
    const m = Math.max(0, Math.min(1, h / this.peak));
    if (h > 0.05) {
      const coast = smooth(0.05, 0.8, h);
      // Rolling ground a little under a tile across, and finer lumps; calm by the water.
      const roll = this.noise.fbm(x * f * 1.1, y * f * 1.1, z * f * 1.1, 3) * 0.55 * coast;
      const fine = this.noise.fbm(x * f * 5.5, y * f * 5.5, z * f * 5.5, 2) * (0.06 + 0.3 * m) * coast;
      h += roll + fine;
      if (m > 0.05) {
        // Ridged rock in the mountains.
        const rn = 1 - Math.abs(this.ridge.fbm(x * f * 0.9, y * f * 0.9, z * f * 0.9, 4));
        h += rn * rn * m * m * this.peak * 0.22;
      }
      const hill = smooth(0.6, 2.2, h);
      // Gullies worn by rain: narrow ridged-noise valleys on hills and mountain flanks.
      const g = 1 - Math.abs(this.ridge.get(x * f * 1.9 + 7.1, y * f * 1.9, z * f * 1.9));
      h -= Math.pow(g, 10) * hill * (0.28 + 0.5 * m);
      // Soft terraces on some hillsides.
      const tmask = smooth(0.15, 0.45, this.noise.get(x * f * 0.35 + 3.3, y * f * 0.35, z * f * 0.35)) * hill * (1 - m);
      if (tmask > 0.01) {
        const step = 0.42;
        const k = h / step;
        const fl = Math.floor(k);
        const r = k - fl;
        const shaped = (fl + smooth(0.55, 1, r)) * step;
        h += (shaped - h) * tmask * 0.8;
      }
      // Rock outcrops: sharp bumps where a mid-frequency noise peaks.
      const o = this.noise.get(x * f * 2.6 + 11, y * f * 2.6, z * f * 2.6);
      h += smooth(0.42, 0.7, o) * (0.18 + 0.4 * m) * coast;
      // Cliffs: in high mountains the ground breaks into stepped strata with steep faces.
      if (m > 0.35) {
        const cs = this.peak * 0.075;
        const ck = h / cs;
        const cf = Math.floor(ck);
        const cliff = (cf + smooth(0.7, 0.95, ck - cf)) * cs;
        h += (cliff - h) * smooth(0.35, 0.65, m) * 0.85;
      }
    }
    // Riverbed: a flat bottom and gentle, rounded banks along the smoothed course.
    const river = this.nearestRiver(x, y, z, t);
    if (river && river.d < river.width * RIVER_BANK) h -= river.depth * smooth(river.width * RIVER_BANK, river.width * 0.6, river.d);
    // Road beds: level across the road, following the ground along it, pressed in a little.
    if (withRoads) {
      const road = this.roadAt(x, y, z, t);
      if (road && road.d < ROAD_HALF * 3) {
        const l = Math.hypot(road.cx, road.cy, road.cz);
        const centre = this.height(road.cx / l, road.cy / l, road.cz / l, t, null, false, false).h;
        h += (centre - 0.03 - h) * smooth(ROAD_HALF * 3, ROAD_HALF * 1.1, road.d);
      }
    }
    const { grid } = this.planet;
    const c = grid.center;
    // Levelled pads under buildings and flags.
    const pad = (p: number) => {
      const r = this.pads.get(p);
      if (r === undefined) return;
      const dx = x - (c[p * 3] as number);
      const dy = y - (c[p * 3 + 1] as number);
      const dz = z - (c[p * 3 + 2] as number);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / this.spacing;
      if (d > r * 1.8) return;
      const ph = this.padHeight(p);
      h += (ph - h) * smooth(r * 1.8, r, d);
    };
    if (withPads) {
      pad(t);
      for (const n of grid.neighborsOf(t)) pad(n);
    }
    return { h, tile: t };
  }

  /** Riverbed shape along the river leaving tile `t`: half-width (in tile spacings) and depth. */
  riverProfile(t: number): { width: number; depth: number } {
    const hydro = this.land.hydro;
    const strength = Math.min(1, Math.sqrt((hydro.flow[t] as number) / hydro.riverFlow) * 0.35 + 0.35);
    return { width: 0.11 + 0.1 * strength, depth: 0.35 + 0.4 * strength };
  }

  /** Height of the levelled pad at a tile centre: the smooth blend, without detail. */
  padHeight(t: number): number {
    const c = this.planet.grid.center;
    return Math.max(0.05, this.blend(c[t * 3] as number, c[t * 3 + 1] as number, c[t * 3 + 2] as number, t, null));
  }

  /** Surface radius at a unit direction. */
  radiusAt(dir: THREE.Vector3, hint?: number): number {
    return this.R + Math.max(-2, this.height(dir.x, dir.y, dir.z, hint).h);
  }

  /** Radius of the ground at a tile centre (pads included). */
  tileRadius(t: number): number {
    const c = this.planet.grid.center;
    return this.R + Math.max(0, this.height(c[t * 3] as number, c[t * 3 + 1] as number, c[t * 3 + 2] as number, t).h);
  }
}

/** Outer edge of a riverbank and of the water surface, in bed half-widths. */
const RIVER_BANK = 2.8;
export const RIVER_SURFACE = 1.75;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
