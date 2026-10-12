import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Where goods pile up: `node jamwhy.mjs <size> <seed> <seat> <days> [turn] [wide]` plays the assess game (full AI stack, no war,
 * three rivals) and, every 10 days, prints for one seat the flags holding the most goods: what stands on the flag, each good with
 * the building it is bound for and the route length to it (Infinity: no route), and the roads at the flag with their carriers.
 * Read-only.
 */
const [size, seed, seatArg, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, ...string[]];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = flags.includes("turn");
aiOptions.widePlacement = flags.includes("wide");
for (const f of flags) if (f.startsWith("w=")) aiOptions.turnPartnerWeight = Number(f.slice(2));
const seat = Number(seatArg);
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
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d % 10 !== 0) continue;
  const mine = eco.flags.filter((f) => f.alive && f.owner === seat);
  const total = mine.reduce((a, f) => a + f.goods.length, 0);
  const full = mine.filter((f) => f.goods.length + f.reserved >= 8).length;
  console.log(`day ${d}: seat ${seat} flags ${mine.length} goods on flags ${total} full ${full}`);
  if (d < Number(days) - 9 && total < 60) continue;
  const top = [...mine].sort((a, b) => b.goods.length - a.goods.length).slice(0, 4);
  for (const f of top) {
    if (f.goods.length < 4) continue;
    const b = f.building >= 0 ? eco.buildings[f.building] : undefined;
    const roads = f.roads.map((rid) => {
      const r = eco.roads[rid]!;
      const other = r.a === f.id ? r.b : r.a;
      return `to flag ${other} len ${r.tiles.length} carrier ${r.carrier >= 0 ? "yes" : "NO"} helpers ${r.helpers.length}`;
    });
    console.log(`  flag ${f.id} tile ${f.tile} building ${b?.def.id ?? "none"} goods ${f.goods.length} reserved ${f.reserved} roads ${f.roads.length}: ${roads.join("; ")}`);
    const seen = new Map<string, number>();
    for (const gid of f.goods) {
      const g = eco.goods[gid];
      if (!g || !g.alive) continue;
      const dest = g.dest >= 0 ? eco.buildings[g.dest] : undefined;
      const dist = dest ? eco.route(f.id, dest.flag).dist : -1;
      const key = `${GOODS[g.type]?.id}->${dest?.def.id ?? "store?"}(route ${dist === Infinity ? "none" : dist}, carrier ${g.carrier >= 0 ? "promised" : "none"})`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    console.log(`    ${[...seen.entries()].map(([k, v]) => `${v}x ${k}`).join("; ")}`);
  }
}
