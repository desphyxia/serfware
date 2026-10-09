import { World } from "../../src/sim/world";

/**
 * Same game, same state? `node hash.mjs <size> <seed> <days>` plays three AI rivals with the default brain and prints the
 * world checksum at the end of days 1, 2, 4, 8, ... Run it on two builds and compare the lines: equal lines mean the two play
 * identically. Read-only.
 */
const [size, seed, days] = process.argv.slice(2) as [string, string, string];
const w = new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "honest", peaceDays: 999 } as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const out: string[] = [];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if ((d & (d - 1)) === 0) out.push(`${size} ${seed} day ${d} tick ${w.tick} ${w.checksum()}`);
}
console.log(out.join("\n"));
