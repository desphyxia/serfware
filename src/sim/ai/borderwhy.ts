import { BUILDINGS, buildingType, type BuildingDef } from "../econ/defs";
import { Feature, LANTERN_GAP, MAX_LEVEL_SLOPE, Use } from "../econ/landuse";
import { landmassOf } from "../econ/planner";
import type { World } from "../world";

/**
 * A diagnostic for the balance probe: why a try at pushing the border out (a lantern building near the frontier)
 * placed nothing, in terms of what stands in the way. It only reads the land and the economy, and no decision depends
 * on it. The checks repeat LandUse.canBuild, LandUse.roadable and the road search in `placeOn`, so it must follow them.
 */

/** What keeps a building off a tile (LandUse.canBuild). */
const BLOCKS_BUILDING = new Set([Feature.Tree, Feature.Rock, Feature.Field, Feature.Hedge, Feature.Giant, Feature.Vent, Feature.Spire, Feature.Glowcap, Feature.Ruin]);
/** What keeps a road off a tile (LandUse.roadable). */
const BLOCKS_ROAD = new Set([Feature.Tree, Feature.Rock, Feature.Hedge, Feature.Giant, Feature.Field, Feature.Vent, Feature.Spire, Feature.Glowcap]);
const ROAD_SLOPE = 2.2;
/** Kinds of obstacle a road may be stopped by; each is lifted in turn to see whether that alone would open a way. */
const OBSTACLES: readonly [string, readonly Feature[]][] = [
  ["trees", [Feature.Tree]],
  ["rocks", [Feature.Rock]],
  ["fields", [Feature.Field]],
  ["hedges", [Feature.Hedge]],
  ["glowcaps", [Feature.Glowcap]],
  ["giants, vents or spires", [Feature.Giant, Feature.Vent, Feature.Spire]],
];
const ROAD_TILES_TRIED = 3;
const FLAGS_TRIED = 6;
const SEARCH_NODES = 1500;
const WIDE_NODES = 8000;

/**
 * Counts, through `add`, one reason per frontier tile that did not take the building (`stand:` and `flag:`: the tile
 * itself), and for the first few tiles that could take it, why no road was laid to it (`road:`).
 */
