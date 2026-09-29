import * as THREE from "three/webgpu";
import type { LandUse } from "../../sim/econ/landuse";
import type { Planet } from "../../sim/planet/planet";
import { Biome } from "../../sim/planet/terrain";
import { Noise3 } from "../noise";
import { biomeColor, tileHash } from "../palette";

/** A levelled patch of ground under a building or flag. */
export interface Pad {
  tile: number;
  /** Angular radius of the flat area. */
  radius: number;
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
    this.tileCol = [];
    const wet = (t: number) => !land.isLand(t) || land.hydro.lake[t] === 1;
    for (let t = 0; t < grid.count; t++) {
      let b = terrain.biome[t] as Biome;
      // Sand only where the water is: inland "beach" tiles are dry meadow.
      if (b === Biome.Beach && !wet(t) && !grid.neighborsOf(t).some(wet)) b = Biome.Steppe;
      const c = biomeColor(b, tileHash(t), new THREE.Color());
      if (b === Biome.Steppe && (terrain.biome[t] as Biome) === Biome.Beach) c.lerp(biomeColor(Biome.Meadow, tileHash(t), new THREE.Color()), 0.45);
      c.offsetHSL(0, 0, (0.5 - (terrain.moisture[t] as number)) * 0.05);
      this.tileCol.push(c);
    }
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
  height(x: number, y: number, z: number, hint?: number, col: THREE.Color | null = null, withPads = true): FieldSample {
    const t = this.tileAt(x, y, z, hint);
    let h = this.blend(x, y, z, t, col);
    const land = this.land;
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
    // Riverbeds along each river segment near this point.
    const hydro = land.hydro;
    const { grid } = this.planet;
    const c = grid.center;
    const carve = (a: number) => {
      if (!land.isRiver(a)) return;
      const b = hydro.flowTo[a] as number;
      if (b < 0) return;
      const ax = c[a * 3] as number;
      const ay = c[a * 3 + 1] as number;
      const az = c[a * 3 + 2] as number;
      const bx = c[b * 3] as number;
      const by = c[b * 3 + 1] as number;
      const bz = c[b * 3 + 2] as number;
      const vx = bx - ax;
      const vy = by - ay;
      const vz = bz - az;
      const len2 = vx * vx + vy * vy + vz * vz;
      const s = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) / len2));
      const dx = x - (ax + vx * s);
      const dy = y - (ay + vy * s);
      const dz = z - (az + vz * s);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / this.spacing;
      const { width, depth } = this.riverProfile(a);
      if (d > width * 2.2) return;
      h -= depth * smooth(width * 2.2, width * 0.5, d);
    };
    carve(t);
    for (const n of grid.neighborsOf(t)) carve(n);
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
    return { width: 0.16 + 0.12 * strength, depth: 0.35 + 0.45 * strength };
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

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
