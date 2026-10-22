import { AiBuilder, aiOptions, aiTrace } from "../../src/sim/ai/builder";
import { goodsFor } from "../../src/sim/econ/defs";
import { FLAG_CAPACITY, transportOptions } from "../../src/sim/econ/economy";
import { World } from "../../src/sim/world";

/**
 * What one seat does while it stops growing or goes hungry (#169): `node seatwhy.mjs <size> <seed> <days> [every=<d>] [seats=<n>,...]`
 * plays the assess game with the AI switches of `BALANCE_AI` (the tokens of run.ts; "lattice" plays the road lattice, "norings" plays
 * without `transportOptions.breakRings`) and, per seat and window of `every` days (default 5), prints: finished buildings and sites
 * (by type), adults and room for people, idle adults, days the meal was missed, food in the warehouses, the builder's food cover, food
 * buildings standing and building, roads at the keep flag, full flags and stuck goods; then where the window's thoughts stopped,
 * what was placed, what failed and what was listed. Diagnostic: needs the aiTrace hook in builder.ts; reads `foodCover` and the
 * hunger flag, which are private.
 */
const [size, seed, daysArg, ...args] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const every = Number(opt("every") ?? 5);
const seats = (opt("seats") ?? "1,2,3").split(",").map(Number);
const ai = (process.env.BALANCE_AI ?? "").split(",").filter(Boolean);
const TOKENS: Record<string, string> = {
  quarry: "relocateQuarries", stone: "stoneFallback", food: "foodByNeed", priority: "stonePriority", reach: "borderReach", clear: "borderClear",
  tools: "toolsByDemand", ore: "oreMines", release: "releaseStalled", smith: "toolsmithAnyway", forge: "forgeRoom", survey: "surveyAgain",
  granite: "graniteFirst", turn: "turnBuildings", wide: "widePlacement", cand: "borderCandidates", wood: "woodByNeed", rail: "reserveRail",
  railsites: "railWithSites", early: "orderEarly", keeproads: "keepRoads",
};
const options = aiOptions as unknown as Record<string, boolean>;
for (const [token, key] of Object.entries(TOKENS)) if (key in options) options[key] = ai.includes(token);
if ("bowsByNeed" in options) options.bowsByNeed = !ai.includes("nobows");
transportOptions.breakRings = !ai.includes("norings");
aiTrace.on = true;
const brains: Record<number, AiBuilder> = {};
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  armedWardens: ai.includes("armed"),
  ...(ai.includes("lattice") && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => (brains[s.player] = new AiBuilder(s.player, s.rng, s.personality, s.level)),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const FOOD = goodsFor("food");
const FOOD_TYPES = ["fisher", "hunter", "orchard", "farm", "mill", "bakery", "apiary", "pasture", "butcher"];
const hour = Math.max(1, Math.round(eco.dayTicks / 24));
const hungryNow = (p: number): boolean => !!(eco as unknown as { hungry: boolean[] }).hungry[p];
const hungry: number[] = [0, 0, 0, 0];
const top = (o: Record<string, number>, n = 8): string =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ") || "-";
const bump = (o: Record<string, number>, k: string): void => {
  o[k] = (o[k] ?? 0) + 1;
};
let cursor = 0;
console.log(`${size} ${seed} ${daysArg} days, BALANCE_AI=${ai.join(",")}${transportOptions.breakRings ? "" : " (no ring rule)"}`);
for (let d = 1; d <= Number(daysArg); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  for (const p of seats) if (hungryNow(p)) hungry[p]!++;
  if (d % every !== 0) continue;
  for (const p of seats) {
    const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
    const sites: Record<string, number> = {};
    for (const b of mine) if (!b.built) bump(sites, b.def.id);
    const totals = eco.storageTotals(p);
    const food = FOOD.reduce((n, g) => n + (totals[g] as number), 0);
    const pop = eco.population(p);
    const count = (built: boolean): string =>
      FOOD_TYPES.map((t) => `${t}${mine.filter((b) => b.def.id === t && b.built === built).length || ""}`)
        .filter((s) => /\d/.test(s))
        .join(" ") || "-";
    const keep = eco.buildings[eco.keeps[p] as number];
    const keepRoads = keep ? (eco.flags[keep.flag]?.roads.length ?? 0) : 0;
    let stuck = 0;
    let full = 0;
    for (const f of eco.flags) {
      if (!f.alive || f.owner !== p) continue;
      if (f.goods.length + f.reserved >= FLAG_CAPACITY) full++;
      for (const id of f.goods) if (eco.goods[id]?.alive && (eco.tick - (eco.goods[id]?.since ?? 0)) / hour >= 6) stuck++;
    }
    const cover = (brains[p] as unknown as { foodCover: number }).foodCover;
    const rows = aiTrace.slice(cursor).filter((r) => r.pl === p);
    const stage: Record<string, number> = {};
    const placed: Record<string, number> = {};
    const failed: Record<string, number> = {};
    const listed: Record<string, number> = {};
    const rested: Record<string, number> = {};
    for (const r of rows) {
      bump(stage, r.stage);
      if (r.placed) bump(placed, r.placed);
      for (const k of r.failed ? r.failed.split(",") : []) bump(failed, k);
      for (const k of r.listed ? r.listed.split(",") : []) bump(listed, k);
      for (const k of r.rested ? r.rested.split(",") : []) bump(rested, k);
    }
    console.log(
      `day ${d} seat ${p}: built ${mine.filter((b) => b.built).length} sites ${mine.filter((b) => !b.built).length} [${top(sites, 6)}] adults ${pop.idle + pop.working} room ${eco.capacity(p)} idle ${pop.idle} hungry ${hungry[p]}d food ${food} cover ${cover.toFixed(2)} keepRoads ${keepRoads} full ${full} stuck ${stuck}`,
    );
    console.log(`    food standing ${count(true)} | building ${count(false)}`);
    console.log(`    thoughts ${rows.length} ${top(stage)} | placed ${top(placed)} | failed ${top(failed)}`);
    console.log(`    listed ${top(listed, 10)} | rested ${top(rested, 6)}`);
    hungry[p] = 0;
  }
  cursor = aiTrace.length;
}
for (const p of seats) {
  const counts: Record<string, number> = {};
  for (const x of eco.buildings) if (x.alive && x.owner === p && x.built) bump(counts, x.def.id);
  console.log(`seat ${p} final ${top(counts, 60)}`);
}
