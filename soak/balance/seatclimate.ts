import { World } from "../../src/sim/world";

/**
 * The ground and weather each seat starts on (hunger): `node seatclimate.mjs <size> <seed> <days> [lattice]` makes the assess map
 * (three rivals, no brains, so nothing is built) and runs the weather for `days`, then prints per rival seat: the region of its keep,
 * the mean temperature there, the days fruit grows (`climate.growing`) and bees fly (8 degrees or more) at the keep, the mean soil,
 * life and pollination within 6 tiles, and the region's tree and field growth rules. Read-only.
 */
const [size, seed, daysArg, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  ...(flags.includes("lattice") && { latticeRoads: true }),
  brain: () => ({ think: () => {} }),
} as never);
const eco = w.economy;
const land = w.land;
const climate = (eco as unknown as { climate?: { temp: Float32Array; growing(t: number): boolean } }).climate;
const keeps = [1, 2, 3].map((p) => eco.buildings[eco.keeps[p] as number]);
const tiles = keeps.map((k) => (k ? land.pt(k.tile) : -1));
const temp = [0, 0, 0];
const grow = [0, 0, 0];
const bees = [0, 0, 0];
const days = Number(daysArg);
for (let d = 1; d <= days; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  tiles.forEach((t, i) => {
    if (t < 0 || !climate) return;
    temp[i]! += climate.temp[t] as number;
    if (climate.growing(t)) grow[i]!++;
    if ((climate.temp[t] as number) >= 8) bees[i]!++;
  });
}
console.log(`${size} ${seed} ${days} days${climate ? "" : " (no climate)"}`);
keeps.forEach((k, i) => {
  if (!k) return;
  const ring = [land.pt(k.tile), ...land.ring(k.tile, 6)];
  const mean = (f: (t: number) => number) => (ring.reduce((n, t) => n + f(t), 0) / ring.length).toFixed(2);
  const region = land.regionOf(k.tile);
  const eco2 = eco as unknown as { ecology: { pollination(t: number): number } };
  console.log(
    `seat ${i + 1}: region ${region.name ?? region.id ?? "?"} temp ${(temp[i]! / days).toFixed(1)} growing ${grow[i]}d bees ${bees[i]}d soil ${mean((t) => land.soil[t] as number)} life ${mean((t) => land.life[t] as number)} pollination ${mean((t) => eco2.ecology.pollination(t))} treeGrowth ${region.rules?.treeGrowth} fieldGrowth ${region.rules?.fieldGrowth}`,
  );
});
