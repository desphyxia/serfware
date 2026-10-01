import { Biome, reclassify, type Terrain } from "./terrain";
import type { PlanetGrid } from "./grid";
import type { Vec3 } from "./wells";
import { mix32 } from "../rng";
import { Deposit, Feature, TREE_MATURE, type LandUse } from "../econ/landuse";

/**
 * The world painter: a seed's world changed by hand. A painted world is the seed plus a list of
 * brush strokes (and, optionally, where the twelve Star Wells sit), applied in order when the
 * world is made, so a painted world is as deterministic as any other and travels as a few
 * kilobytes of JSON in saves, scenarios and multiplayer starts.
 */
export type PaintKind = "raise" | "lower" | "level" | "sea" | "region" | "forest" | "clear" | "rocks" | "ore";

export interface PaintStroke {
  k: PaintKind;
  /** Where: a direction from the planet's centre (the nearest tile is the brush centre). */
  at: Vec3;
  /** Radius in tiles (0 is one tile). */
  r: number;
  /** raise/lower: strength (0..1); level: the height to level to; region: a PaintRegion; ore: a Deposit. */
  v?: number;
}

export interface WorldPaint {
  /** Where the twelve Star Wells sit (directions); otherwise the seed decides. */
  wells?: Vec3[];
  strokes: PaintStroke[];
}

/** The regions the painter can lay down, each as a terrain class with a fitting climate. */
export const PAINT_REGIONS = [
  { name: "Meadowlands", biome: Biome.Meadow, temp: 14, moist: 0.45 },
  { name: "Woods", biome: Biome.Forest, temp: 12, moist: 0.58 },
  { name: "Canopy Deeps", biome: Biome.DeepForest, temp: 20, moist: 0.8 },
  { name: "Rimefall Tundra", biome: Biome.Tundra, temp: -3, moist: 0.4 },
  { name: "Emberglass Steppe", biome: Biome.Steppe, temp: 22, moist: 0.25 },
  { name: "Saltglass Flats", biome: Biome.Desert, temp: 28, moist: 0.15 },
  { name: "Tidewater Reach", biome: Biome.Beach, temp: 16, moist: 0.5 },
  { name: "Lumen Mire", biome: Biome.Marsh, temp: 14, moist: 0.9 },
  { name: "Skyreef peaks", biome: Biome.Rock, temp: 6, moist: 0.3 },
] as const;

/** Strokes that change the ground itself (applied before the land is settled and watered). */
const TERRAIN: ReadonlySet<PaintKind> = new Set(["raise", "lower", "level", "sea", "region"]);

