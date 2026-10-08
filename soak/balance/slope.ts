import { World } from "../../src/sim/world";

/**
 * How steep the ground is: `node slope.mjs <size> <seed>` prints the tile width in world units and, for mountain tiles and
 * for all land, the share of tiles by slope (height difference to the steepest neighbour) against the limits: 1.3 (small
 * building), 2.2 (a flag), 2.6 (large building) and 3.2 (mine). Read-only.
 */
const [size, seed] = process.argv.slice(2) as [string, string];
const w = new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "honest", peaceDays: 999 } as never);
const land = w.land;
const R = w.planet.params.radius;
const slopes = (only: (t: number) => boolean): number[] => {
  const out: number[] = [];
  for (let t = 0; t < land.territory.length; t++) if (land.isLand(t) && only(t)) out.push(land.slope(t));
  return out.sort((a, b) => a - b);
};
const share = (s: number[], max: number) => Number(((s.filter((x) => x <= max).length / Math.max(1, s.length)) * 100).toFixed(1));
const q = (s: number[], p: number) => Number((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(2));
for (const [name, s] of [["mountain", slopes((t) => land.isMountain(t))], ["land", slopes(() => true)]] as const) {
  console.log(
    JSON.stringify({
      set: name, tiles: s.length, median: q(s, 0.5), p90: q(s, 0.9), p99: q(s, 0.99), max: q(s, 0.9999),
      underPct: { "1.3": share(s, 1.3), "2.2": share(s, 2.2), "2.6": share(s, 2.6), "3.2": share(s, 3.2) },
    }),
  );
}
console.log(JSON.stringify({ size, radius: R, spacingUnit: land.spacing, tileWidthWorld: Number((land.spacing * R).toFixed(2)), dayTicks: w.economy.dayTicks }));
