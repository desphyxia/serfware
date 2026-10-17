import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { GOODS, goodId } from "../../src/sim/econ/defs";
import { VoyagePlanner } from "../../src/sim/ai/voyage";
import { World } from "../../src/sim/world";

/**
 * What stops a colony: `node colonywhy.mjs <size> <seed> <days> [population idle]` plays the assess game (full AI stack, no war)
 * with the colony threshold lowered to <population> <idle> (default 30 and 5; the AI's own rule is 70 and 14) and, each day from
 * day 10, asks every rival seat the questions the voyage planner asks, in its order. The first one that fails is that day's
 * "gate". It prints, per seat, the days spent at each gate and the day each stage was first passed, then every voyage. Read-only.
 * The cargo list repeats CARGO in src/sim/ai/voyage.ts (it is not exported).
 */
const [size, seed, days, popArg, idleArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string?, string?];
const CARGO: Record<string, number> = { plank: 12, stone: 8, log: 6, hammer: 2, axe: 2, pick: 1, saw: 1, shovel: 1, scythe: 1, bread: 8 };
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
// COLONY_FLAGS="early,railsites" plays those switches (see aiOptions): orderEarly, railWithSites.
const flags = (process.env.COLONY_FLAGS ?? "").split(",");
aiOptions.orderEarly = flags.includes("early");
aiOptions.railWithSites = flags.includes("railsites");
const found = { population: Number(popArg ?? 30), idle: Number(idleArg ?? 5) };
VoyagePlanner.found = { ...found };
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const voyages = w.voyages;
const sys = w.system;
const gates: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
const first: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
const seen = new Set<string>();
const events: string[] = [];

function gate(p: number): string {
  const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
  if (mine.length === 0) return "fallen";
  const stock = eco.storageTotals(p);
  const have = (id: string, n: number) => (stock[goodId(id)] ?? 0) >= n;
  if (!voyages) return "no voyages";
  if (!voyages.railOf(p, sys.home)) {
    if (mine.some((b) => b.def.rail || !b.built)) return mine.some((b) => b.def.rail) ? "rail under construction" : "rail waits: a site is under construction";
    if (mine.filter((b) => b.built).length < 30) return "rail: under 30 buildings";
    for (const [g, n] of [["iron", 6], ["plank", 8], ["stone", 10]] as const) if (!have(g, n)) return `rail: no ${g} (need ${n})`;
    return "rail: no site placed";
  }
  const unsurveyed = sys.planets.filter((q) => q.surface && q.index !== sys.home && !voyages.isSurveyed(p, q.index));
  const surveyed = sys.planets.filter((q) => q.surface && q.index !== sys.home && voyages.isSurveyed(p, q.index));
  if (surveyed.length === 0) {
    if (!have("iron", 2)) return "probe: no iron";
    if (!have("plank", 2)) return "probe: no plank";
    return unsurveyed.length ? "probe: in flight or waiting" : "no world with ground";
  }
  const pop = eco.population(p);
  const people = pop.idle + pop.working;
  if (voyages.list.some((v) => v.owner === p && v.kind === "hearthship")) return "hearthship sent";
  if (people < found.population) return `hearthship: people under ${found.population}`;
  if (pop.idle < found.idle) return `hearthship: idle under ${found.idle}`;
  if (aiOptions.orderEarly) return "hearthship: ordered (goods come later)";
  for (const [g, n] of [["plank", 30], ["stone", 12], ["log", 10], ["iron", 6]] as const) if (!have(g, n)) return `hearthship: no ${g} (need ${n})`;
  for (const [g, n] of Object.entries(CARGO)) if (!have(g, n)) return `hearthship: cargo lacks ${g} (need ${n})`;
  return "hearthship: all clear";
}

for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d < 10) continue;
  for (let p = 1; p <= 3; p++) {
    const g = gate(p);
    gates[p]![g] = (gates[p]![g] ?? 0) + 1;
    const stage = g.split(":")[0] as string;
    if (first[p]![stage] === undefined) first[p]![stage] = d;
  }
  if (d % 10 === 0) {
    for (const v of voyages?.list ?? []) {
      if (v.state !== "loading" || v.kind !== "hearthship") continue;
      const rail = eco.buildings[v.rail];
      const lacks = v.load.map((n, g) => (n > ((rail?.stock[g] as number) ?? 0) ? `${GOODS[g]!.id} ${(rail?.stock[g] as number) ?? 0}/${n}` : "")).filter(Boolean);
      events.push(`day ${d}: seat ${v.owner} hearthship ${v.from}->${v.to} still loading, rail lacks: ${lacks.join(", ") || "nothing"}`);
    }
  }
  for (const v of voyages?.list ?? []) {
    const key = `${v.id}:${v.state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(`day ${d}: seat ${v.owner} ${v.kind} ${v.from}->${v.to} ${v.state}`);
  }
}
for (let p = 1; p <= 3; p++) {
  const pop = eco.population(p);
  const rows = Object.entries(gates[p]!).sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ size, seed, seat: p, threshold: found, built: eco.buildings.filter((b) => b.alive && b.owner === p && b.built).length, people: pop.idle + pop.working, idle: pop.idle, gates: Object.fromEntries(rows), firstDayAtStage: first[p] }));
}
for (const e of events) console.log(JSON.stringify({ size, seed, event: e }));
