import type { World } from "../world";
import { BUILDINGS, buildingType, GOOD_INDEX, type BuildingDef } from "./defs";
import { Feature, Use } from "./landuse";

/**
 * Simple site planner: finds a spot for a building near the keep and connects it with a road.
 * Used by the debug "starter chain" action and later by the AI builder.
 */
export function placeConnected(
  w: World,
  type: string,
  opts: { minDist?: number; maxDist?: number; near?: Feature; /** With `near`: at least this many of that feature within reach (a quarry with no rock in reach never works). */ need?: number; player?: number; center?: number; splitRoads?: boolean } = {},
): boolean {
  const eco = w.economy;
  const land = w.land;
  const player = opts.player ?? 0;
  const keep = eco.buildings[eco.keeps[player] ?? -1];
  if (!keep) return false;
  const center = opts.center ?? keep.tile;
  const minDist = opts.minDist ?? 2;
  const inner = new Set(land.ring(center, minDist - 1));
  const reach = (t: number) => {
    let n = 0;
    for (const x of land.ring(t, 6)) if (land.feature[x] === opts.near && (opts.near !== Feature.Rock || (land.amount[x] as number) > 0)) n++;
    return n;
  };
  const candidates = land.ring(center, opts.maxDist ?? 8).filter((t) => !inner.has(t) && (opts.near === undefined || !opts.need || reach(t) >= opts.need));
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

/** The tiles joined to `start` by land and bridges. */
export function landmassOf(w: World, start: number): Set<number> {
  const land = w.land;
  const grid = land.planet.grid;
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    for (const n of grid.neighborsOf(stack.pop() as number)) {
      if (seen.has(n) || !(land.isLand(n) || land.bridge[n] === 1)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen;
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
  // The land the Hearthship stands on (found when first needed): a flag there that no road joins to it is a dead end.
  let landmass: Set<number> | undefined;
  const home = () => (landmass ??= landmassOf(w, eco.buildings[eco.keeps[player] ?? -1]?.tile ?? 0));
  for (const t of tiles) {
    const flagTile = land.bestFlagTile(t, player);
    if (flagTile < 0 || !land.canBuildDef(t, flagTile, def, player)) continue;
    const existing = eco.flagAt(flagTile);
    if (existing && existing.building >= 0) continue;
    if (++tries > maxTries) break;
    // Connect to one of the nearest flags (by straight-line distance) that a road can reach.
    // Only flags that join the Hearthship's network: a road to a cut-off island leaves the site unreachable.
    const keepFlag = eco.buildings[eco.keeps[player] ?? -1]?.flag ?? -1;
    const mine = eco.flags.filter((f) => f.alive && f.owner === player && f.tile !== flagTile);
    const joined = keepFlag < 0 ? mine : mine.filter((f) => eco.route(keepFlag, f.id).dist < Infinity || !home().has(f.tile));
    const near = (joined.length ? joined : mine)
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

/** A fuller demo settlement: materials, food chain, a fisher, a toolsmith, a well, a hunter, an orchard, bees and hedgerows. */
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
    ["well", undefined],
    ["hunter", Feature.Tree],
    ["orchard", undefined],
    ["apiary", undefined],
  ] as const) if (placeConnected(w, type, { minDist: 2, maxDist: 9, near, player })) n++;
  // A hedgerow along the farm's edge.
  const farm = w.economy.buildings.find((b) => b.alive && b.owner === player && b.def.id === "farm");
  if (farm) {
    let hedges = 0;
    for (const t of w.land.ring(farm.tile, 4)) {
      if (hedges >= 6 || w.land.ring(farm.tile, 2).includes(t)) continue;
      if (w.command({ t: "hedge", tile: t, player }).ok) hedges++;
    }
  }
  const keep = w.economy.buildings[w.economy.keeps[player] ?? -1];
  if (keep) w.command({ t: "geologist", flagTile: w.economy.flags[keep.flag]!.tile, player });
  for (const type of ["beacon", "lamphouse", "lantern"]) if (placeOn(w, type, frontierTiles(w, player).slice(0, 30), player, true, 10) >= 0) n++;
  return n;
}

/**
 * Debug and screenshot helper: push player `p`'s border toward player `q` with beacons, arm the
 * wardens, and march on the nearest enemy lantern. Returns the target building id, or -1.
 */
export function demoBattle(w: World, p = 0, q = 1): number {
  const eco = w.economy;
  if (eco.keeps[q] === undefined) return -1;
  eco.peaceUntil = 0;
  w.command({ t: "garrison", zone: "frontier", value: 1, player: p });
  w.command({ t: "garrison", zone: "inland", value: 1, player: p });
  const keep = eco.buildings[eco.keeps[p] as number] as { stock: number[] };
  keep.stock[GOOD_INDEX.get("blade") as number] = 10;
  keep.stock[GOOD_INDEX.get("bow") as number] = 4;
  keep.stock[GOOD_INDEX.get("stone") as number]! += 20;
  const enemyKeep = eco.buildings[eco.keeps[q] as number] as { tile: number };
  const c = w.planet.grid.center;
  const dist = (t: number) => (c[t * 3]! - c[enemyKeep.tile * 3]!) ** 2 + (c[t * 3 + 1]! - c[enemyKeep.tile * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[enemyKeep.tile * 3 + 2]!) ** 2;
  const targetOf = () =>
    eco.buildings
      .filter((b) => b.alive && b.built && b.owner === q && b.def.light && !eco.attackBlocked(p, b))
      .sort((a, b) => a.id - b.id)[0];
  const ready = () => {
    const t = targetOf();
    return !!t && eco.attackersFor(p, t).length >= 3;
  };
  for (let round = 0; round < 5 && !ready(); round++) {
    const own: number[] = [];
    for (let t = 0; t < w.land.territory.length; t++) if (w.land.territory[t] === p + 1 && w.land.isLand(t)) own.push(t);
    own.sort((a, b) => dist(a) - dist(b) || a - b);
    let t = placeOn(w, "beacon", own.slice(0, 200), p, true, 60);
    if (t < 0) t = placeOn(w, "lamphouse", own.slice(0, 200), p, true, 60);
    if (t < 0) break;
    const b = eco.buildings.find((x) => x.alive && x.tile === t) as { lit: boolean; garrison: number[] };
    for (let i = 0; i < 20000 && !(b.lit && b.garrison.length >= 4); i++) w.step();
  }
  const target = targetOf();
  if (!target) return -1;
  for (let i = 0; i < 1500; i++) w.step();
  w.command({ t: "attack", target: target.id, count: 99, player: p });
  return target.id;
}

/**
 * A settlement boxed in by forest or rock: when ground that could be built on cannot be reached by
 * road, put a woodcutter (trees) or a quarry (rocks) where it can clear the first obstacle between
 * the road network and that ground. Returns what it did: a clearing site built, a forester taken down, or nothing.
 */
export function clearForest(w: World, player: number): "built" | "forester" | null {
  const eco = w.economy;
  const land = w.land;
  const grid = land.planet.grid;
  const c = grid.center;
  const lantern = BUILDINGS[buildingType("lantern")] as BuildingDef;
  const flags = eco.flags.filter((f) => f.alive && f.owner === player);
  if (!flags.length) return null;
  const d2 = (a: number, b: number) => (c[a * 3]! - c[b * 3]!) ** 2 + (c[a * 3 + 1]! - c[b * 3 + 1]!) ** 2 + (c[a * 3 + 2]! - c[b * 3 + 2]!) ** 2;
  const nearestFlags = (t: number, n: number) =>
    flags
      .map((f) => [d2(f.tile, t), f.tile] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, n)
      .map(([, ft]) => ft);
  // Ground one could build on: reachable by road from the network, or not.
  const targets: [number, number, number][] = [];
  for (let t = 0; t < land.territory.length; t++) {
    if (land.territory[t] !== player + 1 || !land.isLand(t)) continue;
    const ft = land.bestFlagTile(t, player);
    if (ft < 0 || !land.canBuildDef(t, ft, lantern, player)) continue;
    const near = nearestFlags(ft, 1)[0] as number;
    targets.push([d2(near, ft), t, ft]);
  }
  targets.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const open = (x: number) => land.roadable(x, player);
  const through = (x: number) => open(x) || (land.isLand(x) && land.mayRoad(x, player) && land.use[x] === Use.Free && (land.feature[x] === Feature.Tree || land.feature[x] === Feature.Rock));
  for (const [, t, ft] of targets.slice(0, 12)) {
    const sources = nearestFlags(ft, 4);
    if (sources.some((s) => land.findPath(s, ft, (x) => open(x) && x !== t, 1500))) return null;
    let best: number[] | null = null;
    for (const s of sources) {
      const path = land.findPath(s, ft, (x) => through(x) && x !== t, 1500);
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) continue;
    const blocker = best.find((x) => land.feature[x] === Feature.Tree || land.feature[x] === Feature.Rock);
    if (blocker === undefined) continue;
    const type = land.feature[blocker] === Feature.Tree ? "woodcutter" : "quarry";
    // Close to the blocker first; a woodcutter reaches 6 tiles, so anything within 5 will do.
    const sites = land.ring(blocker, 5).filter((x) => land.territory[x] === player + 1).sort((a, b) => d2(a, blocker) - d2(b, blocker) || a - b);
    if (placeOn(w, type, sites, player, true, 40) >= 0) return "built";
    // No reachable site: the foresters are probably planting faster than the woodcutters fell. Take one down.
    const forester = eco.buildings
      .filter((b) => b.alive && b.owner === player && b.def.id === "forester")
      .sort((a, b) => d2(a.tile, blocker) - d2(b.tile, blocker) || a.id - b.id)[0];
    if (forester && w.command({ t: "demolish", tile: forester.tile, player }).ok) return "forester";
  }
  return null;
}
