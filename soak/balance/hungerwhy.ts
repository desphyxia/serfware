import { AiBuilder, aiOptions, aiTrace } from "../../src/sim/ai/builder";
import { BUILDINGS, buildingType, goodsFor, type BuildingDef } from "../../src/sim/econ/defs";
import { Feature, Use } from "../../src/sim/econ/landuse";
import { flagSides, placeConnected } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * Why a seat goes hungry: `node hungerwhy.mjs <size> <seed> <days>` plays the assess game (full AI stack, no war, three rivals) and,
 * per seat and 10-day window, prints the days the meal was missed, the people, the food in the warehouses (at the day's end),
 * the food buildings standing and under construction, the builder's own food cover (`foodCover`, the number the food-by-need
 * rule looks at; it adds food buildings below 1), the idle adults, and where the window's thoughts stopped (site cap, no
 * planks, no idle hands, the wants list), with the food buildings placed and the food wishes that found no site. At the end
 * it counts, per seat, the sites a food building would fit on at 9 to 24 tiles from the keep.
 * Diagnostic: needs the aiTrace hook in builder.ts; reads `foodCover` and the hunger flag, which are private.
 */
const [size, seed, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
aiTrace.on = true;
const brains: Record<number, AiBuilder> = {};
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => (brains[s.player] = new AiBuilder(s.player, s.rng, s.personality, s.level)),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const FOOD = goodsFor("food");
const FOOD_TYPES = ["fisher", "hunter", "orchard", "farm", "mill", "bakery", "apiary", "pasture", "butcher"];
const hungryNow = (p: number): boolean => !!(eco as unknown as { hungry: boolean[] }).hungry[p];
let cursor = 0;
const hungryDays: number[] = [0, 0, 0, 0];
const covers: number[][] = [[], [], [], []];
const idles: number[][] = [[], [], [], []];
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  for (let p = 1; p <= 3; p++) {
    if (hungryNow(p)) hungryDays[p]!++;
    covers[p]!.push((brains[p] as unknown as { foodCover: number }).foodCover);
    idles[p]!.push(eco.population(p).idle);
  }
  if (d % 10 !== 0) continue;
  for (let p = 1; p <= 3; p++) {
    const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
    const totals = eco.storageTotals(p);
    const food = FOOD.reduce((n, g) => n + (totals[g] as number), 0);
    const pop = eco.population(p);
    const count = (built: boolean) => FOOD_TYPES.map((t) => `${t}${mine.filter((b) => b.def.id === t && b.built === built).length || ""}`).filter((s) => /\d/.test(s)).join(" ");
    const rows = aiTrace.slice(cursor).filter((r) => r.pl === p);
    const stage: Record<string, number> = {};
    const placed: Record<string, number> = {};
    const failed: Record<string, number> = {};
    for (const r of rows) {
      stage[r.stage] = (stage[r.stage] ?? 0) + 1;
      if (r.placed && FOOD_TYPES.includes(r.placed)) placed[r.placed] = (placed[r.placed] ?? 0) + 1;
      for (const k of r.failed ? r.failed.split(",") : []) if (FOOD_TYPES.includes(k)) failed[k] = (failed[k] ?? 0) + 1;
    }
    const lowCover = covers[p]!.slice(-10).filter((c) => c < 1).length;
    const noIdle = idles[p]!.slice(-10).filter((i) => i < 1).length;
    const show = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(" ") || "-";
    console.log(
      `day ${d} seat ${p}: hungry ${hungryDays[p]}d people ${pop.idle + pop.working} idle ${pop.idle} food ${food} cover<1 ${lowCover}d idle<1 ${noIdle}d | standing ${count(true)} | building ${count(false) || "-"} | thoughts ${show(stage)} | food placed ${show(placed)} | food failed ${show(failed)}`,
    );
    hungryDays[p] = 0;
  }
  cursor = aiTrace.length;
}

// Where a new food building could stand now: tiles of the seat's own land around its keep that take the building (a flag side and
// level, free ground), by reach. The builder looks 2 to 9 tiles out (`near`) and, with `widePlacement`, out to 16 in its own land;
// "tried" is a real placeConnected call as the wish makes it (this places a farm, so it comes last).
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const out: string[] = [];
  for (const type of ["farm", "orchard", "fisher", "hunter"]) {
    const def = BUILDINGS[buildingType(type)] as BuildingDef;
    const fits: string[] = [];
    for (const reach of [9, 12, 16, 24]) {
      let n = 0;
      for (const t of w.land.ring(keep.tile, reach)) {
        if (w.land.territory[t] !== p + 1) continue;
        const flag = w.land.bestFlagTile(t, p);
        if (flag >= 0 && w.land.canBuildDef(t, flag, def, p)) n++;
      }
      fits.push(`${reach}:${n}`);
    }
    out.push(`${type} ${fits.join(",")}`);
  }
  const tried = placeConnected(w, "farm", { minDist: 2, maxDist: 9, player: p, splitRoads: true });
  console.log(`end seat ${p}: own-land sites by reach from the keep: ${out.join(" | ")} | farm tried: ${tried ? "placed" : "no site"}`);
}

