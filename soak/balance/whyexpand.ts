import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { BUILDINGS, buildingType, goodId, type BuildingDef } from "../../src/sim/econ/defs";
import { chooseSide, frontierTiles } from "../../src/sim/econ/planner";
import { Feature } from "../../src/sim/econ/landuse";

/**
 * Why a seat on a big map cannot push its border out or find a quarry: `node whyexpand.mjs <size> <seed> <days> [turn] [wide]`
 * plays the assess game and at the end prints, per seat, the stores and people, the frontier tiles a lantern would be tried on
 * (all of them, and the first 40 the builder looks at) with the reason each cannot take a lantern, and the rock left in and
 * around the border. Read-only.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium" | "large" | "huge", string, string, ...string[]];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = flags.includes("turn");
aiOptions.widePlacement = flags.includes("wide");
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
const land = w.land;
const lantern = BUILDINGS[buildingType("lantern")] as BuildingDef;
const tally = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
const show = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v} ${k}`).join(" | ");
for (let p = 1; p <= 3; p++) {
  const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
  const built = mine.filter((b) => b.built);
  const stock = eco.storageTotals(p);
  const count = (id: string) => mine.filter((b) => b.def.id === id).length;
  const pop = eco.population(p);
  console.log(`== seat ${p} (${["", "builder", "trader", "warden"][p]}): built ${built.length}, sites ${mine.length - built.length}, people ${eco.peopleOf(p).length}, capacity ${eco.capacity(p)}, idle ${pop.idle}, houses ${count("house")}, lanterns ${mine.filter((b) => b.def.slots).length}`);
  console.log(`   stores: plank ${stock[goodId("plank")] ?? 0} stone ${stock[goodId("stone")] ?? 0} log ${stock[goodId("log")] ?? 0} iron ${stock[goodId("iron")] ?? 0}; quarries ${count("quarry")}, granite mines ${count("granitemine")}, woodcutters ${count("woodcutter")}`);
  // Rock: in the border, and outside it, with material left.
  let rockIn = 0;
  let amountIn = 0;
  let rockOut = 0;
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  const near = new Set(keep ? land.ring(keep.tile, 22) : []);
  let rockOutNear = 0;
  for (let t = 0; t < land.territory.length; t++) {
    if (land.feature[t] !== Feature.Rock || (land.amount[t] as number) <= 0) continue;
    if (land.territory[t] === p + 1) {
      rockIn++;
      amountIn += land.amount[t] as number;
    } else if (land.territory[t] === 0 && land.isLand(t)) {
      rockOut++;
      if (near.has(t)) rockOutNear++;
    }
  }
  console.log(`   rock with material left: in the border ${rockIn} tiles (${amountIn} units); unclaimed ${rockOut} tiles, ${rockOutNear} of them within 22 of the keep`);
  // The border: every frontier tile, and why a lantern cannot stand on it.
  const all = frontierTiles(w, p);
  const reasonsAll: Record<string, number> = {};
  const reasonsFirst: Record<string, number> = {};
  let okAll = 0;
  let okFirst = 0;
  all.forEach((t, i) => {
    let why = land.buildBlocker(t, lantern, p);
    if (!why && !chooseSide(w, lantern, t, p)) why = "fits, but no road reaches it";
    if (!why) {
      okAll++;
      if (i < 40) okFirst++;
    }
    const key = (why ?? "ok").replace(/\(.*\)/, "(…)");
    tally(reasonsAll, key);
    if (i < 40) tally(reasonsFirst, key);
  });
  const unclaimed = [...land.ring(keep?.tile ?? 0, 30)].filter((t) => land.territory[t] === 0 && land.isLand(t)).length;
  console.log(`   border: unclaimed land within 30 of the keep ${unclaimed}; frontier tiles ${all.length} (${okAll} could take a lantern now), the first 40: ${okFirst} could`);
  console.log(`   first 40: ${show(reasonsFirst)}`);
  console.log(`   all:      ${show(reasonsAll)}`);
}
