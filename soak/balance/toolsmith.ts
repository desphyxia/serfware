import { AiBuilder, aiOptions, aiStats } from "../../src/sim/ai/builder";
import { goodId } from "../../src/sim/econ/defs";
import { World } from "../../src/sim/world";

/**
 * Why a toolsmith waits: `node toolsmith.mjs <size> <seed> <rivals> <days>` plays the pilot-6 AI and, at some days, prints one
 * JSON line per seat: the toolsmiths (built, worker, iron and plank held and on the way, finished output), the smelters, and
 * the iron, plank, coal and ore in the warehouses. `BALANCE_EXTRA="tools,ore"` adds the experimental switches. Read-only.
 */
const [size, seed, rivals, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
aiOptions.forgeRoom = extra.includes("forge");
const n = Number(rivals);
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden", "builder", "trader", "warden"].slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
// BALANCE_EVERY=1 samples every day (default: a handful of days).
const every = Number(process.env.BALANCE_EVERY ?? 0);
const CHECK = every > 0 ? Array.from({ length: Number(days) }, (_, i) => i + 1).filter((d) => d % every === 0) : [5, 10, 15, 20, 25, 30, 40, 50, 60];
const IRON = goodId("iron");
const PLANK = goodId("plank");
const COAL = goodId("coal");
const ORE = goodId("ironore");
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if (!CHECK.includes(d)) continue;
  for (let p = 1; p <= n; p++) {
    const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
    const stock = eco.storageTotals(p);
    const view = (id: string) =>
      mine
        .filter((b) => b.def.id === id)
        .map((b) => ({ built: b.built, worker: b.worker >= 0, iron: b.stock[IRON] ?? 0, plank: b.stock[PLANK] ?? 0, coal: b.stock[COAL] ?? 0, ore: b.stock[ORE] ?? 0, pendIron: b.pending[IRON] ?? 0, pendPlank: b.pending[PLANK] ?? 0, output: b.output, busy: b.busy }));
    console.log(
      JSON.stringify({
        seed, size, day: d, seat: p, built: mine.filter((b) => b.built).length,
        stores: { iron: stock[IRON] ?? 0, plank: stock[PLANK] ?? 0, coal: stock[COAL] ?? 0, ore: stock[ORE] ?? 0, stone: stock[goodId("stone")] ?? 0, tongs: stock[goodId("tongs")] ?? 0 },
        sites: mine.filter((b) => !b.built).length,
        thoughts: aiStats[p]?.[0] ?? 0,
        capped: aiStats[p]?.[1] ?? 0,
        sitesWaiting: mine.filter((b) => !b.built).map((b) => b.def.id),
        has: Object.fromEntries(["sawmill", "quarry", "granitemine", "farm", "fisher", "bakery", "butcher", "toolsmith", "smelter", "coalmine", "ironmine"].map((id) => [id, mine.filter((b) => b.def.id === id && b.built).length])),
        toolsmith: view("toolsmith"), smelter: view("smelter"),
        mines: mine.filter((b) => b.def.id === "ironmine" || b.def.id === "coalmine").map((b) => `${b.def.id[0]}${b.exhausted ? "x" : b.built ? "ok" : "s"}`),
      }),
    );
  }
}
