import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { transportOptions, type Flag } from "../../src/sim/econ/economy";
import { Use, Feature } from "../../src/sim/econ/landuse";

/**
 * Roads out of a store flag (#169): `node keepflag.mjs <size> <seed> <day> [lattice] [norings]` plays the assess game (the standard
 * stack, three rivals, no war) to the day and, for each rival seat, prints its keep's flag, the roads out of it (length, where they
 * lead, the busiest day of their carrier) and every node next to the flag: what holds it (use, feature, owner) and whether a road
 * could go there. Read-only.
 */
const [size, seed, dayArg, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
transportOptions.breakRings = !flags.includes("norings");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  ...(lattice && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const USE = ["free", "flag", "road", "building", "blocked"];
const FEATURE = Object.fromEntries(Object.entries(Feature).filter(([, v]) => typeof v === "number").map(([k, v]) => [v, k]));

for (let d = 1; d <= Number(dayArg); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
console.log(`${size} ${seed} day ${dayArg} ${lattice ? "LATTICE" : "tile-centre roads"}`);
for (const p of [1, 2, 3]) {
  const keep = eco.buildings[eco.keeps[p] as number];
  if (!keep) continue;
  const f = eco.flags[keep.flag] as Flag;
  const nb = [...land.nbrs(f.tile)];
  console.log(`seat ${p}: keep tile ${keep.tile}, flag node ${f.tile}${land.lattice ? (land.lattice.isCentre(f.tile) ? " (centre)" : " (corner)") : ""}, ${f.roads.length} roads, ${nb.length} neighbour nodes`);
  for (const id of f.roads) {
    const r = eco.roads[id]!;
    const other = r.a === f.id ? r.b : r.a;
    console.log(`  road ${id}: ${r.tiles.length} tiles to flag ${other} (${(eco.flags[other] as Flag).roads.length} roads there), busy yesterday ${(r.busyPrev / eco.dayTicks).toFixed(2)}, helpers ${r.helpers.length}`);
  }
  for (const n of nb) {
    const t = land.pt(n);
    const own = land.ownerOf(n);
    console.log(
      `  node ${n}${land.lattice ? (land.lattice.isCentre(n) ? " centre" : " corner") : ""}: use ${USE[land.use[n] as number]}${land.use[n] === Use.Road ? "" : ""}, feature ${FEATURE[land.feature[t] as number] ?? "?"}, owner ${own}, roadable ${land.roadable(n, p)}`,
    );
  }
}
