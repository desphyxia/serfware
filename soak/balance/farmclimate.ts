import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { transportOptions } from "../../src/sim/econ/economy";
import { Feature, ORCHARD, Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * Do farms and orchards stand on the seat's warm land (hunger)? `node farmclimate.mjs <size> <seed> <days>` plays the assess game with the
 * switches of `BALANCE_AI` (the sweep tokens; "nolattice", "norings", "nobows" and "nowarmfarms" included), counts per tile the samples (4 a day) on which
 * fields grow (`climate.growing`, which fields and orchard fruit both wait for), and on the last day prints per seat: hungry days; the
 * fields and orchard trees (count and mean growing share over the whole game); the growing share of the seat's open land (what a field could
 * be sown on: free, flat, no feature but shrub, six neighbours, living soil) as median and 90th percentile; and how much of that open land is
 * 25 points or more warmer than the seat's fields. Read-only.
 */
const [size, seed, daysArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string];
const days = Number(daysArg);
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
  ...(!ai.includes("nolattice") && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const climate = w.climate as unknown as { growing(t: number): boolean };
const count = land.planet.grid.count;
const grow = new Uint16Array(count);
let samples = 0;
const SAMPLES = 4;
const hungry = [0, 0, 0, 0];
for (let d = 1; d <= days; d++) {
  for (let s = 0; s < SAMPLES; s++) {
    const stop = w.tick + Math.round(eco.dayTicks / SAMPLES);
    while (w.tick < stop) w.step();
    for (let t = 0; t < count; t++) if (climate.growing(t)) grow[t]!++;
    samples++;
  }
  for (let p = 1; p <= 3; p++) if ((eco as unknown as { hungry: boolean[] }).hungry[p]) hungry[p]!++;
}
const share = (t: number): number => (grow[t] as number) / samples;
const open = (t: number): boolean =>
  land.isLand(t) && land.use[t] === Use.Free && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.slope(t) < 1.8 && land.planet.grid.degree(t) === 6 && (land.life[t] as number) >= 2;
const pct = (xs: number[], q: number): number => (xs.length ? (xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1)))] as number) : NaN);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`${size} ${seed} ${days} days, ${samples} samples, BALANCE_AI=${ai.join(",")}`);
for (let p = 1; p <= 3; p++) {
  const fields = new Set<number>();
  const trees = new Set<number>();
  let farms = 0;
  let orchards = 0;
  for (const b of eco.buildings) {
    if (!b.alive || !b.built || b.owner !== p || (b.def.id !== "farm" && b.def.id !== "orchard")) continue;
    const farm = b.def.id === "farm";
    if (farm) farms++;
    else orchards++;
    for (const t of land.ring(b.tile, b.def.radius ?? 3)) {
      if (farm && land.feature[t] === Feature.Field) fields.add(t);
      if (!farm && land.feature[t] === Feature.Tree && land.variety[t] === ORCHARD) trees.add(t);
    }
  }
  const room: number[] = [];
  for (let t = 0; t < count; t++) if (land.territory[t] === p + 1 && open(t)) room.push(share(t));
  room.sort((a, b) => a - b);
  const sown = mean([...fields, ...trees].map(share));
  const warmer = room.filter((g) => g >= sown + 0.25).length;
  console.log(
    `seat ${p}: hungry ${hungry[p]}d | ${farms} farms ${fields.size} fields grow ${mean([...fields].map(share)).toFixed(2)} | ${orchards} orchards ${trees.size} trees grow ${mean([...trees].map(share)).toFixed(2)} | open land ${room.length} tiles grow median ${pct(room, 0.5).toFixed(2)} p90 ${pct(room, 0.9).toFixed(2)} | 25+ points warmer than the fields: ${warmer} tiles (${Math.round((100 * warmer) / Math.max(1, room.length))}%)`,
  );
}
