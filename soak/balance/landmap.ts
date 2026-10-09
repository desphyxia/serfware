import { landmassOf } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * How much land each rival can reach at the start: `node landmap.mjs <size> <seed> [<seed> ...]` prints one JSON line per
 * seat. `home` is the land tiles the keep's land reaches (by land or bridge), `sharing` the keeps standing on it (player 0's
 * included, so up to 4), `claimed`
 * the land tiles inside the seat's border at the start, `landTiles` all land on the map and `masses` its separate pieces.
 */
const [size, ...seeds] = process.argv.slice(2) as ["tiny" | "small", ...string[]];
for (const seed of seeds) {
  const w = new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "honest", peaceDays: 999 } as never);
  const eco = w.economy;
  const land = w.land;
  let landTiles = 0;
  for (let t = 0; t < land.territory.length; t++) if (land.isLand(t)) landTiles++;
  // The separate pieces of land, by size.
  const seen = new Set<number>();
  const masses: number[] = [];
  for (let t = 0; t < land.territory.length; t++) {
    if (!land.isLand(t) || seen.has(t)) continue;
    const m = landmassOf(w, t);
    let n = 0;
    for (const x of m) {
      seen.add(x);
      if (land.isLand(x)) n++;
    }
    masses.push(n);
  }
  masses.sort((a, b) => b - a);
  // Player 0 (the steward seat) has a Hearthship too, so a map holds four settlements.
  const keeps = [0, 1, 2, 3].map((p) => eco.buildings[eco.keeps[p] ?? -1]).filter((k) => k !== undefined);
  for (let p = 1; p <= 3; p++) {
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    if (!keep) continue;
    const home = landmassOf(w, keep.tile);
    let homeLand = 0;
    for (const x of home) if (land.isLand(x)) homeLand++;
    let claimed = 0;
    for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === p + 1 && land.isLand(t)) claimed++;
    console.log(JSON.stringify({ seed, size, seat: p, landTiles, masses: masses.slice(0, 5), home: homeLand, sharing: keeps.filter((k) => home.has(k.tile)).length, claimed }));
  }
}
