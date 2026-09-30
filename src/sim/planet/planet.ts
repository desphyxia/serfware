import { mix32 } from "../rng";
import { StateHasher } from "../hash";
import type { Rng } from "../rng";
import { buildPlanetGrid, GRID_SIZES, type GridSize, type PlanetGrid } from "./grid";
import { generateTerrain, type Terrain } from "./terrain";

export interface PlanetParams {
  size: GridSize;
  /** World-space radius. Scales with tile count so tiles are roughly the same size everywhere. */
  radius: number;
  dayLengthHours: number;
  /** Axial tilt in radians. */
  axialTilt: number;
  gravity: number;
  /** Tidally locked: one face always to the sun (a fixed sun, a twilight ring, a frozen far side). */
  locked: boolean;
}

/** Parameters forced on a generated planet (the other planets of a star system). */
export interface PlanetOverrides {
  size?: GridSize;
  dayLengthHours?: number;
  axialTilt?: number;
  gravity?: number;
  locked?: boolean;
  warmth?: number;
  wetness?: number;
  landFraction?: number;
}

/** A generated planet: parameters, tile grid and terrain. Fully determined by its seed. */
export class Planet {
  constructor(
    readonly params: PlanetParams,
    readonly grid: PlanetGrid,
    readonly terrain: Terrain,
  ) {}

  static generate(rng: Rng, size?: GridSize, overrides: PlanetOverrides = {}): Planet {
    const pr = rng.fork("planet-params");
    const chosen: GridSize = size ?? overrides.size ?? pr.pick(["small", "medium", "medium", "large"] as const);
    const freq = GRID_SIZES[chosen];
    const tiles = 10 * freq * freq + 2;
    const params: PlanetParams = {
      size: chosen,
      radius: Math.sqrt(tiles),
      dayLengthHours: pr.int(18, 36),
      axialTilt: pr.range(0.08, 0.48),
      gravity: Math.round(pr.range(0.75, 1.25) * 100) / 100,
      locked: false,
    };
    // Decided from the parameters already drawn (not a new draw), so other worlds are unchanged.
    params.locked = mix32(tiles, Math.round(params.dayLengthHours * 7919 + params.axialTilt * 1e6)) % 7 === 0;
    // Another planet of the system: its own physics and climate (see sim/system).
    if (overrides.dayLengthHours !== undefined) params.dayLengthHours = overrides.dayLengthHours;
    if (overrides.axialTilt !== undefined) params.axialTilt = overrides.axialTilt;
    if (overrides.gravity !== undefined) params.gravity = overrides.gravity;
    if (overrides.locked !== undefined) params.locked = overrides.locked;
    const grid = buildPlanetGrid(freq, rng.fork("grid"));
    const terrain = generateTerrain(grid, rng.fork("terrain"), params.radius, { ...(overrides.warmth !== undefined && { warmth: overrides.warmth }), ...(overrides.wetness !== undefined && { wetness: overrides.wetness }), ...(overrides.landFraction !== undefined && { landFraction: overrides.landFraction }) });
    return new Planet(params, grid, terrain);
  }

  /** Surface radius of a tile centre. */
  surfaceRadius(t: number): number {
    return this.params.radius + Math.max(0, this.terrain.elevation[t] as number);
  }

  hash(h: StateHasher): void {
    h.int(this.grid.count);
    for (let t = 0; t < this.grid.count; t += 97) h.float(this.terrain.elevation[t] as number).float(this.grid.center[t * 3] as number);
  }
}
