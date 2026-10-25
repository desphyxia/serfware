import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { transportOptions } from "../../src/sim/econ/economy";
import { Feature, ORCHARD, Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * Room to work round the farms and orchards (hunger): `node fieldroom.mjs <size> <seed> <day>,<day>...` plays the assess game with the
 * switches of `BALANCE_AI` (the sweep tokens; "nolattice", "norings", "nobows" and "nowarmfarms" included) and on each day prints per seat, for every
 * finished farm and orchard: the open tiles within its radius (what `findJobTarget` sows or plants on: free, flat, no feature but
 * shrub, six neighbours, and for a farm living soil) and its fields or orchard trees; and the seat's hungry days to date. Read-only.
 */
const [size, seed, daysArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string];
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
const days = daysArg.split(",").map(Number);
const hungry = [0, 0, 0, 0];
const open = (t: number, soil: number): boolean =>
  land.isLand(t) && land.use[t] === Use.Free && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.slope(t) < 1.8 && land.planet.grid.degree(t) === 6 && (land.life[t] as number) >= soil;
console.log(`${size} ${seed} BALANCE_AI=${ai.join(",")}`);
for (let d = 1; d <= Math.max(...days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  for (let p = 1; p <= 3; p++) if ((eco as unknown as { hungry: boolean[] }).hungry[p]) hungry[p]!++;
  if (!days.includes(d)) continue;
  for (let p = 1; p <= 3; p++) {
    const out: string[] = [];
    let opens = 0;
    let n = 0;
    for (const b of eco.buildings) {
      if (!b.alive || !b.built || b.owner !== p || (b.def.id !== "farm" && b.def.id !== "orchard")) continue;
      const ring = land.ring(b.tile, b.def.radius ?? 3);
      const farm = b.def.id === "farm";
      const room = ring.filter((t) => open(t, farm ? 2 : 0)).length;
      const have = farm ? ring.filter((t) => land.feature[t] === Feature.Field).length : ring.filter((t) => land.feature[t] === Feature.Tree && land.variety[t] === ORCHARD).length;
      opens += room;
      n++;
      out.push(`${farm ? "F" : "O"}${b.id}:open ${room} ${farm ? "fields" : "trees"} ${have}`);
    }
    console.log(`day ${d} seat ${p}: hungry ${hungry[p]}d, ${n} farms+orchards, mean open ${(opens / Math.max(1, n)).toFixed(1)} | ${out.join(" | ")}`);
  }
}
