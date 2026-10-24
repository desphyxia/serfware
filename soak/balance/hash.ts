import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { startOptions, transportOptions } from "../../src/sim/econ/economy";
import { World } from "../../src/sim/world";

/**
 * Same game, same state? `node hash.mjs <size> <seed> <days>` plays three AI rivals and prints the world checksum at the end
 * of days 1, 2, 4, 8, ... and of the last day. Run it on two builds and compare the lines: equal lines mean the two play
 * identically. Read-only.
 *
 * `BALANCE_AI` switches the same AI behaviours on as the sweeps do (the tokens of run.ts; "armed" plays the armed-wardens
 * rule); without it the AI plays as it does by default. `BALANCE_PEACE` is the peace in days (default 999: no war; give 5 to
 * play war, capture and territory too). Tokens a build does not know are ignored, so the one script runs on older builds.
 */
const [size, seed, days] = process.argv.slice(2) as [string, string, string];
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
startOptions.avoidCold = !ai.includes("nocoldstart");
const peaceDays = Number(process.env.BALANCE_PEACE ?? 999);
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays,
  armedWardens: ai.includes("armed"),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const out: string[] = [];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if ((d & (d - 1)) === 0 || d === Number(days) || eco.winner >= 0) out.push(`${size} ${seed} day ${d} tick ${w.tick} ${w.checksum()}`);
}
console.log(out.join("\n"));
