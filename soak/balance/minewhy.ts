import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { BUILDINGS, buildingType, goodId, type BuildingDef } from "../../src/sim/econ/defs";
import { Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * Why a seat with every gate open does not place a mine: `node minewhy.mjs <size> <seed> <rivals> <seat> <kind> <from> <to>`
 * plays the pilot-6 AI and, on each day from `from` to `to`, prints for one seat: how often the builder reached the mine
 * step and how often that step gave an order, the rests that hold the mine family back, and for every free sign tile of the
 * kind (2 coal, 3 iron, 4 gold, 5 granite) the first reason `placeOn` (econ/planner.ts) would turn it down. Read-only.
 */
const [size, seed, rivals, seatArg, kindArg, fromArg, toArg] = process.argv.slice(2) as [string, string, string, string, string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
// BALANCE_EXTRA="tools,ore" adds the experimental switches on top of the pilot 6 ones.
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
const n = Number(rivals);
const seat = Number(seatArg);
const kind = Number(kindArg);
// BALANCE_TYPE=smelter checks the reasons for that building instead (on the tiles within 9 of the keep, as placeConnected looks).
const MINE = (process.env.BALANCE_TYPE ?? { 2: "coalmine", 3: "ironmine", 4: "goldmine", 5: "granitemine" }[kind]) as string;
type Planner = { step: (ctx: unknown, th: number) => boolean; rest: Map<string, number>; thoughts: number };
type Inner = { econ: Planner; resting: Map<string, number>; thoughts: number };
const brains: Record<number, Inner> = {};
const calls = { reached: 0, gave: 0 };
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden", "builder", "trader", "warden"].slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => {
    const b = new AiBuilder(s.player, s.rng, s.personality, s.level);
    const inner = b as unknown as Inner;
    brains[s.player] = inner;
    if (s.player === seat) {
      const econ = inner.econ;
      const step = econ.step.bind(econ);
      econ.step = (ctx, th) => {
        calls.reached++;
        const r = step(ctx, th);
        if (r) calls.gave++;
        return r;
      };
    }
    return b;
  },
} as never);
w.command({ t: "steward", of: 0, on: true });
// Orders the seat gave today, by kind (what the mine step's gives were: hedges, geologists, ...).
const orders: Record<string, number> = {};
const command = w.command.bind(w);
w.command = ((cmd: { t: string; player?: number }) => {
  const r = command(cmd as never);
  if (cmd.player === seat && (r as { ok: boolean }).ok) orders[cmd.t] = (orders[cmd.t] ?? 0) + 1;
  return r;
}) as typeof w.command;
const eco = w.economy;
const land = w.land;
const grid = land.planet.grid;
const c = grid.center;
const def = BUILDINGS[buildingType(MINE)] as BuildingDef;

/** The first reason placeOn would skip the tile, mirroring planner.ts. */
function why(t: number, player: number): string {
  const flagTile = land.bestFlagTile(t, player);
  if (flagTile < 0) return "no flag spot";
  if (!land.canBuildDef(t, flagTile, def, player)) return `cannot build (slope ${land.slope(t).toFixed(1)})`;
  const existing = eco.flagAt(flagTile);
  if (existing && existing.building >= 0) return "flag spot taken by a building";
  const mine = eco.flags.filter((f) => f.alive && f.owner === player && f.tile !== flagTile);
  const d2 = (ft: number) => (c[ft * 3]! - c[flagTile * 3]!) ** 2 + (c[ft * 3 + 1]! - c[flagTile * 3 + 1]!) ** 2 + (c[ft * 3 + 2]! - c[flagTile * 3 + 2]!) ** 2;
  const near = mine.map((f) => [d2(f.tile), f.tile] as const).sort((a, b) => a[0] - b[0]).slice(0, 6);
  const errs: string[] = [];
  let best = Infinity;
  for (const [, ft] of near) {
    const path = land.findPath(ft, flagTile, (x) => land.roadable(x, player) && x !== t, 1500);
    if (!path) { errs.push("no path"); continue; }
    if (path.length < 3) { errs.push("path under 3"); continue; }
    const err = eco.checkRoad(path, player);
    if (err) { errs.push(`${err} (${path.length} tiles)`); continue; }
    best = Math.min(best, path.length);
  }
  if (best < Infinity) return `placeable (road ${best} tiles)`;
  const tally = new Map<string, number>();
  for (const e of errs) tally.set(e, (tally.get(e) ?? 0) + 1);
  return `no road: ${[...tally].map(([e, k]) => `${e} x${k}`).join("; ")}`;
}

