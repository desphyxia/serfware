import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { FLAG_CAPACITY, transportOptions } from "../../src/sim/econ/economy";

/**
 * How often a good dropped by a dismissed carrier takes a flag past its capacity once the slots promised to goods on their way
 * are counted (#163): `node flagover.mjs <size> <seed> <days> [lattice]` plays the assess game (standard stack, three rivals, no
 * war) and, every time `dropCarriedGoodAt` puts a good on a flag, counts it, and counts those after which the flag's goods plus its
 * reserved slots exceed the capacity, by the caller of the road removal. Prints one line.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
aiOptions.borderReach = aiOptions.borderClear = aiOptions.surveyAgain = aiOptions.borderCandidates = aiOptions.woodByNeed = false;
aiOptions.reserveRail = aiOptions.railWithSites = aiOptions.orderEarly = false;
aiOptions.foodWithoutIdle = true;
transportOptions.breakRings = false;
Error.stackTraceLimit = 30;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  ...(lattice && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
type Carrier = { carryGood: number; state: string; carrying: number };
const drop = (eco as unknown as { dropCarriedGoodAt(s: Carrier, flagId: number): void }).dropCarriedGoodAt;
let drops = 0;
let over = 0;
let removals = 0;
const callers: Record<string, number> = {};
const removalCallers: Record<string, number> = {};
(eco as unknown as { dropCarriedGoodAt: unknown }).dropCarriedGoodAt = function (this: unknown, s: Carrier, flagId: number) {
  const carrying = s.state !== "fetch" && s.carrying >= 0;
  drop.call(this, s, flagId);
  if (!carrying) return;
  drops++;
  const f = eco.flags[flagId];
  if (!f || f.goods.length + f.reserved <= FLAG_CAPACITY) return;
  over++;
  const frames = String(new Error().stack)
    .split("\n")
    .map((l) => l.trim().replace(/^at (?:Economy\.)?(\S+) .*$/, "$1"));
  const i = frames.indexOf("removeRoad");
  const who = i >= 0 ? (frames[i + 1] ?? "?") + (frames[i + 2] ? "<" + frames[i + 2] : "") : "(not through removeRoad: " + (frames[3] ?? "?") + ")";
  callers[who] = (callers[who] ?? 0) + 1;
};
const removeRoad = (eco as unknown as { removeRoad(r: unknown): void }).removeRoad;
(eco as unknown as { removeRoad: unknown }).removeRoad = function (this: unknown, r: { alive: boolean }) {
  if (r.alive) {
    removals++;
    const frames = String(new Error().stack)
      .split("\n")
      .map((l) => l.trim().replace(/^at (?:Economy\.)?(\S+) .*$/, "$1"));
    const who = (frames[2] ?? "?") + (frames[3] ? "<" + frames[3] : "");
    removalCallers[who] = (removalCallers[who] ?? 0) + 1;
  }
  return removeRoad.call(this, r);
};
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
console.log(JSON.stringify({ size, seed, days: Number(days), lattice, removals, carriedDrops: drops, dropsPastCapacityWithReserved: over, callers, removalCallers }));
