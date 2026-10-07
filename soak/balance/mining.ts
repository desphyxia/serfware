import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { goodId } from "../../src/sim/econ/defs";
import { Deposit, Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * Why a rival has no mine: `node mining.mjs <size> <seed> <rivals> <days>` plays the pilot-6 AI (all four switches) and, at
 * some days, prints one JSON line per seat with the conditions `EconPlanner.step` tests before it opens a coal or iron mine
 * (ai/economy.ts) and the ore under the seat's land. Read-only.
 */
const [size, seed, rivals, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
// BALANCE_EXTRA="tools,ore" adds the experimental switches on top of the pilot 6 ones.
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
const n = Number(rivals);
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden"].flatMap((p) => [p]).concat(["builder", "trader", "warden"]).slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const CHECK = [5, 10, 15, 20, 30, 40, 60, 90];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if (!CHECK.includes(d)) continue;
  for (let p = 1; p <= n; p++) {
    const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
    const built = mine.filter((b) => b.built);
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const stock = eco.storageTotals(p);
    const sign = (s: number) => {
      let usable = 0;
      let small = 0;
      for (let t = 0; t < land.sign.length; t++) {
        if (land.sign[t] !== s || land.territory[t] !== p + 1) continue;
        if (land.use[t] === Use.Free && !land.signSmall[t]) usable++;
        else small++;
      }
      return [usable, small];
    };
    // The ore itself (found or not) under free ground of the seat's land.
    const under = (kind: number) => {
      let tiles = 0;
      let loads = 0;
      for (let t = 0; t < land.deposit.length; t++) {
        if (land.deposit[t] !== kind || land.territory[t] !== p + 1) continue;
        tiles++;
        loads += land.depositAmount[t] as number;
      }
      return [tiles, loads];
    };
    const miners = (id: string) => mine.filter((b) => b.def.id === id).map((b) => (b.exhausted ? "x" : b.built ? "ok" : "site"));
    const fed = count("farm") > 0 && (count("bakery") > 0 || count("fisher") > 0 || count("butcher") > 0) && built.length >= 12;
    console.log(
      JSON.stringify({
        seed, size, day: d, seat: p, built: built.length, sites: mine.length - built.length, fed,
        toolsmith: count("toolsmith"), pick: stock[goodId("pick")] ?? 0, hammer: stock[goodId("hammer")] ?? 0, stone: stock[goodId("stone")] ?? 0, iron: stock[goodId("iron")] ?? 0,
        coalSign: sign(2), ironSign: sign(3), goldSign: sign(4), graniteSign: sign(5),
        coalUnder: under(Deposit.Coal), ironUnder: under(Deposit.Iron), goldUnder: under(Deposit.Gold), graniteUnder: under(Deposit.Granite),
        coalmine: miners("coalmine"), ironmine: miners("ironmine"), smelter: count("smelter"),
      }),
    );
  }
}
