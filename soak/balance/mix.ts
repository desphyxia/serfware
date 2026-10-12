import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { goodId } from "../../src/sim/econ/defs";
import { World } from "../../src/sim/world";

/**
 * What the AI builds and arms: `node mix.mjs <size> <seed> <rivals> <days>` plays the AI with the switches in BALANCE_EXTRA (as
 * `mining.ts`; ARMED=1 plays the armed-wardens rule) and, at days 5, 10, 20, 40 and 60, prints one JSON line per seat with the
 * standing buildings per kind, the wardens, the lantern buildings lit and dark, the land tiles held, and the blades, shields
 * and iron in the stores. Read-only.
 */
const [size, seed, rivals, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
aiOptions.forgeRoom = extra.includes("forge");
aiOptions.graniteFirst = extra.includes("granite");
const n = Number(rivals);
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden"].concat(["builder", "trader", "warden"]).slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  armedWardens: process.env.ARMED === "1",
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const CHECK = [5, 10, 20, 40, 60];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if (!CHECK.includes(d)) continue;
  for (let p = 1; p <= n; p++) {
    const kinds: Record<string, number> = {};
    let lit = 0;
    let dark = 0;
    for (const b of eco.buildings) {
      if (!b.alive || !b.built || b.owner !== p) continue;
      kinds[b.def.id] = (kinds[b.def.id] ?? 0) + 1;
      if (b.def.slots && !eco.keeps.includes(b.id)) {
        if (b.lit) lit++;
        else {
          dark++;
          if (process.env.WHY) console.log("dark", p, b.def.id, b.id, JSON.stringify(eco.waitingFor(b)), "garrison", b.garrison.length);
        }
      }
    }
    let territory = 0;
    for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === p + 1 && land.isLand(t)) territory++;
    const stock = eco.storageTotals(p);
    const wardens = eco.settlers.filter((x) => x.alive && x.owner === p && x.role === "warden").length;
    console.log(
      JSON.stringify({ seed, size, day: d, seat: p, kinds, wardens, lit, dark, territory, blade: stock[goodId("blade")], shield: stock[goodId("shield")], iron: stock[goodId("iron")] }),
    );
  }
}
