import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Goods promised to a carrier that will not come for them: `node promwhy.mjs <size> <seed> <from> <to> [peace]` plays the assess game
 * with war (the default AI, lattice roads, peace 5 unless given) and, every tick from day `from` to `to`, looks at each good lying on
 * a flag with a carrier set. The promise is stale when that settler is dead, no carrier, on a road that does not end at the good's
 * flag, or idle without it. The first tick a good's promise is stale it prints the good, the flag, the settler now and the settler a
 * tick before. At the end it prints the stale promises per seat. Read-only.
 */
const [size, seed, fromArg, toArg, peaceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?];
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
const day = () => (w.tick / eco.dayTicks).toFixed(3);
const startTick = Number(fromArg) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
type Snap = { alive: boolean; role: string; state: string; road: number; owner: number; carryGood: number; target: number; back: number; roadIdx: number };
const snap = (id: number): Snap | undefined => {
  const s = eco.settlers[id];
  return s && { alive: s.alive, role: s.role, state: s.state, road: s.road, owner: s.owner, carryGood: s.carryGood, target: s.target, back: s.back, roadIdx: s.roadIdx };
};
const show = (x: Snap | undefined) => {
  if (!x) return "none";
  const r = eco.roads[x.road];
  return `${x.alive ? "" : "DEAD "}${x.role}:${x.state} owner ${x.owner} road ${x.road}${r ? ` (${r.a}-${r.b}${r.alive ? "" : " gone"}, owner ${r.owner}, carrier ${r.carrier})` : ""} idx ${x.roadIdx} carryGood ${x.carryGood} target ${x.target} back ${x.back}`;
};
const why = (gid: number, flag: number, sid: number): string => {
  const s = eco.settlers[sid];
  if (!s) return "no settler";
  if (!s.alive) return "dead";
  if (s.role !== "carrier") return `role ${s.role}`;
  const r = eco.roads[s.road];
  if (!r || !r.alive) return "road gone";
  if (r.a !== flag && r.b !== flag) return "road elsewhere";
  if (s.state === "idle" && s.carryGood !== gid) return "idle";
  return "";
};
let prev = new Map<number, Snap>();
const reported = new Set<number>();
let printed = 0;
while (w.tick < endTick) {
  w.step();
  if (w.tick < startTick) continue;
  const now = new Map<number, Snap>();
  for (const s of eco.settlers) if (s.alive && s.role === "carrier") now.set(s.id, snap(s.id) as Snap);
  for (const f of eco.flags) {
    if (!f.alive) continue;
    for (const gid of f.goods) {
      const g = eco.goods[gid];
      if (!g || !g.alive || g.carrier < 0) continue;
      const reason = why(gid, f.id, g.carrier);
      if (!reason) {
        reported.delete(gid);
        continue;
      }
      if (reported.has(gid)) continue;
      reported.add(gid);
      if (printed++ < 60)
        console.log(
          `day ${day()} good ${gid} ${GOODS[g.type]?.id} on flag ${f.id} (owner ${f.owner}, goods ${f.goods.length}, reserved ${f.reserved}) promised to #${g.carrier}: ${reason}\n  now:    ${show(snap(g.carrier))}\n  before: ${show(prev.get(g.carrier))}`,
        );
    }
  }
  prev = now;
}
const perSeat = new Map<number, Map<string, number>>();
for (const f of eco.flags) {
  if (!f.alive) continue;
  for (const gid of f.goods) {
    const g = eco.goods[gid];
    if (!g || !g.alive || g.carrier < 0) continue;
    const reason = why(gid, f.id, g.carrier);
    if (!reason) continue;
    const m = perSeat.get(f.owner) ?? new Map<string, number>();
    m.set(reason, (m.get(reason) ?? 0) + 1);
    perSeat.set(f.owner, m);
  }
}
console.log(`day ${day()} stale promises by seat: ${JSON.stringify([...perSeat].map(([k, m]) => [k, Object.fromEntries(m)]))}; first-time stale ${printed}`);