export function diagnoseBorder(w: World, player: number, type: string, tiles: readonly number[], add: (reason: string) => void): void {
  const land = w.land;
  const eco = w.economy;
  const grid = land.planet.grid;
  const def = BUILDINGS[buildingType(type)] as BuildingDef;
  const name = (f: number) => Feature[f] ?? `feature ${f}`;

  /** Why a flag cannot go on any side of `t`: the commonest blocker among its neighbours. */
  const noFlag = (t: number): string => {
    const count = new Map<string, number>();
    for (const n of grid.neighborsOf(t)) {
      const r = land.flagBlocker(n, player);
      if (r) count.set(r, (count.get(r) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "taken";
  };

  /** Why the building cannot stand on `t` with its flag on `flag`, or null. */
  const cannotStand = (t: number, flag: number): string | null => {
    if (def.slots && land.lanternAt && land.ring(t, LANTERN_GAP - 1).some((n) => land.use[n] === Use.Building && land.lanternAt?.(n))) return "another lantern building within 2 steps";
    if (!land.isLand(t)) return "water";
    if (land.territory[t] !== player + 1) return "outside the border";
    if (land.use[t] !== Use.Free) return `the tile holds a ${Use[land.use[t] as number]?.toLowerCase()}`;
    const f = land.feature[t] as number;
    if (BLOCKS_BUILDING.has(f)) return `${name(f).toLowerCase()} on the tile`;
    if (grid.degree(t) === 5) return "a Star Well";
    if (land.slope(t) > (def.large ? MAX_LEVEL_SLOPE : 1.3)) return "too steep";
    for (const n of grid.neighborsOf(t)) {
      if (land.use[n] === Use.Building && (def.large || land.largeAt?.(n) !== false)) return def.large ? "a building beside it (a large one needs room)" : "a large building beside it";
      if (def.large && n !== flag && (land.use[n] !== Use.Free || land.feature[n] === Feature.Rock)) return `a large building needs clear ground: ${land.feature[n] === Feature.Rock ? "rock" : Use[land.use[n] as number]?.toLowerCase()} beside it`;
    }
    return land.canBuildDef(t, flag, def, player) ? null : "some other rule";
  };

  const flags = eco.flags.filter((f) => f.alive && f.owner === player);
  const c = grid.center;
  const nearest = (flagTile: number): number[] =>
    flags
      .filter((f) => f.tile !== flagTile)
      .map((f) => {
        const dx = (c[f.tile * 3] as number) - (c[flagTile * 3] as number);
        const dy = (c[f.tile * 3 + 1] as number) - (c[flagTile * 3 + 1] as number);
        const dz = (c[f.tile * 3 + 2] as number) - (c[flagTile * 3 + 2] as number);
        return [dx * dx + dy * dy + dz * dz, f.tile] as const;
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, FLAGS_TRIED)
      .map(([, t]) => t);

  /** The road test of `placeOn`, with some of what stops a road lifted: a tile passes when it normally would, or when only a lifted obstacle stops it. */
  const lifted = (site: number, features: ReadonlySet<number>, lift: { use?: boolean; border?: boolean; slope?: boolean } = {}) => (x: number) => {
    if (x === site) return false;
    if (land.roadable(x, player)) return true;
    if (!land.isLand(x) || !(lift.border || land.mayRoad(x, player))) return false;
    if (!lift.use && land.use[x] !== Use.Free && land.use[x] !== Use.Blocked) return false;
    if (BLOCKS_ROAD.has(land.feature[x] as number) && !features.has(land.feature[x] as number)) return false;
    return !!lift.slope || land.slope(x) < ROAD_SLOPE;
  };

  const room: [number, number][] = [];
  for (const t of tiles) {
    const flag = land.bestFlagTile(t, player);
    if (flag < 0) {
      add(`flag: ${noFlag(t)} on every side`);
      continue;
    }
    const why = cannotStand(t, flag);
    if (why) add(`stand: ${why}`);
    else {
      add("stand: fits");
      room.push([t, flag]);
    }
  }

  const keep = eco.buildings[eco.keeps[player] ?? -1];
  const home = keep ? landmassOf(w, keep.tile) : new Set<number>();
  for (const [site, flag] of room.slice(0, ROAD_TILES_TRIED)) {
    const near = nearest(flag);
    if (!near.length) {
      add("road: no flag of ours to join");
      continue;
    }
    // How far the nearest flag is, in tiles (straight line), in bands of 5.
    const nf = near[0] as number;
    const d = Math.sqrt(((c[nf * 3] as number) - (c[flag * 3] as number)) ** 2 + ((c[nf * 3 + 1] as number) - (c[flag * 3 + 1] as number)) ** 2 + ((c[nf * 3 + 2] as number) - (c[flag * 3 + 2] as number)) ** 2) / land.spacing;
    add(`reach: nearest flag ${Math.floor(d / 5) * 5}-${Math.floor(d / 5) * 5 + 4} tiles away`);
    if (!home.has(site)) {
      add("road: the tile is on land the Hearthship's land does not reach (an island, or cut off by water)");
      continue;
    }
    const opens = (ok: (x: number) => boolean) =>
      near.some((ft) => {
        const p = land.findPath(ft, flag, ok, SEARCH_NODES);
        return !!p && p.length >= 3;
      });
    let found = false;
    let error: string | null = null;
    let fine = false;
    for (const ft of near) {
      const path = land.findPath(ft, flag, (x) => land.roadable(x, player) && x !== site, SEARCH_NODES);
      if (!path) continue;
      found = true;
      const e = path.length < 3 ? "the path is too short" : eco.checkRoad(path, player);
      if (!e) fine = true;
      else error ??= e;
    }
    if (fine) add("road: a road can be laid");
    else if (found) add(`road: a path exists but ${error}`);
    else {
      const all = new Set<number>(BLOCKS_ROAD);
      const alone = [
        ...OBSTACLES.filter(([, fs]) => opens(lifted(site, new Set(fs)))).map(([n]) => n),
        ...(opens(lifted(site, new Set(), { use: true })) ? ["own roads, flags or buildings"] : []),
        ...(opens(lifted(site, new Set(), { border: true })) ? ["the border (the way runs outside it)"] : []),
        ...(opens(lifted(site, new Set(), { slope: true })) ? ["steep ground"] : []),
      ];
      if (alone.length) add(`road: ${alone.join(" or ")} alone would open a way`);
      else if (opens(lifted(site, all))) add("road: several kinds of obstacle together");
      else if (opens(lifted(site, all, { use: true }))) add("road: obstacles and own roads or buildings together");
      else if (opens(lifted(site, all, { use: true, border: true, slope: true }))) add("road: obstacles, own works, the border and steep ground together");
      else if (near.some((ft) => !!land.findPath(ft, flag, lifted(site, all, { use: true, border: true, slope: true }), WIDE_NODES))) add(`road: with everything lifted only a longer search (${WIDE_NODES} nodes, not ${SEARCH_NODES}) finds a way: it is a long route`);
      else add("road: no route at all, even with everything lifted");
    }
  }
}
