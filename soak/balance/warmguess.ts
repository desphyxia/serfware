import { CLIMATE_STEP } from "../../src/sim/climate/climate";
import { World } from "../../src/sim/world";

/**
 * Can a tile's growing share be guessed before any weather (hunger, climate starts)? `node warmguess.mjs <size> <seed> <days> <rain>,...`
 * makes the assess map (no brains), runs the weather for `days` counting per land tile the samples (4 a day) on which fields grow
 * (`climate.growing`), and compares that with a guess from the base temperature and the seasons alone, with a constant rain (each value
 * given) and snow lying and melting as in `Climate.step`. Prints per rain value the mean error, mean absolute error and correlation over
 * land tiles, and at the rival keeps. Read-only.
 */
const [size, seed, daysArg, rainsArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
const days = Number(daysArg);
const rains = (rainsArg ?? "0,0.1,0.2,0.3").split(",").map(Number);
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: () => ({ think: () => {} }),
} as never);
const eco = w.economy;
const land = w.land;
const climate = w.climate as unknown as { temp: Float32Array; growing(t: number): boolean; offsetAt(tick: number, t: number, y: number): number };
const grid = land.planet.grid;
const count = grid.count;
const SAMPLES = 4;
const grow = new Uint16Array(count);
let samples = 0;
for (let d = 1; d <= days; d++)
  for (let s = 0; s < SAMPLES; s++) {
    const stop = w.tick + Math.round(eco.dayTicks / SAMPLES);
    while (w.tick < stop) w.step();
    for (let t = 0; t < count; t++) if (climate.growing(t)) grow[t]!++;
    samples++;
  }
const temp0 = land.planet.terrain.temperature;
const moist = land.planet.terrain.moisture;
const steps = eco.dayTicks / SAMPLES / CLIMATE_STEP;
/** The guess over the same days as the run (from tick 0), snow carried from a year before. */
const guess = (t: number, rainK: number): number => {
  const y = grid.center[t * 3 + 1] as number;
  const rain = rainK * (0.45 + 0.8 * (moist[t] as number));
  let snow = 0;
  let n = 0;
  const year = 24 * SAMPLES;
  for (let i = -year; i < days * SAMPLES; i++) {
    const tick = Math.round(((i + 1) * eco.dayTicks) / SAMPLES);
    const temp = (temp0[t] as number) + climate.offsetAt(tick, t, y) - rain * 4;
    if (temp < 0 && rain > 0.05) snow += rain * 0.04 * steps;
    else if (temp < -4) snow += 0.002 * steps;
    if (temp > 1) snow -= 0.004 * (1 + temp * 0.15) * steps;
    snow = Math.min(1, Math.max(0, snow));
    if (i >= 0 && temp > 5 && snow < 0.2) n++;
  }
  return n / (days * SAMPLES);
};
const keeps = [1, 2, 3].map((p) => land.pt((eco.buildings[eco.keeps[p] as number] as { tile: number }).tile));
console.log(`${size} ${seed} ${days} days, ${samples} samples`);
for (const r of rains) {
  let n = 0;
  let err = 0;
  let abs = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let t = 0; t < count; t++) {
    if (!land.isLand(t)) continue;
    const real = (grow[t] as number) / samples;
    const g = guess(t, r);
    n++;
    err += g - real;
    abs += Math.abs(g - real);
    sx += g;
    sy += real;
    sxx += g * g;
    syy += real * real;
    sxy += g * real;
  }
  const corr = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  const atKeeps = keeps.map((k) => `${((grow[k] as number) / samples).toFixed(2)}~${guess(k, r).toFixed(2)}`).join(" ");
  console.log(`rain ${r}: bias ${(err / n).toFixed(3)} mae ${(abs / n).toFixed(3)} corr ${corr.toFixed(3)} | keeps real~guess ${atKeeps}`);
}