const from = Number(fromArg);
const to = Number(toArg);
for (let d = 1; d <= to && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  calls.reached = 0;
  calls.gave = 0;
  for (const k of Object.keys(orders)) delete orders[k];
  while (w.tick < stop && eco.winner < 0) w.step();
  if (d < from) continue;
  const brain = brains[seat] as Inner;
  const mine = eco.buildings.filter((b) => b.alive && b.owner === seat);
  const tiles: number[] = [];
  for (let t = 0; t < land.sign.length; t++) if (land.sign[t] === kind &&land.territory[t] === seat + 1 && land.use[t] === Use.Free && !land.signSmall[t]) tiles.push(t);
  const reasons = new Map<string, number>();
  for (const t of tiles) {
    const r = why(t, seat);
    const key = r.replace(/\(slope [0-9.]+\)/, "").replace(/\(\d+ tiles\)/g, "").replace(/\(road \d+ tiles\)/, "");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  // What the sign tiles are like, and what a mine could do on the tiles within two steps of them (a mine digs within two).
  const facts = tiles.slice(0, 4).map((t) => ({ mountain: land.isMountain(t), slope: Number(land.slope(t).toFixed(2)), feature: land.feature[t], elev: Number((grid.center ? (land.planet.terrain.elevation[t] as number) : 0).toFixed(2)) }));
  const near = new Set<number>();
  for (const s of tiles) for (const t of land.ring(s, 2)) if (land.territory[t] === seat + 1 && land.use[t] === Use.Free && land.isMountain(t)) near.add(t);
  const viaReach = new Map<string, number>();
  for (const t of near) {
    const key = why(t, seat).replace(/\(slope [0-9.]+\)/, "").replace(/\(\d+ tiles\)/g, "").replace(/\(road \d+ tiles\)/, "");
    viaReach.set(key, (viaReach.get(key) ?? 0) + 1);
  }
  const nearKeep = new Map<string, number>();
  if (process.env.BALANCE_TYPE) {
    const keepTile = eco.buildings[eco.keeps[seat] ?? -1]?.tile ?? 0;
    const inner = new Set(land.ring(keepTile, 1));
    for (const t of land.ring(keepTile, 9)) {
      if (inner.has(t)) continue;
      const key = land.territory[t] !== seat + 1 ? "not ours" : land.use[t] !== Use.Free ? "not free" : why(t, seat).replace(/\(slope [0-9.]+\)/, "").replace(/\(\d+ tiles\)/g, "").replace(/\(road \d+ tiles\)/, "");
      nearKeep.set(key, (nearKeep.get(key) ?? 0) + 1);
    }
  }
  // Can a geologist be sent at all: flags with ground to survey within four steps, and how much of the seat's land is surveyable.
  const flagsOwn = eco.flags.filter((f) => f.alive && f.owner === seat && f.building < 0);
  const flagsOk = flagsOwn.filter((f) => eco.check({ t: "geologist", flagTile: f.tile, player: seat }) === null).length;
  let surveyableOwn = 0;
  let unsampled = 0;
  for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === seat + 1 && land.surveyable(t)) { surveyableOwn++; if (land.sign[t] === 0) unsampled++; }
  // The unfinished sites (what holds the builder's cap shut): type, materials delivered against cost, builder, road to the keep.
  const keepB = eco.buildings[eco.keeps[seat] ?? -1];
  const siteList = mine.filter((b) => !b.built).map((b) => ({
    type: b.def.id,
    short: b.cost.map((n, g) => (n > 0 && (b.delivered[g] ?? 0) < n ? `${g}:${b.delivered[g] ?? 0}/${n}` : "")).filter(Boolean),
    pending: b.pending.reduce((a, n) => a + n, 0),
    builder: b.builder,
    dig: b.dig,
    stranded: b.stranded,
    road: keepB ? eco.route(keepB.flag, b.flag).dist : -1,
  }));
  const rest = (m: Map<string, number>, k: string, th: number) => Math.max(0, (m.get(k) ?? 0) - th);
  console.log(
    JSON.stringify({
      day: d, builtN: mine.filter((b) => b.built).length, sites: mine.filter((b) => !b.built).length,
      stepReached: calls.reached, stepGave: calls.gave,
      builderRest: { econ: rest(brain.resting, "econ", brain.thoughts) },
      plannerRest: { mine: rest(brain.econ.rest, "mine", brain.econ.thoughts), [MINE]: rest(brain.econ.rest, MINE, brain.econ.thoughts), hedge: rest(brain.econ.rest, "hedge", brain.econ.thoughts), geologist: rest(brain.econ.rest, "geologist", brain.econ.thoughts), smelter: rest(brain.econ.rest, "smelter", brain.econ.thoughts) },
      hadMine: [...((brain.econ as unknown as { hadMine: Set<string> }).hadMine ?? [])],
      stock: { stone: eco.storageTotals(seat)[goodId("stone")] ?? 0, tongs: eco.storageTotals(seat)[goodId("tongs")] ?? 0, iron: eco.storageTotals(seat)[goodId("iron")] ?? 0, ore: eco.storageTotals(seat)[goodId("ironore")] ?? 0, coal: eco.storageTotals(seat)[goodId("coal")] ?? 0 },
      smelters: mine.filter((b) => b.def.id === "smelter").map((b) => (b.built ? "ok" : "site")),
      mines: mine.filter((b) => b.def.id === MINE).map((b) => (b.exhausted ? "x" : b.built ? "ok" : "site")),
      signTiles: tiles.length,
      reasons: Object.fromEntries(reasons),
      facts,
      withinTwo: Object.fromEntries(viaReach),
      nearKeep: Object.fromEntries(nearKeep),
      orders: { ...orders },
      siteList,
      geologist: { flags: flagsOwn.length, flagsWithGroundToSurvey: flagsOk, surveyableTilesInBorder: surveyableOwn, unsampled },
    }),
  );
}
