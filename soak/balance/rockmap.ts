import { Biome } from "../../src/sim/planet/terrain";
import { Feature } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/** How much rock lies round each rival's keep at the start: `node rockmap.mjs <seed> <size>` prints one JSON line per seat. */
const [seed, size] = process.argv.slice(2) as [string, "tiny" | "small"];
const w = new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "normal", peaceDays: 5, fairStarts: true } as never);
const eco = w.economy;
const land = w.land;
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const row: Record<string, number | string> = { seed, size, seat: p };
  for (const r of [8, 14, 20, 30]) {
    let tiles = 0;
    let amount = 0;
    let rockBiome = 0;
    for (const t of land.ring(keep.tile, r)) {
      if (land.isLand(t) && land.planet.terrain.biome[t] === Biome.Rock) rockBiome++;
      if (land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
        tiles++;
        amount += land.amount[t] as number;
      }
    }
    row[`r${r}_tiles`] = tiles;
    row[`r${r}_units`] = amount;
    row[`r${r}_rockBiomeTiles`] = rockBiome;
  }
  console.log(JSON.stringify(row));
}
