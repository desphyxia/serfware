import type { World } from "../world";
import { BUILDINGS, buildingType, GOOD_INDEX, goodsFor, type BuildingDef } from "./defs";
import { aiOptions } from "../ai/options";
import { Feature, Use } from "./landuse";

/** With `widePlacement`: lit lanterns tried as centres after the first search finds nothing, and how far from the Hearthship the last try reaches. */
const WIDE_CENTRES = 3;
const WIDE_REACH = 16;
/** With `aiOptions.warmFarms`: what a farm or orchard site gains from land frozen all year to growing all year (ring k from the centre costs about k(k+1)/2). */
const WARM_FARM = 30;

/**
 * Simple site planner: finds a spot for a building near the keep and connects it with a road.
 * Used by the debug "starter chain" action and later by the AI builder.
 *
 * With `aiOptions.widePlacement`, when the ring round the centre (the keep unless `center` is given) holds no spot, the search
 * goes on: first within the same reach of up to WIDE_CENTRES of the lit lanterns (a different few every quarter day), then
 * anywhere in the player's own land out to WIDE_REACH steps from the keep, nearest first. The first search is unchanged, so a
 * building that had room is placed exactly where it was.
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
  const minDist = opts.minDist ?? 2;
  const reach = (t: number) => {
    let n = 0;
    for (const x of land.ring(t, 6)) if (land.feature[x] === opts.near && (opts.near !== Feature.Rock || (land.amount[x] as number) > 0)) n++;
    return n;
  };
  const score = (t: number) => {
    if (opts.near === undefined) return 0;
    let n = 0;
    for (const x of land.ring(t, 4)) if (land.feature[x] === opts.near) n++;
    return -n;
  };
  // With `aiOptions.warmFarms`: farms and orchards where the growing season is long (their fields and fruit wait in the cold).
  const climate = aiOptions.warmFarms && (type === "farm" || type === "orchard") ? w.climate : null;
  const warmth = (t: number) => {
    if (!climate) return 0;
    let sum = 0;
    let n = 0;
    for (const x of [land.pt(t), ...land.ring(t, 3)])
      if (land.isLand(x)) {
        sum += climate.growingGuess(x);
        n++;
      }
    return n ? (WARM_FARM * sum) / n : 0;
  };
  /** The tiles of a ring round `center`, best first: close to it, and (with `near`) with plenty of that feature about. */
  const rank = (center: number, maxDist: number, ownOnly: boolean): number[] => {
    const inner = new Set(land.ring(center, minDist - 1));
    const candidates = land.ring(center, maxDist).filter((t) => !inner.has(t) && (!ownOnly || land.territory[t] === player + 1) && (opts.near === undefined || !opts.need || reach(t) >= opts.need));
    // Prefer good spots close to home: each ring step away costs about one tree's worth.
    return candidates
      .map((t, i) => [Math.max(score(t), -6) - warmth(t) + i / 6, t] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, t]) => t);
  };
  const splitRoads = opts.splitRoads ?? false;
  const maxDist = opts.maxDist ?? 8;
  if (placeOn(w, type, rank(opts.center ?? keep.tile, maxDist, false), player, splitRoads) >= 0) return true;
  if (!aiOptions.widePlacement) return false;
  const lanterns = eco.buildings
    .filter((b) => b.alive && b.built && b.owner === player && b.lit && b.def.slots)
    .map((b) => b.tile)
    .sort((a, b) => a - b);
  const first = Math.floor((w.tick / eco.dayTicks) * 4);
  for (let i = 0; i < Math.min(WIDE_CENTRES, lanterns.length); i++) {
    if (placeOn(w, type, rank(lanterns[(first + i) % lanterns.length] as number, maxDist, true), player, splitRoads) >= 0) return true;
  }
  return placeOn(w, type, rank(keep.tile, Math.max(maxDist, WIDE_REACH), true), player, splitRoads) >= 0;
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

/** With `reserveRail`: the site kept free for a seat's launch rail, and the tiles a large building there needs. */
const held = new WeakMap<World, Map<number, { tile: number; tiles: Set<number> }>>();
/** Tiles tried when looking for a site to keep, and the finished buildings a seat needs before it keeps one. */
const SITE_TRIES = 60;

/** The tiles `placeOn` keeps off for `player` while a site is reserved (none when `reserveRail` is off). */
function heldTiles(w: World, player: number): Set<number> | undefined {
  return aiOptions.reserveRail ? held.get(w)?.get(player)?.tiles : undefined;
}

