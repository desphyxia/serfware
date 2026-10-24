import { startOptions } from "../../src/sim/econ/economy";
import { World } from "../../src/sim/world";

/**
 * Where the starts land with and without `startOptions.avoidCold` (hunger): `node startclimate.mjs <size> <seed> [lattice]` makes the
 * assess map (three rivals, no brains) twice (off, cold) and prints per seat the guessed growing season (`Climate.growingGuess`) over
 * the land within 7 steps of the keep, its region, the site score fair starts compare, the distance to the nearest other keep (steps)
 * and the flat land within 7 steps. Read-only.
 */
const [size, seed, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, ...string[]];
console.log(`${size} ${seed}${flags.includes("lattice") ? " lattice" : ""}`);
for (const [name, cold] of [["off", false], ["cold", true]] as const) {
  startOptions.avoidCold = cold;
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
  const seats: string[] = [];
  for (let p = 0; p <= 3; p++) {
    const k = eco.buildings[eco.keeps[p] as number];
    if (!k) continue;
    const near = [k.tile, ...land.ring(k.tile, 7)].filter((t) => land.isLand(t));
    const g = near.reduce((s, t) => s + w.climate.growingGuess(t), 0) / near.length;
    // Steps to the nearest other keep, and the flat land within 7 steps (what setupStart weighs most).
    const c = land.planet.grid.center;
    const kt = land.pt(k.tile);
    let gap = Infinity;
    for (let q = 0; q <= 3; q++) {
      const o = eco.buildings[eco.keeps[q] as number];
      if (q === p || !o) continue;
      const ot = land.pt(o.tile);
      const d = (c[kt * 3] as number) * (c[ot * 3] as number) + (c[kt * 3 + 1] as number) * (c[ot * 3 + 1] as number) + (c[kt * 3 + 2] as number) * (c[ot * 3 + 2] as number);
      gap = Math.min(gap, Math.sqrt(Math.max(0, 2 - 2 * d)) / land.spacing);
    }
    const flat = near.filter((t) => land.slope(t) < 1.2).length;
    seats.push(`${p}: grow ${g.toFixed(2)} ${land.regionOf(k.tile).name} score ${eco.siteScore(k.tile).toFixed(1)} gap ${gap.toFixed(0)} flat ${flat}`);
  }
  console.log(`${name.padEnd(4)} | ${seats.join(" | ")}`);
}
