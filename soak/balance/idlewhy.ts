import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Idle carriers by full flags: `node idlewhy.mjs <size> <seed> <seat> <day> [peace]` plays the assess game with war (the default AI,
 * lattice roads, peace 5 unless given) to `day` and, for each road of `seat` with goods at either end, prints its carrier's state, what
 * `chooseTransfer` would pick, and for every good at the ends: its next hop, whether that is the road's other end, and whether the
 * other end is full and has a good to swap back. Then it plays one more tick and says which of those carriers changed state. Read-only
 * apart from the one tick.
 */
const [size, seed, seatArg, dayArg, peaceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?];
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
const priv = eco as unknown as {
  chooseTransfer(r: unknown): [number, number] | null;
  nextHop(g: unknown): number;
  returnGood(r: unknown, at: number, c: number): number;
};
const stop = Number(dayArg) * eco.dayTicks;
while (w.tick < stop) w.step();
const full = (id: number) => {
  const f = eco.flags[id]!;
  return f.goods.length + f.reserved >= 8;
};
const roads = eco.roads.filter((r) => r.alive && r.owner === seat && (eco.flags[r.a]!.goods.length || eco.flags[r.b]!.goods.length));
const tally = new Map<string, number>();
const before = new Map<number, string>();
let shown = 0;
for (const r of roads) {
  const s = r.carrier >= 0 ? eco.settlers[r.carrier] : undefined;
  const pick = priv.chooseTransfer(r);
  const lines: string[] = [];
  let anyHere = false;
  for (const [from, to] of [
    [r.a, r.b],
    [r.b, r.a],
  ] as const) {
    for (const gid of eco.flags[from]!.goods) {
      const g = eco.goods[gid]!;
      const hop = priv.nextHop(g);
      if (hop !== to) continue;
      anyHere = true;
      const dest = eco.buildings[g.dest];
      const into = dest?.flag === to;
      const back = priv.returnGood(r, to, -1);
      lines.push(`    good ${gid} ${GOODS[g.type]?.id} ${from}->${to} carrier ${g.carrier} into ${into} toFull ${full(to)} back ${back}`);
    }
  }
  const key = `carrier ${s ? `${s.alive ? "" : "DEAD "}${s.state}${s.road === r.id ? "" : ` on road ${s.road}`}` : "none"} | goods to move ${anyHere} | pick ${pick ? "yes" : "no"}`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
  if (s) before.set(s.id, s.state);
  if (anyHere && shown++ < 12) {
    console.log(`road ${r.id} ${r.a}(${eco.flags[r.a]!.goods.length}+${eco.flags[r.a]!.reserved})-${r.b}(${eco.flags[r.b]!.goods.length}+${eco.flags[r.b]!.reserved}) len ${r.tiles.length} helpers ${r.helpers.length}: ${key}${pick ? ` -> good ${pick[1]} from ${pick[0]}` : ""}${s ? ` timer ${s.timer} roadIdx ${s.roadIdx} path ${s.path.length} pi ${s.pi}` : ""}`);
    for (const l of lines.slice(0, 6)) console.log(l);
  }
}
console.log("roads by case:");
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
w.step();
let changed = 0;
for (const [id, st] of before) if (eco.settlers[id]!.state !== st) changed++;
console.log(`after one tick: ${changed} of ${before.size} carriers changed state`);