/** The tile reserved for `player`'s building, or -1. */
export function reservedSite(w: World, player: number): number {
  return held.get(w)?.get(player)?.tile ?? -1;
}

/** Let go of the reserved site (it is about to be built on, or no longer fits). */
export function releaseSite(w: World, player: number): void {
  held.get(w)?.delete(player);
}

/**
 * Choose a site for a large building of `type` and keep the AI off it: the first tile, nearest the keep, out to WIDE_REACH
 * steps inside the seat's own land where the building fits and a road can reach it. The tile and its ring are held (a large
 * building needs its other neighbours clear), so `placeOn` skips them as building tiles, flag sides and road tiles. Returns the
 * tile, or -1 when none fits. The hold is dropped by `releaseSite`, which `placeConnected` callers do before building there.
 */
export function reserveSite(w: World, type: string, player: number): number {
  const eco = w.economy;
  const land = w.land;
  const keep = eco.buildings[eco.keeps[player] ?? -1];
  if (!keep) return -1;
  const def = BUILDINGS[buildingType(type)] as BuildingDef;
  const inner = new Set(land.ring(keep.tile, 1));
  let landmass: Set<number> | undefined;
  const home = () => (landmass ??= landmassOf(w, keep.tile));
  let tries = 0;
  for (const t of land.ring(keep.tile, WIDE_REACH)) {
    if (inner.has(t) || land.territory[t] !== player + 1) continue;
    const sides = flagSides(w, t, def, player);
    if (!sides.length) continue;
    if (++tries > SITE_TRIES) break;
    if (!sides.some((side) => planSide(w, def, t, side, player, home, null))) continue;
    const tiles = new Set([t, ...land.planet.grid.neighborsOf(t)]);
    let byPlayer = held.get(w);
    if (!byPlayer) held.set(w, (byPlayer = new Map()));
    byPlayer.set(player, { tile: t, tiles });
    return t;
  }
  return -1;
}

/** Most partner buildings a side is scored against (the nearest ones). */
const PARTNERS = 2;

/** Does a producer's output feed a consumer's input key (a good id, or a group such as "food")? */
function feeds(producer: BuildingDef, consumer: BuildingDef): boolean {
  if (!producer.produces || !consumer.inputs || !GOOD_INDEX.has(producer.produces)) return false;
  const good = GOOD_INDEX.get(producer.produces) as number;
  return Object.keys(consumer.inputs).some((key) => goodsFor(key).includes(good));
}

/** Flag tiles of the player's buildings a building of `def` trades with: those that feed it or take what it makes, and the stores. */
function partnerFlags(w: World, def: BuildingDef, player: number): number[] {
  const out: number[] = [];
  for (const b of w.economy.buildings) {
    if (!b.alive || b.owner !== player) continue;
    if (feeds(b.def, def) || feeds(def, b.def) || (b.def.storage && !!def.produces)) out.push((w.economy.flags[b.flag] as { tile: number }).tile);
  }
  return out;
}

