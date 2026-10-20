import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { watchCornerIds } from "../../tests/helpers/cornerwatch";

/**
 * Where a lattice corner reaches data that only knows tile ids (#167): `node centerwatch.mjs <size> <seed> <days> [war]` plays
 * the assess game (standard stack, three rivals) on the road lattice with the corner watch of `latticesafe` on (it also watches
 * `grid.center`), and prints each place that read or wrote past the tiles, with the callers and how often. With `war` the
 * peace is 5 days and the armed-wardens rule is on. Slow: every read of a watched array goes through a proxy.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const war = flags.includes("war");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
aiOptions.borderReach = aiOptions.borderClear = aiOptions.surveyAgain = aiOptions.borderCandidates = aiOptions.woodByNeed = false;
aiOptions.reserveRail = aiOptions.railWithSites = aiOptions.orderEarly = false;
aiOptions.foodWithoutIdle = true;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: war ? 5 : 999,
  armedWardens: war,
  latticeRoads: true,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const hits = watchCornerIds(w);
const eco = w.economy;
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
console.log(`${size} ${seed} ${days} days${war ? " with war" : ""}: ${hits.size} places`);
for (const [k, v] of [...hits].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
