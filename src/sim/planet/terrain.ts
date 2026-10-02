import { clamp, smoothstep } from "../dmath";
import { SimNoise } from "../noise";
import type { Rng } from "../rng";
import type { PlanetGrid } from "./grid";
import { reachSeas, type SeaReach } from "./reach";

/** Placeholder biomes until the biome framework (batch 13) replaces them with data. */
export enum Biome {
  DeepSea = 0,
  Sea = 1,
  Shallows = 2,
  Beach = 3,
  Meadow = 4,
  Forest = 5,
  DeepForest = 6,
  Steppe = 7,
  Marsh = 8,
  Rock = 9,
  Snow = 10,
  Tundra = 11,
  Desert = 12,
}

export const BIOME_NAMES = [
  "deep sea", "sea", "shallows", "beach", "meadow", "forest", "deep forest", "steppe", "marsh", "rock", "snow", "tundra", "desert",
] as const;

export interface TerrainParams {
  /** Fraction of tiles above sea level. */
  landFraction: number;
  /** Highest peak above sea level, in world units at radius 1 scale factor. */
  mountainHeight: number;
  /** 0 = cold world, 1 = hot world. */
  warmth: number;
  /** 0 = dry world, 1 = wet world. */
  wetness: number;
}

export interface Terrain {
  /** Elevation relative to sea level in world units (negative = under water). */
  elevation: Float32Array;
  moisture: Float32Array;
  /** Mean temperature in °C. */
  temperature: Float32Array;
  biome: Uint8Array;
  params: TerrainParams;
}

export function generateTerrain(grid: PlanetGrid, rng: Rng, radius: number, overrides: Partial<TerrainParams> = {}, seas?: SeaReach): Terrain {
  const N = grid.count;
  // Drawn first and then overridden, so a planet with overrides keeps the same random stream.
  const params: TerrainParams = {
    landFraction: rng.range(0.36, 0.56),
    mountainHeight: radius * rng.range(0.055, 0.085),
    warmth: rng.range(0.35, 0.7),
    wetness: rng.range(0.35, 0.75),
  };
  Object.assign(params, overrides);
  const nContinents = new SimNoise(rng.nextU32());
  const nWarp = new SimNoise(rng.nextU32());
  const nRidge = new SimNoise(rng.nextU32());
  const nMoist = new SimNoise(rng.nextU32());
  const nDetail = new SimNoise(rng.nextU32());

  const raw = new Float64Array(N);
  const ridge = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    const x = grid.center[t * 3] as number;
    const y = grid.center[t * 3 + 1] as number;
    const z = grid.center[t * 3 + 2] as number;
    const wx = nWarp.fbm(x * 1.4 + 5, y * 1.4, z * 1.4, 3) * 0.45;
    const wy = nWarp.fbm(x * 1.4, y * 1.4 + 9, z * 1.4, 3) * 0.45;
    const wz = nWarp.fbm(x * 1.4, y * 1.4, z * 1.4 - 4, 3) * 0.45;
    const base = nContinents.fbm(x * 1.25 + wx, y * 1.25 + wy, z * 1.25 + wz, 5);
    const r = nRidge.ridged(x * 2.6 + wx, y * 2.6 + wy, z * 2.6 + wz, 4);
    ridge[t] = r;
    raw[t] = base + nDetail.fbm(x * 7, y * 7, z * 7, 2) * 0.06;
  }

  // Sea level at the chosen land fraction (deterministic sort with index tie-break).
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => (raw[a] as number) - (raw[b] as number) || a - b);
  const seaIndex = Math.floor(N * (1 - params.landFraction));
  const sea = raw[order[seaIndex] as number] as number;
  const maxRaw = raw[order[N - 1] as number] as number;
  const minRaw = raw[order[0] as number] as number;

  const elevation = new Float32Array(N);
  for (let t = 0; t < N; t++) {
    const h = raw[t] as number;
    if (h >= sea) {
      const up = (h - sea) / (maxRaw - sea + 1e-9);
      const hills = up * up * 0.55 + up * 0.1;
      const mountains = smoothstep(0.15, 0.7, up) * (ridge[t] as number) * 0.9;
      elevation[t] = 0.12 + (hills + mountains) * params.mountainHeight;
    } else {
      const down = (sea - h) / (sea - minRaw + 1e-9);
      elevation[t] = -0.25 - Math.sqrt(down) * params.mountainHeight * 0.6;
    }
  }

  // Star Wells are always reachable land: raise pentagons and their neighbours into islands.
  for (const p of grid.pentagons) {
    elevation[p] = Math.max(elevation[p] as number, 0.6);
    for (const n of grid.neighborsOf(p)) elevation[n] = Math.max(elevation[n] as number, 0.35);
  }

  if (seas) reachSeas(grid, elevation, seas);

  const moisture = new Float32Array(N);
  const temperature = new Float32Array(N);
  const biome = new Uint8Array(N);
  for (let t = 0; t < N; t++) {
    const x = grid.center[t * 3] as number;
    const y = grid.center[t * 3 + 1] as number;
    const z = grid.center[t * 3 + 2] as number;
    const e = elevation[t] as number;
    const lat = Math.abs(y);
    const m = clamp(nMoist.fbm(x * 2.2 + 11, y * 2.2, z * 2.2, 4) * 0.9 + params.wetness * 0.9 - 0.2, 0, 1);
    moisture[t] = m;
    const temp = tileTemperature(params, lat, e);
    temperature[t] = temp;
    biome[t] = classify(e, m, temp, params.mountainHeight);
  }
  return { elevation, moisture, temperature, biome, params };
}

function classify(e: number, m: number, temp: number, peak: number): Biome {
  if (e < -peak * 0.3) return Biome.DeepSea;
  if (e < -0.9) return Biome.Sea;
  if (e < 0) return Biome.Shallows;
  if (temp < -8) return Biome.Snow;
  if (e > peak * 0.62) return temp < 2 ? Biome.Snow : Biome.Rock;
  if (e < 0.35 && m < 0.75) return Biome.Beach;
  if (temp < 1) return Biome.Tundra;
  if (temp > 24 && m < 0.3) return Biome.Desert;
  if (m < 0.35) return Biome.Steppe;
  if (m > 0.82 && e < peak * 0.12) return Biome.Marsh;
  if (m > 0.66) return Biome.DeepForest;
  if (m > 0.5) return Biome.Forest;
  return Biome.Meadow;
}

/** A tile's mean temperature from its latitude (|y| of its centre) and height (painted worlds). */
export function tileTemperature(params: TerrainParams, lat: number, e: number): number {
  return 30 * params.warmth + 12 - lat * lat * 46 - Math.max(0, e) * (38 / params.mountainHeight) * 0.7;
}

/** Recompute a tile's temperature and terrain class after its height changed (the world painter). */
export function reclassify(terrain: Terrain, grid: PlanetGrid, t: number): void {
  const e = terrain.elevation[t] as number;
  const temp = tileTemperature(terrain.params, Math.abs(grid.center[t * 3 + 1] as number), e);
  terrain.temperature[t] = temp;
  terrain.biome[t] = classify(e, terrain.moisture[t] as number, temp, terrain.params.mountainHeight);
}
