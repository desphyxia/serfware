import type { World } from "../world";
import { BUILDINGS, buildingType } from "./defs";
import { Feature } from "./landuse";

/**
 * Simple site planner: finds a spot for a building near the keep and connects it with a road.
 * Used by the debug "starter chain" action and later by the AI builder.
 */
export function placeConnected(w: World, type: string, opts: { minDist?: number; maxDist?: number; near?: Feature } = {}): boolean {
  const eco = w.economy;
  const land = w.land;
  const keep = eco.buildings[eco.keep];
  if (!keep) return false;
  const large = !!BUILDINGS[buildingType(type)]?.large;
  const minDist = opts.minDist ?? 2;
  const inner = new Set(land.ring(keep.tile, minDist - 1));
  const candidates = land.ring(keep.tile, opts.maxDist ?? 8).filter((t) => !inner.has(t));
  const score = (t: number) => {
    if (opts.near === undefined) return 0;
    let n = 0;
    for (const x of land.ring(t, 4)) if (land.feature[x] === opts.near) n++;
    return -n;
  };
  // Prefer good spots close to home: each ring step away costs about one tree's worth.
  const ranked = candidates.map((t, i) => [Math.max(score(t), -6) + i / 6, t] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, t] of ranked) {
    const flagTile = land.bestFlagTile(t);
    if (flagTile < 0 || !land.canBuild(t, flagTile, large)) continue;
    const existing = eco.flagAt(flagTile);
    if (existing && existing.building >= 0) continue;
    // Connect to the nearest existing flag.
    let best: number[] | null = null;
    for (const f of eco.flags) {
      if (!f.alive || f.tile === flagTile) continue;
      const path = land.findPath(f.tile, flagTile, (x) => land.roadable(x) && x !== t, 1500);
      if (!path || path.length < 3 || eco.checkRoad(path)) continue;
      if (!best || path.length < best.length) best = path;
    }
    if (!best && !existing) continue;
    if (!w.command({ t: "build", type, tile: t, flagTile }).ok) continue;
    if (best && !(existing && existing.roads.length > 0)) w.command({ t: "road", tiles: best });
    return true;
  }
  return false;
}

/** Woodcutter, forester, quarry and sawmill, each connected to the network. */
export function starterChain(w: World): number {
  let n = 0;
  if (placeConnected(w, "woodcutter", { minDist: 3, near: Feature.Tree })) n++;
  if (placeConnected(w, "forester", { minDist: 3, near: Feature.Tree })) n++;
  if (placeConnected(w, "quarry", { minDist: 3, near: Feature.Rock })) n++;
  if (placeConnected(w, "sawmill", { minDist: 2 })) n++;
  return n;
}