/** The tile nearest a direction. */
export function nearestTile(grid: PlanetGrid, at: Vec3): number {
  let best = 0;
  let bd = -Infinity;
  for (let t = 0; t < grid.count; t++) {
    const d = (grid.center[t * 3] as number) * at[0] + (grid.center[t * 3 + 1] as number) * at[1] + (grid.center[t * 3 + 2] as number) * at[2];
    if (d > bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** The tiles under a brush, each with its weight (1 at the centre, fading to the rim). */
export function brushTiles(grid: PlanetGrid, centre: number, r: number): { t: number; w: number }[] {
  const out = [{ t: centre, w: 1 }];
  const seen = new Set([centre]);
  let ring = [centre];
  for (let d = 1; d <= r; d++) {
    const next: number[] = [];
    for (const t of ring)
      for (const n of grid.neighborsOf(t))
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
          out.push({ t: n, w: 1 - (d / (r + 1)) ** 2 });
        }
    ring = next;
  }
  return out;
}

/** A stroke rounded so it saves and compares exactly. */
export function stroke(k: PaintKind, at: Vec3, r: number, v?: number): PaintStroke {
  const q = (x: number) => Math.round(x * 1e5) / 1e5;
  const s: PaintStroke = { k, at: [q(at[0]), q(at[1]), q(at[2])], r: Math.max(0, Math.min(8, Math.round(r))) };
  if (v !== undefined) s.v = q(v);
  return s;
}

/** Apply the ground strokes: height, sea and regions (inside Planet.generate). */
export function paintTerrain(grid: PlanetGrid, terrain: Terrain, paint: WorldPaint): void {
  const peak = terrain.params.mountainHeight;
  for (const s of paint.strokes) {
    if (!TERRAIN.has(s.k)) continue;
    for (const { t, w } of brushTiles(grid, nearestTile(grid, s.at), s.r)) {
      const e = terrain.elevation[t] as number;
      switch (s.k) {
        case "raise":
          terrain.elevation[t] = Math.min(peak * 1.1, Math.max(e, -0.2) + (s.v ?? 0.5) * w * peak * 0.25);
          break;
        case "lower":
          terrain.elevation[t] = Math.max(-peak * 0.6, e - (s.v ?? 0.5) * w * peak * 0.25);
          break;
        case "level":
          terrain.elevation[t] = e + ((s.v ?? 0.3) - e) * Math.min(1, w * 1.5);
          break;
        case "sea":
          terrain.elevation[t] = Math.min(e, -0.4 - w * peak * 0.15);
          break;
        case "region": {
          const r = PAINT_REGIONS[s.v ?? 0] ?? PAINT_REGIONS[0];
          if (e <= 0.05) terrain.elevation[t] = 0.25;
          if (r.biome === Biome.Beach) terrain.elevation[t] = Math.min(terrain.elevation[t] as number, 0.3);
          if (r.biome === Biome.Rock) terrain.elevation[t] = Math.max(terrain.elevation[t] as number, peak * (0.62 + 0.18 * w));
          else if ((terrain.elevation[t] as number) > peak * 0.55) terrain.elevation[t] = peak * 0.55;
          terrain.moisture[t] = r.moist;
          terrain.temperature[t] = r.temp;
          terrain.biome[t] = r.biome;
          continue;
        }
      }
      reclassify(terrain, grid, t);
    }
  }
  // Star Wells are always reachable land, whatever was painted over them.
  for (const p of grid.pentagons) {
    if ((terrain.elevation[p] as number) < 0.6) {
      terrain.elevation[p] = 0.6;
      reclassify(terrain, grid, p);
    }
    for (const n of grid.neighborsOf(p))
      if ((terrain.elevation[n] as number) < 0.35) {
        terrain.elevation[n] = 0.35;
        reclassify(terrain, grid, n);
      }
  }
}

/** Apply the strokes on what stands on the ground: woods, clearings, rocks and ore (after nature is placed). */
export function paintLand(land: LandUse, paint: WorldPaint): void {
  const grid = land.planet.grid;
  let changed = false;
  paint.strokes.forEach((s, i) => {
    if (TERRAIN.has(s.k)) return;
    for (const { t, w } of brushTiles(grid, nearestTile(grid, s.at), s.r)) {
      if (!land.isLand(t) || grid.degree(t) === 5) continue;
      // A fixed pattern per stroke and tile: woods thin out toward the brush's rim.
      const roll = (mix32(i * 7919 + 13, t) >>> 0) / 4294967296;
      const f = land.feature[t] as Feature;
      const bare = f === Feature.None || f === Feature.Shrub || f === Feature.Stump;
      switch (s.k) {
        case "forest":
          if (bare && roll < 0.35 + 0.5 * w) {
            land.feature[t] = Feature.Tree;
            land.amount[t] = TREE_MATURE;
            land.variety[t] = roll < 0.5 ? 0 : roll < 0.75 ? 1 : 2;
            changed = true;
          }
          break;
        case "clear":
          if (f === Feature.Tree || f === Feature.Rock || f === Feature.Shrub || f === Feature.Stump || f === Feature.Hedge || f === Feature.Giant) {
            land.feature[t] = Feature.None;
            land.amount[t] = 0;
            changed = true;
          }
          break;
        case "rocks":
          if (bare && roll < 0.25 + 0.4 * w) {
            land.feature[t] = Feature.Rock;
            land.amount[t] = 4 + (t % 6);
            land.variety[t] = t % 3;
            changed = true;
          }
          break;
        case "ore": {
          const d = (s.v ?? Deposit.Iron) as Deposit;
          land.deposit[t] = d;
          land.depositAmount[t] = d === Deposit.None ? 0 : Math.round(14 + 26 * w);
          break;
        }
      }
    }
  });
  if (changed) land.featureVersion++;
}
