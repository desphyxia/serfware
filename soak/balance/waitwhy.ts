import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Carriers stuck waiting at a full flag: `node waitwhy.mjs <size> <seed> <seat> <from> <to> [peace]` plays the assess game with war
 * (the default AI, lattice roads, peace 5 unless given). From day `from` it tracks when each of `seat`'s carriers starts waiting, and
 * at day `to` prints every carrier of the seat that is waiting: since when, the good in hand and its next hop, both flags of its road,
 * its places kept, and the goods promised to it with their next hops. Read-only.
 */
const [size, seed, seatArg, fromArg, toArg, peaceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string, string?];
const seat = Number(seatArg);
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: Number(peaceArg ?? 5),
  latticeRoads: true,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const priv = eco as unknown as { nextHop(g: unknown): number; nextHopFrom(g: unknown, f: number): number };
const startTick = Number(fromArg) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
const since = new Map<number, number>();
while (w.tick < endTick) {
  w.step();
  if (w.tick < startTick) continue;
  for (const s of eco.settlers) {
    if (!s.alive || s.owner !== seat || s.role !== "carrier") continue;
    if (s.state === "wait") {
      if (!since.has(s.id)) since.set(s.id, w.tick);
    } else since.delete(s.id);
  }
}
const flagDesc = (id: number) => {
  const f = eco.flags[id]!;
  return `flag ${id} (${f.goods.length}+${f.reserved}${f.building >= 0 ? `, ${eco.buildings[f.building]!.def.id}` : ""})`;
};
for (const s of eco.settlers) {
  if (!s.alive || s.owner !== seat || s.role !== "carrier" || s.state !== "wait") continue;
  const r = eco.roads[s.road]!;
  const at = s.roadIdx === 0 ? r.a : r.b;
  const other = at === r.a ? r.b : r.a;
  const g = eco.goods[s.carryGood];
  const dest = g ? eco.buildings[g.dest] : undefined;
  console.log(
    `carrier #${s.id} waiting since day ${((since.get(s.id) ?? 0) / eco.dayTicks).toFixed(3)} at ${flagDesc(at)}, road ${r.id} to ${flagDesc(other)}; target ${s.target} back ${s.back}`,
  );
  if (g) console.log(`  in hand: good ${g.id} ${GOODS[g.type]?.id} -> ${dest?.def.id}(flag ${dest?.flag}) next hop from here ${priv.nextHopFrom(g, at)}`);
  for (const f of [at, other])
    for (const gid of eco.flags[f]!.goods) {
      const x = eco.goods[gid]!;
      if (x.carrier !== s.id) continue;
      console.log(`  promised: good ${gid} ${GOODS[x.type]?.id} on flag ${f}, next hop ${priv.nextHop(x)} (the road's other end is ${f === at ? other : at})`);
    }
  const hops = new Map<number, number>();
  for (const gid of eco.flags[at]!.goods) {
    const h = priv.nextHop(eco.goods[gid]!);
    hops.set(h, (hops.get(h) ?? 0) + 1);
  }
  console.log(`  goods at ${at} by next hop: ${[...hops].map(([h, n]) => `${n}x->${h}`).join(" ")}`);
}
