import type { World } from "../world";
import { BUILDINGS, buildingType, type BuildingDef } from "./defs";
import { Feature } from "./landuse";

/**
 * Simple site planner: finds a spot for a building near the keep and connects it with a road.
 * Used by the debug "starter chain" action and later by the AI builder.
 */
export function placeConnected(
  w: World,
  type: string,
  opts: { minDist?: number; maxDist?: number; near?: Feature; player?: number; center?: number; splitRoads?: boolean } = {},
): boolean {
  const eco = w.economy;
  const land = w.land;
  const player = opts.player ?? 0;
  const keep = eco.buildings[eco.keeps[player] ?? -1];
  if (!keep) return false;
  const center = opts.center ?? keep.tile;
  const minDist = opts.minDist ?? 2;
  const inner = new Set(land.ring(center, minDist - 1));
  const candidates = land.ring(center, opts.maxDist ?? 8).filter((t) => !inner.has(t));
  const score = (t: number) => {
    if (opts.near === undefined) return 0;
    let n = 0;
    for (const x of land.ring(t, 4)) if (land.feature[x] === opts.near) n++;
    return -n;
  };
  // Prefer good spots close to home: each ring step away costs about one tree's worth.
  const ranked = candidates.map((t, i) => [Math.max(score(t), -6) + i / 6, t] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return placeOn(w, type, ranked.map(([, t]) => t), player, opts.splitRoads ?? false) >= 0;
}

/**
 * Try candidate tiles in order: build `type` on the first that fits and connect its flag to the
 * nearest reachable flag of the player. Returns the tile used, or -1.
 */
export function placeOn(w: World, type: string, tiles: readonly number[], player: number, splitRoads = false, maxTries = 60): number {
  const eco = w.economy;
  const land = w.land;
  const def = BUILDINGS[buildingType(type)] as BuildingDef;
  const grid = land.planet.grid;
  const c = grid.center;
  let tries = 0;
  for (const t of tiles) {
    const flagTile = land.bestFlagTile(t, player);
    if (flagTile < 0 || !land.canBuildDef(t, flagTile, def, player)) continue;
    const existing = eco.flagAt(flagTile);
    if (existing && existing.building >= 0) continue;
    if (++tries > maxTries) break;
    // Connect to one of the nearest flags (by straight-line distance) that a road can reach.
    const near = eco.flags
      .filter((f) => f.alive && f.owner === player && f.tile !== flagTile)
      .map((f) => {
        const dx = (c[f.tile * 3] as number) - (c[flagTile * 3] as number);
        const dy = (c[f.tile * 3 + 1] as number) - (c[flagTile * 3 + 1] as number);
        const dz = (c[f.tile * 3 + 2] as number) - (c[flagTile * 3 + 2] as number);
        return [dx * dx + dy * dy + dz * dz, f.tile] as const;
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, 6);
    let best: number[] | null = null;
    for (const [, ft] of near) {
      const path = land.findPath(ft, flagTile, (x) => land.roadable(x, player) && x !== t, 1500);
      if (!path || path.length < 3 || eco.checkRoad(path, player)) continue;
      if (!best || path.length < best.length) best = path;
    }
    if (!best && !existing) continue;
    if (!w.command({ t: "build", type, tile: t, flagTile, player }).ok) continue;
    if (best && !(existing && existing.roads.length > 0)) {
      if (w.command({ t: "road", tiles: best, player }).ok && splitRoads) {
        // More flags on long roads mean more carriers and fewer queues.
        if (best.length > 8) for (let i = 4; i < best.length - 3; i += 4) w.command({ t: "flag", tile: best[i] as number, player });
      }
    }
    return t;
  }
  return -1;
}

/** Own tiles near the border ranked by how much unclaimed land a lantern there would light. */
export function frontierTiles(w: World, player: number, jitter: () => number = () => 0): number[] {
  const land = w.land;
  const scored: [number, number][] = [];
  for (let t = 0; t < land.territory.length; t++) {
    if (land.territory[t] !== player + 1 || !land.isLand(t)) continue;
    let free = 0;
    let own = 0;
    for (const n of land.ring(t, 5)) {
      if (land.territory[n] === 0 && land.isLand(n)) free++;
      else if (land.territory[n] === player + 1) own++;
    }
    if (free < 8 || own < 12) continue;
    scored.push([-free + jitter(), t]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.map(([, t]) => t);
}

/** Woodcutter, forester, quarry and sawmill, each connected to the network. */
export function starterChain(w: World, player = 0): number {
  let n = 0;
  if (placeConnected(w, "woodcutter", { minDist: 3, near: Feature.Tree, player })) n++;
  if (placeConnected(w, "forester", { minDist: 3, near: Feature.Tree, player })) n++;
  if (placeConnected(w, "quarry", { minDist: 3, near: Feature.Rock, player })) n++;
  if (placeConnected(w, "sawmill", { minDist: 2, player })) n++;
  return n;
}

/** A fuller demo settlement: materials, food chain, a fisher and a toolsmith. */
export function demoSettlement(w: World, player = 0): number {
  let n = starterChain(w, player);
  for (const [type, near] of [
    ["farm", undefined],
    ["mill", undefined],
    ["bakery", undefined],
    ["fisher", undefined],
    ["pasture", undefined],
    ["butcher", undefined],
    ["toolsmith", undefined],
    ["house", undefined],
    ["house", undefined],
    ["house", undefined],
  ] as const) if (placeConnected(w, type, { minDist: 2, maxDist: 9, near, player })) n++;
  const keep = w.economy.buildings[w.economy.keeps[player] ?? -1];
  if (keep) w.command({ t: "geologist", flagTile: w.economy.flags[keep.flag]!.tile, player });
  for (const type of ["beacon", "lamphouse", "lantern"]) if (placeOn(w, type, frontierTiles(w, player).slice(0, 30), player, true, 10) >= 0) n++;
  return n;
}