// Why the sites found above take no building: for every own-land tile within 16 of a seat's keep that takes a farm, the first thing that
// stops placeOn's plan for each flag side (as planSide asks): a building already on the flag, no path to any of the six nearest flags, or what checkRoad says.
const why: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const def = BUILDINGS[buildingType("farm")] as BuildingDef;
  const c = w.land.planet.grid.center;
  const flags = eco.flags.filter((f) => f.alive && f.owner === p);
  for (const t of w.land.ring(keep.tile, 16)) {
    if (w.land.territory[t] !== p + 1) continue;
    for (const side of flagSides(w, t, def, p)) {
      const existing = eco.flagAt(side);
      const add = (k: string) => (why[p]![k] = (why[p]![k] ?? 0) + 1);
      if (existing && existing.building >= 0) {
        add("flag already serves a building");
        continue;
      }
      const near = flags
        .filter((f) => f.tile !== side)
        .map((f) => [((c[f.tile * 3] as number) - (c[side * 3] as number)) ** 2 + ((c[f.tile * 3 + 1] as number) - (c[side * 3 + 1] as number)) ** 2 + ((c[f.tile * 3 + 2] as number) - (c[side * 3 + 2] as number)) ** 2, f.tile] as const)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 6);
      let ok = false;
      const errs = new Set<string>();
      for (const [, ft] of near) {
        const path = w.land.findPath(ft, side, (x) => w.land.roadable(x, p) && x !== t, 1500);
        if (!path || path.length < 3) {
          errs.add("no path");
          continue;
        }
        const e = eco.checkRoad(path, p);
        if (e) errs.add(String(e));
        else ok = true;
      }
      add(ok ? "a road can join it" : existing ? `existing flag, no road (${[...errs].join("; ")})` : `no road (${[...errs].join("; ")})`);
    }
  }
  console.log(`why seat ${p}: ${Object.entries(why[p]!).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
}

// Is "no path" the six-nearest-flags limit or the ground? The same farm sites, tried from every flag of the seat with a wide search.
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const def = BUILDINGS[buildingType("farm")] as BuildingDef;
  const flags = eco.flags.filter((f) => f.alive && f.owner === p);
  const res: Record<string, number> = {};
  for (const t of w.land.ring(keep.tile, 16)) {
    if (w.land.territory[t] !== p + 1) continue;
    const side = flagSides(w, t, def, p)[0];
    if (side === undefined) continue;
    let best = "none";
    for (const f of flags) {
      if (f.tile === side) continue;
      const path = w.land.findPath(f.tile, side, (x) => w.land.roadable(x, p) && x !== t, 20000);
      if (!path || path.length < 3) continue;
      const e = eco.checkRoad(path, p);
      if (!e) {
        best = "a road joins it from some flag";
        break;
      }
      best = `a path exists but ${String(e)}`;
    }
    res[best] = (res[best] ?? 0) + 1;
  }
  console.log(`wide seat ${p}: ${Object.entries(res).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
}

// What walls those sites off: the pocket of walkable ground round each unreachable site (a flood over tiles a road may use), its size, whether
// any flag of the seat stands in it, and what the tiles just outside it are (a road, a building, trees, a field, rock, a slope, water, foreign land).
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const def = BUILDINGS[buildingType("farm")] as BuildingDef;
  const grid = w.land.planet.grid;
  const flagTiles = new Set(eco.flags.filter((f) => f.alive && f.owner === p).map((f) => f.tile));
  const pockets = new Map<number, { size: number; flag: boolean }>();
  const wall: Record<string, number> = {};
  const seenSite = new Set<number>();
  for (const t of w.land.ring(keep.tile, 16)) {
    if (w.land.territory[t] !== p + 1) continue;
    const side = flagSides(w, t, def, p)[0];
    if (side === undefined || seenSite.has(side)) continue;
    seenSite.add(side);
    const seen = new Set<number>([side]);
    const stack = [side];
    let flag = false;
    while (stack.length && seen.size < 3000) {
      const x = stack.pop() as number;
      for (const n of grid.neighborsOf(x)) {
        if (flagTiles.has(n)) flag = true;
        if (seen.has(n)) continue;
        if (w.land.roadable(n, p) && n !== t) {
          seen.add(n);
          stack.push(n);
        } else if (n !== t) {
          const kind =
            !w.land.isLand(n) ? "water"
            : w.land.territory[n] !== p + 1 ? "foreign or free land"
            : w.land.use[n] === Use.Road ? "road"
            : w.land.use[n] === Use.Flag ? "flag"
            : w.land.use[n] === Use.Building ? "building"
            : w.land.feature[n] === Feature.Tree ? "tree"
            : w.land.feature[n] === Feature.Field ? "field"
            : w.land.feature[n] === Feature.Rock ? "rock"
            : w.land.slope(n) >= 2.2 ? "steep"
            : "other";
          wall[kind] = (wall[kind] ?? 0) + 1;
        }
      }
    }
    const key = Math.min(...seen);
    pockets.set(key, { size: seen.size, flag });
  }
  const list = [...pockets.values()].sort((a, b) => b.size - a.size).map((q) => `${q.size}${q.flag ? "+flag" : ""}`);
  console.log(`pockets seat ${p}: ${list.slice(0, 8).join(" ")} | tiles around them: ${Object.entries(wall).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
