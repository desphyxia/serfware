import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * Why seats stop attacking: `node attackwhy.mjs <size> <seed> <to> [every] [peace] [armed]` plays the assess game with war (as
 * keepwhy) and every `every` days (default 2) prints, per seat still standing, the enemy lantern buildings and Hearthships by why
 * it could not attack them (game over, truce, ally, not lit, out of reach), and for those in reach the wardens it could send, the
 * defenders on watch and the best odds with all of them (the AI wants 0.7 on normal). Also the truces standing, and attacks
 * ordered since the last line. Read-only.
 */
const [size, seed, toArg, everyArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string?, string?, string?];
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: Number(peaceArg ?? 5),
  latticeRoads: true,
  armedWardens: armedArg === "armed",
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const every = Number(everyArg ?? 2) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
const seats = eco.keeps.map((_, i) => i);
const ordered = new Map<number, number>();
const origCommand = w.command.bind(w);
(w as unknown as { command: typeof w.command }).command = ((c: { t: string; player?: number; count?: number }) => {
  const r = origCommand(c as never);
  if (c.t === "attack" && r.ok) ordered.set(c.player ?? 0, (ordered.get(c.player ?? 0) ?? 0) + 1);
  return r;
}) as never;
let next = eco.peaceUntil + eco.dayTicks;
while (w.tick < endTick && eco.winner < 0) {
  w.step();
  if (w.tick < next) continue;
  next += every;
  const truces: string[] = [];
  for (const p of seats) for (const q of seats) if (p < q && eco.diplomacy.truce(p, q)) truces.push(`${p}-${q}`);
  console.log(`day ${(w.tick / eco.dayTicks).toFixed(1)} truces [${truces.join(" ")}] attacks ordered since last ${[...ordered].map(([p, n]) => `${p}:${n}`).join(" ") || "none"}`);
  ordered.clear();
  for (const p of seats) {
    if (eco.defeated[p]) continue;
    const why = new Map<string, number>();
    const near: string[] = [];
    for (const t of eco.buildings) {
      if (!t.alive || !t.built || t.owner === p || !t.def.light || eco.defeated[t.owner]) continue;
      const b = eco.attackBlocked(p, t);
      if (b) {
        const k = b.startsWith("You have a truce") ? "truce" : b.startsWith("None of your") ? "far" : b.startsWith("Only lit") ? "dark" : b.slice(0, 12);
        why.set(k, (why.get(k) ?? 0) + 1);
        continue;
      }
      const pool = eco.attackersFor(p, t).length;
      const held = eco.defendersOf(t).length;
      const odds = pool ? eco.attackOdds(p, t, pool) : 0;
      near.push(`${t.def.id[0]}${t.id}@${t.owner} pool ${pool} held ${held} odds ${odds.toFixed(2)}`);
    }
    const mine = eco.buildings.filter((b) => b.alive && b.built && b.owner === p && b.def.slots && b.lit);
    const watch = mine.reduce((n, b) => n + eco.defendersOf(b).length, 0);
    console.log(`  seat ${p}: ${mine.length} lit lanterns, ${watch} on watch; blocked ${[...why].map(([k, n]) => `${k} ${n}`).join(", ") || "-"}; in reach ${near.length}: ${near.slice(0, 6).join("; ")}`);
  }
}
console.log(`end day ${(w.tick / eco.dayTicks).toFixed(1)} winner ${eco.winner}`);
