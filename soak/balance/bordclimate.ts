import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { transportOptions } from "../../src/sim/econ/economy";
import { World } from "../../src/sim/world";

/**
 * How much the climate varies inside a seat's border (hunger): `node bordclimate.mjs <size> <seed> <days> [cp=<day>,...]` plays the
 * assess game with the switches of `BALANCE_AI` (the sweep tokens; "lattice", "norings", "nobows", "nowarmfarms" included), counts for every tile the
 * samples (4 a day) on which fruit grows (`climate.growing`) and bees fly (8 degrees or more), and keeps each seat's border on the
 * checkpoint days (default 20, 40, 60 and the last). At the end it prints per seat and checkpoint, over the whole game's weather:
 * the land tiles held, the regions among them, and the growing and bee shares at the keep and across the held land (min, 10th
 * percentile, median, 90th, max), with the share of held land whose growing share is 25 points or more above or below the keep's.
 * Read-only.
 */
const [size, seed, daysArg, ...args] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const days = Number(daysArg);
const cps = (args.find((a) => a.startsWith("cp="))?.slice(3) ?? `20,40,60,${days}`).split(",").map(Number);
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
if ("warmFarms" in options) options.warmFarms = !ai.includes("nowarmfarms");
transportOptions.breakRings = !ai.includes("norings");
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  ...(ai.includes("lattice") && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const climate = (eco as unknown as { climate?: { temp: Float32Array; growing(t: number): boolean } }).climate;
if (!climate) throw new Error("no climate");
const count = land.planet.grid.count;
const grow = new Uint16Array(count);
const bees = new Uint16Array(count);
let samples = 0;
const SAMPLES_PER_DAY = 4;
const borders = new Map<number, number[][]>();
const keepTile = (p: number): number => {
  const k = eco.buildings[eco.keeps[p] as number];
  return k ? land.pt(k.tile) : -1;
};
const keeps: number[] = [];
for (let d = 1; d <= days; d++) {
  for (let s = 0; s < SAMPLES_PER_DAY; s++) {
    const stop = w.tick + Math.round(eco.dayTicks / SAMPLES_PER_DAY);
    while (w.tick < stop) w.step();
    for (let t = 0; t < count; t++) {
      if (climate.growing(t)) grow[t]!++;
      if ((climate.temp[t] as number) >= 8) bees[t]!++;
    }
    samples++;
  }
  if (!cps.includes(d)) continue;
  const held: number[][] = [];
  for (let p = 1; p <= 3; p++) {
    keeps[p] = keepTile(p);
    const mine: number[] = [];
    for (let t = 0; t < count; t++) if (land.territory[t] === p + 1 && land.isLand(t)) mine.push(t);
    held.push(mine);
  }
  borders.set(d, held);
}
const pct = (xs: number[], q: number): number => xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1)))] as number;
const show = (xs: number[]): string => `${pct(xs, 0).toFixed(2)}/${pct(xs, 0.1).toFixed(2)}/${pct(xs, 0.5).toFixed(2)}/${pct(xs, 0.9).toFixed(2)}/${pct(xs, 1).toFixed(2)}`;
console.log(`${size} ${seed} ${days} days, ${samples} weather samples, BALANCE_AI=${ai.join(",")}`);
console.log("shares over the whole game; land held: min/p10/median/p90/max");
for (let p = 1; p <= 3; p++) {
  const k = keeps[p] as number;
  if (k < 0) continue;
  const kg = (grow[k] as number) / samples;
  const kb = (bees[k] as number) / samples;
  for (const cp of cps) {
    const mine = borders.get(cp)?.[p - 1] ?? [];
    if (!mine.length) continue;
    const gs = mine.map((t) => (grow[t] as number) / samples).sort((a, b) => a - b);
    const bs = mine.map((t) => (bees[t] as number) / samples).sort((a, b) => a - b);
    const regions: Record<string, number> = {};
    for (const t of mine) {
      const name = land.regionOf(t).name;
      regions[name] = (regions[name] ?? 0) + 1;
    }
    const above = mine.filter((t) => (grow[t] as number) / samples >= kg + 0.25).length / mine.length;
    const below = mine.filter((t) => (grow[t] as number) / samples <= kg - 0.25).length / mine.length;
    console.log(
      `seat ${p} day ${cp}: ${mine.length} land tiles | ${Object.entries(regions).map(([n, c]) => `${n} ${Math.round((100 * c) / mine.length)}%`).join(", ")} | growing keep ${kg.toFixed(2)} held ${show(gs)} | 25+ points above keep ${Math.round(100 * above)}%, below ${Math.round(100 * below)}% | bees keep ${kb.toFixed(2)} held ${show(bs)}`,
    );
  }
}