/** Straight-line distance between two tiles in tile spacings (about the steps a settler walks). */
function stepsBetween(w: World, a: number, b: number): number {
  const land = w.land;
  const grid = land.planet.grid;
  // A node is a tile, or on the road lattice a tile corner: its position is the lattice's.
  const c = land.lattice ? land.lattice.pos : grid.center;
  const d = (x: number, y: number) => {
    const dx = (c[x * 3] as number) - (c[y * 3] as number);
    const dy = (c[x * 3 + 1] as number) - (c[y * 3 + 1] as number);
    const dz = (c[x * 3 + 2] as number) - (c[y * 3 + 2] as number);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const tile = land.pt(a);
  const unit = d(tile, grid.neighborsOf(tile)[0] as number) || 1;
  return d(a, b) / unit;
}

/**
 * The sides a building of `def` on tile `t` can have its flag on: the default one (`bestFlagTile`) first, then every other
 * neighbour a flag can stand on (or a free flag of ours already there) from which the building can be built. The side
 * changes what fits too: a large building needs its other neighbours clear, and its flag side is the one exception.
 */
export function flagSides(w: World, t: number, def: BuildingDef, player: number): number[] {
  const land = w.land;
  const first = land.bestFlagTile(t, player);
  const out: number[] = [];
  if (first >= 0 && land.canBuildDef(t, first, def, player)) out.push(first);
  for (const n of land.nbrs(t)) {
    if (n === first) continue;
    if (land.use[n] === Use.Flag) {
      if (land.ownerOf(n) !== player + 1 || land.flagServes?.(n)) continue;
    } else if (!land.canPlaceFlag(n, player)) continue;
    if (land.canBuildDef(t, n, def, player)) out.push(n);
  }
  return out;
}

/** What it takes to put a building on tile `t` with its flag on `flagTile`: the road that joins it, and the score of that side (lower is better). */
export interface SidePlan {
  flagTile: number;
  /** A flag already stands there; it may carry roads already. */
  existing: ReturnType<World["economy"]["flagAt"]>;
  /** The new road from the nearest flag that joins the network, or null. */
  road: number[] | null;
  cost: number;
}

/**
 * Plan one side: join its flag to one of the nearest flags (by straight-line distance) that a road can reach, as `placeOn` has
 * always done. The score is the new road's length (none when the flag already carries a road), plus, with `turnBuildings`,
 *  times the distance to the nearest PARTNERS buildings it trades with, plus a hair for the height step.
 */
function planSide(w: World, def: BuildingDef, t: number, flagTile: number, player: number, home: () => Set<number>, partners: number[] | null): SidePlan | null {
  const eco = w.economy;
  const land = w.land;
  // A flag may stand on a tile corner on the road lattice: positions are the lattice's, not the grid's.
  const c = land.lattice ? land.lattice.pos : land.planet.grid.center;
  const existing = eco.flagAt(flagTile);
  if (existing && existing.building >= 0) return null;
  const hold = heldTiles(w, player);
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
  let road: number[] | null = null;
  for (const [, ft] of near) {
    const path = land.findPath(ft, flagTile, (x) => land.roadable(x, player) && x !== t && !hold?.has(x), 1500);
    if (!path || path.length < 3 || eco.checkRoad(path, player)) continue;
    if (!road || path.length < road.length) road = path;
  }
  if (!road && !existing) return null;
  let cost = 0;
  if (partners) {
    cost = existing && existing.roads.length > 0 ? 0 : road ? road.length - 1 : 30;
    const steps = partners.map((pt) => stepsBetween(w, flagTile, pt)).sort((a, b) => a - b);
    for (let i = 0; i < Math.min(PARTNERS, steps.length); i++) cost += (aiOptions.turnPartnerWeight * (steps[i] as number)) / Math.min(PARTNERS, steps.length);
    cost += Math.abs((land.planet.terrain.elevation[land.pt(flagTile)] as number) - (land.planet.terrain.elevation[land.pt(t)] as number)) * 0.1;
    // A new flag takes the free tiles beside it out of use for flags and, with them, for buildings; one on a flag that stands takes none.
    if (aiOptions.turnBlockWeight > 0 && !existing) {
      let blocked = 0;
      for (const n of land.nbrs(flagTile)) if (n !== t && land.roadable(n, player) && land.use[n] === Use.Free) blocked++;
      cost += aiOptions.turnBlockWeight * blocked;
    }
  }
  return { flagTile, existing, road, cost };
}

/**
 * Try candidate tiles in order: build `type` on the first that fits and connect its flag to the
 * nearest reachable flag of the player. Returns the tile used, or -1.
 *
 * With `aiOptions.turnBuildings` the flag side is chosen too (a player turns it with the mouse wheel): every side the
 * building can have is planned and the cheapest taken (see `planSide`), the default side winning ties. Without it the
 * side is always `bestFlagTile`'s.
 */
export function placeOn(w: World, type: string, tiles: readonly number[], player: number, splitRoads = false, maxTries = 60): number {
  const eco = w.economy;
  const land = w.land;
  const def = BUILDINGS[buildingType(type)] as BuildingDef;
  const turn = aiOptions.turnBuildings;
  let tries = 0;
  // The land the Hearthship stands on (found when first needed): a flag there that no road joins to it is a dead end.
  let landmass: Set<number> | undefined;
  const home = () => (landmass ??= landmassOf(w, eco.buildings[eco.keeps[player] ?? -1]?.tile ?? 0));
  const partners = turn ? partnerFlags(w, def, player) : null;
  const hold = heldTiles(w, player);
  for (const t of tiles) {
    if (hold?.has(t)) continue;
    let sides: number[];
    if (turn) sides = flagSides(w, t, def, player);
    else {
      const flagTile = land.bestFlagTile(t, player);
      sides = flagTile < 0 || !land.canBuildDef(t, flagTile, def, player) ? [] : [flagTile];
    }
    if (hold) sides = sides.filter((s) => !hold.has(s));
    if (!sides.length) continue;
    const first = eco.flagAt(sides[0] as number);
    if (!turn && first && first.building >= 0) continue;
    if (++tries > maxTries) break;
    let best: SidePlan | null = null;
    for (const side of sides) {
      const plan = planSide(w, def, t, side, player, home, partners);
      if (plan && (!best || plan.cost < best.cost)) best = plan;
    }
    if (!best) continue;
    const { flagTile, existing, road } = best;
    if (!w.command({ t: "build", type, tile: t, flagTile, player }).ok) continue;
    if (road && !(existing && existing.roads.length > 0)) {
      if (w.command({ t: "road", tiles: road, player }).ok && splitRoads) {
        // More flags on long roads mean more carriers and fewer queues.
        // Lattice nodes lie half as far apart, so the same walking distance takes twice the nodes.
        const gap = land.lattice ? 8 : 4;
        if (road.length > 2 * gap) for (let i = gap; i < road.length - (gap - 1); i += gap) w.command({ t: "flag", tile: road[i] as number, player });
      }
    }
    return t;
  }
  return -1;
}

/**
 * `keepRoads`: one more road from the flag of `player`'s keep to the nearest flag of the seat's own that it does not join yet, over free
 * ground, when the keep's flag has fewer than `want` roads. A road is at most `maxNodes` nodes (lattice nodes lie half as far apart). Every
 * good bound for a store passes the flag of the nearest one, so a keep flag with one road carries the seat's whole traffic on one
 * carrier. True when a road was placed.
 */
export function connectKeepFlag(w: World, player: number, want: number, maxNodes: number): boolean {
  const eco = w.economy;
  const land = w.land;
  const keep = eco.buildings[eco.keeps[player] ?? -1];
  const kf = keep?.alive ? eco.flags[keep.flag] : undefined;
  if (!kf?.alive || kf.roads.length >= want) return false;
  const joined = new Set<number>([kf.id]);
  for (const id of kf.roads) {
    const r = eco.roads[id];
    if (r) joined.add(r.a === kf.id ? r.b : r.a);
  }
  const at = land.nodePos(kf.tile);
  const dist = (t: number): number => {
    const p = land.nodePos(t);
    return (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
  };
  const hold = heldTiles(w, player);
  const near = eco.flags
    .filter((f) => f.alive && f.owner === player && !joined.has(f.id))
    .map((f) => ({ f, d: dist(f.tile) }))
    .sort((a, b) => a.d - b.d || a.f.id - b.f.id)
    .slice(0, 12);
  for (const { f } of near) {
    const path = land.findPath(kf.tile, f.tile, (n) => land.roadable(n, player) && !hold?.has(n), 200);
    if (path && path.length >= 2 && path.length <= maxNodes && w.command({ t: "road", tiles: path, player }).ok) return true;
  }
  return false;
}

/**
 * `rejoinRoads`: a road from the flag of one of `player`'s buildings that no road route joins to the Hearthship (a captured lantern
 * building, say) to the nearest flag that is joined, over free ground. Lantern buildings
 * come first, the most threatened first, then any other building or site. A building that only a closed ice road cuts off is left
 * to the next hard frost, which opens the road again. Buildings in `skip` (id to the tick before which they are not
 * tried again) are passed over, and one with no road found is added to it for `retryTicks`. Long roads get flags every few nodes, as
 * `placeOn` lays them. True when a road was placed.
 */
export function rejoinCutOff(w: World, player: number, skip: Map<number, number>, retryTicks: number): boolean {
  const eco = w.economy;
  const land = w.land;
  const keepFlag = eco.buildings[eco.keeps[player] ?? -1]?.flag ?? -1;
  if (keepFlag < 0 || !eco.flags[keepFlag]?.alive) return false;
  // Routes are cached per destination, so asking each flag's way to the keep flag is one search.
  const joined = (f: number) => eco.route(f, keepFlag).dist < Infinity;
  // A building that only a closed ice road cuts off is joined again at the next hard frost: no road round the lake for it.
  const overIce = new Set<number>([keepFlag]);
  for (const queue = [keepFlag]; queue.length; ) {
    for (const rid of eco.flags[queue.pop() as number]?.roads ?? []) {
      const r = eco.roads[rid];
      if (!r?.alive) continue;
      for (const f of [r.a, r.b]) {
        if (overIce.has(f)) continue;
        overIce.add(f);
        queue.push(f);
      }
    }
  }
  const cut = eco.buildings
    .filter((b) => b.alive && b.owner === player && b.flag >= 0 && b.flag !== keepFlag && (skip.get(b.id) ?? 0) <= w.tick && !overIce.has(b.flag) && !joined(b.flag))
    .sort((a, b) => (b.def.slots ? 1 : 0) - (a.def.slots ? 1 : 0) || b.threat - a.threat || a.id - b.id);
  if (!cut.length) return false;
  const c = land.lattice ? land.lattice.pos : land.planet.grid.center;
  const d2 = (s: number, t: number) => ((c[s * 3] as number) - (c[t * 3] as number)) ** 2 + ((c[s * 3 + 1] as number) - (c[t * 3 + 1] as number)) ** 2 + ((c[s * 3 + 2] as number) - (c[t * 3 + 2] as number)) ** 2;
  const home = eco.flags.filter((f) => f.alive && f.owner === player && joined(f.id));
  const hold = heldTiles(w, player);
  const gap = land.lattice ? 8 : 4;
  for (const b of cut.slice(0, 3)) {
    const ft = (eco.flags[b.flag] as { tile: number }).tile;
    let road: number[] | null = null;
    for (const f of home.map((f) => ({ t: f.tile, d: d2(f.tile, ft) })).sort((x, y) => x.d - y.d || x.t - y.t).slice(0, 6)) {
      const path = land.findPath(f.t, ft, (x) => land.roadable(x, player) && !hold?.has(x), 1500);
      if (!path || path.length < 3) continue;
      if (!road || path.length < road.length) road = path;
    }
    if (road && layInLegs(w, road, player, gap)) return true;
    skip.set(b.id, w.tick + retryTicks);
  }
  return false;
}

/**
 * Lay `path` (from one flag to another over free ground) as roads of at most `gap` steps, with a flag at the end of each leg, as a
 * player adds flags along a road too long for one. A leg ends on the farthest node a flag can stand on. True when the first leg was
 * laid: a road left short of its end joins what it reaches, and the next try goes on from there.
 */
function layInLegs(w: World, path: readonly number[], player: number, gap: number): boolean {
  const land = w.land;
  const last = path.length - 1;
  let i = 0;
  while (i < last) {
    let j = Math.min(i + gap, last);
    if (j < last) while (j > i + 2 && !land.canPlaceFlag(path[j] as number, player)) j--;
    if (j < last && !(land.canPlaceFlag(path[j] as number, player) && w.command({ t: "flag", tile: path[j] as number, player }).ok)) return i > 0;
    if (!w.command({ t: "road", tiles: path.slice(i, j + 1), player }).ok) return i > 0;
    i = j;
  }
  return true;
}

/** The side `placeOn` would choose for `def` on tile `t` with `turnBuildings` on, with its score and the default side's (for tests and probes). */
export function chooseSide(w: World, def: BuildingDef, t: number, player: number): { flagTile: number; cost: number; defaultSide: number; defaultCost: number } | null {
  const eco = w.economy;
  let landmass: Set<number> | undefined;
  const home = () => (landmass ??= landmassOf(w, eco.buildings[eco.keeps[player] ?? -1]?.tile ?? 0));
  const partners = partnerFlags(w, def, player);
  const sides = flagSides(w, t, def, player);
  let best: SidePlan | null = null;
  let first: SidePlan | null = null;
  sides.forEach((side, i) => {
    const plan = planSide(w, def, t, side, player, home, partners);
    if (i === 0) first = plan;
    if (plan && (!best || plan.cost < best.cost)) best = plan;
  });
  const b = best as SidePlan | null;
  const f = first as SidePlan | null;
  return b ? { flagTile: b.flagTile, cost: b.cost, defaultSide: sides[0] as number, defaultCost: f ? f.cost : Infinity } : null;
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
 * A lantern for the border could not be placed on any of `tiles` (frontier tiles): where a tree is what stands in the way
 * (on the tile, on every spot for its flag, or across the road to it), put a woodcutter within reach of that tree.
 * Skips a tree that a woodcutter of ours already reaches. Returns true when a woodcutter site was placed.
 */
export function clearForBorder(w: World, player: number, tiles: readonly number[]): boolean {
  const eco = w.economy;
  const land = w.land;
  const grid = land.planet.grid;
  // A flag can sit on a tile corner on the road lattice: its position is the lattice's, and a corner has no feature of its own.
  const c = land.lattice ? land.lattice.pos : grid.center;
  const featureAt = (x: number) => (x < land.tileCount ? land.feature[x] : Feature.None);
  const lantern = BUILDINGS[buildingType("lantern")] as BuildingDef;
  const flags = eco.flags.filter((f) => f.alive && f.owner === player);
  if (!flags.length) return false;
  const cutters = eco.buildings.filter((b) => b.alive && b.owner === player && b.def.id === "woodcutter");
  const d2 = (a: number, b: number) => (c[a * 3]! - c[b * 3]!) ** 2 + (c[a * 3 + 1]! - c[b * 3 + 1]!) ** 2 + (c[a * 3 + 2]! - c[b * 3 + 2]!) ** 2;
  const nearestFlags = (t: number, n: number) =>
    flags
      .map((f) => [d2(f.tile, t), f.tile] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, n)
      .map(([, ft]) => ft);
  const open = (x: number) => land.roadable(x, player);
  const throughTrees = (x: number) => open(x) || (land.isLand(x) && land.mayRoad(x, player) && land.use[x] === Use.Free && featureAt(x) === Feature.Tree);
  for (const t of tiles.slice(0, 12)) {
    const ft = land.bestFlagTile(t, player);
    let blocker = -1;
    if (land.feature[t] === Feature.Tree) blocker = t;
    else if (ft < 0) blocker = grid.neighborsOf(t).find((n) => land.feature[n] === Feature.Tree && land.territory[n] === player + 1) ?? -1;
    else if (land.canBuildDef(t, ft, lantern, player)) {
      const sources = nearestFlags(ft, 4);
      if (sources.some((s) => land.findPath(s, ft, (x) => open(x) && x !== t, 1500))) continue;
      let best: number[] | null = null;
      for (const s of sources) {
        const path = land.findPath(s, ft, (x) => throughTrees(x) && x !== t, 1500);
        if (path && (!best || path.length < best.length)) best = path;
      }
      blocker = best?.find((x) => featureAt(x) === Feature.Tree) ?? -1;
    }
    if (blocker < 0) continue;
    const reached = new Set(land.ring(blocker, 6));
    if (cutters.some((b) => reached.has(b.tile))) continue;
    // Close to the tree first; a woodcutter reaches 6 tiles, so anything within 5 will do.
    const sites = land.ring(blocker, 5).filter((x) => land.territory[x] === player + 1).sort((a, b) => d2(a, blocker) - d2(b, blocker) || a - b);
    if (placeOn(w, "woodcutter", sites, player, true, 40) >= 0) return true;
  }
  return false;
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
  // A flag can sit on a tile corner on the road lattice: its position is the lattice's, and a corner has no feature of its own.
  const c = land.lattice ? land.lattice.pos : grid.center;
  const featureAt = (x: number) => (x < land.tileCount ? land.feature[x] : Feature.None);
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
  const through = (x: number) => open(x) || (land.isLand(x) && land.mayRoad(x, player) && land.use[x] === Use.Free && (featureAt(x) === Feature.Tree || featureAt(x) === Feature.Rock));
  for (const [, t, ft] of targets.slice(0, 12)) {
    const sources = nearestFlags(ft, 4);
    if (sources.some((s) => land.findPath(s, ft, (x) => open(x) && x !== t, 1500))) return null;
    let best: number[] | null = null;
    for (const s of sources) {
      const path = land.findPath(s, ft, (x) => through(x) && x !== t, 1500);
      if (path && (!best || path.length < best.length)) best = path;
    }
    if (!best) continue;
    const blocker = best.find((x) => featureAt(x) === Feature.Tree || featureAt(x) === Feature.Rock);
    if (blocker === undefined) continue;
    const type = featureAt(blocker) === Feature.Tree ? "woodcutter" : "quarry";
    // Close to the blocker first; a woodcutter reaches 6 tiles, so anything within 5 will do.
    const sites = land.ring(blocker, 5).filter((x) => land.territory[x] === player + 1).sort((a, b) => d2(a, blocker) - d2(b, blocker) || a - b);
    if (placeOn(w, type, sites, player, true, 40) >= 0) return "built";
    // No reachable site: the foresters are probably planting faster than the woodcutters fell. Take one down.
    const foresters = eco.buildings.filter((b) => b.alive && b.owner === player && b.def.id === "forester");
    // The last forester stays: without one the woods are never replanted.
    const forester = foresters.length > 1 ? foresters.sort((a, b) => d2(a.tile, blocker) - d2(b.tile, blocker) || a.id - b.id)[0] : undefined;
    if (forester && w.command({ t: "demolish", tile: forester.tile, player }).ok) return "forester";
  }
  return null;
}
