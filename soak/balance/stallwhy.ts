import { AiBuilder, aiOptions, aiTrace } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * What the builder does with its thoughts while a seat is not growing: `node stallwhy.mjs <size> <seed> <days> [turn] [wide]`
 * plays the assess game (full AI stack, no war, three rivals) and, per seat and 10-day window, counts the thoughts by where they
 * stopped (site cap, no planks, no idle hands, or the wants list), how many had an empty list, how many tried and failed, and what
 * was placed. Diagnostic: needs the aiTrace hook in builder.ts.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = flags.includes("turn");
aiOptions.widePlacement = flags.includes("wide");
aiTrace.on = true;
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
const built = (p: number) => eco.buildings.filter((b) => b.alive && b.owner === p && b.built).length;
const sitesOf = (p: number) => eco.buildings.filter((b) => b.alive && b.owner === p && !b.built).length;
const start: Record<number, number> = {};
let cursor = 0;
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d % 10 !== 0) continue;
  for (let p = 1; p <= 3; p++) {
    const rows = aiTrace.slice(cursor).filter((r) => r.pl === p);
    const stage: Record<string, number> = {};
    let empty = 0;
    let allResting = 0;
    let placedN = 0;
    let failedN = 0;
    const placed: Record<string, number> = {};
    const failed: Record<string, number> = {};
    const listed: Record<string, number> = {};
    for (const r of rows) {
      stage[r.stage] = (stage[r.stage] ?? 0) + 1;
      if (r.stage !== "wants" && r.stage !== "noidle") continue;
      if (!r.listed) empty++;
      else if (r.listed && r.rested.split(",").length >= r.listed.split(",").length && !r.placed && !r.failed) allResting++;
      if (r.placed) {
        placedN++;
        placed[r.placed] = (placed[r.placed] ?? 0) + 1;
      }
      if (r.failed) {
        failedN++;
        for (const k of r.failed.split(",")) failed[k] = (failed[k] ?? 0) + 1;
      }
      for (const k of r.listed ? r.listed.split(",") : []) listed[k] = (listed[k] ?? 0) + 1;
    }
    const top = (o: Record<string, number>, n = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(" ");
    const b = built(p);
    console.log(`day ${d - 9}-${d} seat ${p} built ${start[p] ?? 0}->${b} sites ${sitesOf(p)} thoughts ${rows.length} stages ${JSON.stringify(stage)} emptyList ${empty} allResting ${allResting} placedThoughts ${placedN} failedThoughts ${failedN}`);
    console.log(`    placed ${top(placed)} | failed ${top(failed)} | listed ${top(listed, 8)}`);
    start[p] = b;
  }
  cursor = aiTrace.length;
}
for (let p = 1; p <= 3; p++) {
  const counts: Record<string, number> = {};
  for (const x of eco.buildings) if (x.alive && x.owner === p && x.built) counts[x.def.id] = (counts[x.def.id] ?? 0) + 1;
  console.log(`seat ${p} final ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`);
}
