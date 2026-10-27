import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * Leaked flag reservations: `node reswhy.mjs <size> <seed> <from> <to> [peace]` plays the assess game with war (the default AI,
 * lattice roads, peace 5 unless given) and, every tick from day `from` to `to`, compares each flag's `reserved` with the alive
 * carriers that hold a place there (`target` or `back`). When a flag's surplus grows it prints the tick, the flag, and every settler
 * (alive or not) whose target or back is that flag, with role, state and owner. Read-only.
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
const surplus = new Map<number, number>();
const startTick = Number(fromArg) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
let prevAlive = new Map<number, { role: string; state: string; target: number; back: number; owner: number; carryGood: number }>();
while (w.tick < endTick) {
  w.step();
  if (w.tick < startTick) continue;
  const held = new Map<number, number>();
  for (const s of eco.settlers) {
    if (!s.alive || s.role !== "carrier") continue;
    if (s.target >= 0) held.set(s.target, (held.get(s.target) ?? 0) + 1);
    if (s.back >= 0) held.set(s.back, (held.get(s.back) ?? 0) + 1);
  }
  for (const f of eco.flags) {
    if (!f.alive) continue;
    const extra = f.reserved - (held.get(f.id) ?? 0);
    const was = surplus.get(f.id) ?? 0;
    if (extra > was) {
      const who = eco.settlers.filter((s) => s.target === f.id || s.back === f.id).map((s) => `#${s.id} ${s.alive ? "alive" : "DEAD"} ${s.role}:${s.state} owner ${s.owner} target ${s.target} back ${s.back} carryGood ${s.carryGood}`);
      const vanished = [...prevAlive.entries()].filter(([id, p]) => (p.target === f.id || p.back === f.id) && !(eco.settlers[id]?.alive && (eco.settlers[id]!.target === f.id || eco.settlers[id]!.back === f.id))).map(([id, p]) => `#${id} was ${p.role}:${p.state} target ${p.target} back ${p.back} carryGood ${p.carryGood}, now ${eco.settlers[id]?.alive ? `${eco.settlers[id]!.role}:${eco.settlers[id]!.state} target ${eco.settlers[id]!.target}` : "dead"}`);
      console.log(`day ${day()} flag ${f.id} owner ${f.owner} goods ${f.goods.length} reserved ${f.reserved} held ${held.get(f.id) ?? 0} surplus ${was} -> ${extra} | now: ${who.join("; ") || "-"} | lost since last tick: ${vanished.join("; ") || "-"}`);
    }
    surplus.set(f.id, extra);
  }
  prevAlive = new Map();
  for (const s of eco.settlers) if (s.alive && s.role === "carrier" && (s.target >= 0 || s.back >= 0)) prevAlive.set(s.id, { role: s.role, state: s.state, target: s.target, back: s.back, owner: s.owner, carryGood: s.carryGood });
}
