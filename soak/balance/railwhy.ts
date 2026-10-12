import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { goodId } from "../../src/sim/econ/defs";
import { placeConnected } from "../../src/sim/econ/planner";
import { VoyagePlanner } from "../../src/sim/ai/voyage";
import { BUILDINGS, buildingType, type BuildingDef } from "../../src/sim/econ/defs";
import { World } from "../../src/sim/world";

/**
 * Why a seat does not build a launch rail: `node railwhy.mjs <size> <seed> <days>` plays the assess game (full AI stack, no war) and
 * at day <days> asks each seat the questions the voyage planner asks, one by one, then tries to place a rail the way it does
 * (planner.placeConnected: 2 to 9 tiles from the keep, roads split). Read-only until that last call, which places a rail.
 */
const [size, seed, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
VoyagePlanner.found = { population: 25, idle: 5 };
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
for (let p = 1; p <= 3; p++) {
  const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
  const stock = eco.storageTotals(p);
  const have = (id: string, n: number) => (stock[goodId(id)] ?? 0) >= n;
  const pop = eco.population(p);
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  const info = {
    seat: p,
    built: mine.filter((b) => b.built).length,
    unbuilt: mine.filter((b) => !b.built).length,
    hasRail: mine.some((b) => b.def.rail),
    voyagesAllowed: VoyagePlanner.allowed({ world: w, player: p } as never),
    iron: stock[goodId("iron")],
    plank: stock[goodId("plank")],
    stone: stock[goodId("stone")],
    stockOk: have("iron", 6) && have("plank", 8) && have("stone", 10),
    people: pop.idle + pop.working,
    idle: pop.idle,
    keep: keep?.tile,
  };
  let placed: boolean | string = "skipped";
  if (!info.hasRail && info.stockOk && info.unbuilt === 0) {
    try {
      placed = placeConnected(w, "launchrail", { minDist: 2, maxDist: 9, player: p, splitRoads: true });
    } catch (e) {
      placed = `threw ${(e as Error).message}`;
    }
  }
  // How many tiles around the keep a launch rail could stand on (the planner looks 2 to 9 tiles out), by distance.
  const def = BUILDINGS[buildingType("launchrail")] as BuildingDef;
  const fits: Record<string, number> = {};
  if (keep) {
    for (const reach of [9, 12, 16, 24]) {
      let n = 0;
      for (const t of w.land.ring(keep.tile, reach)) {
        const flag = w.land.bestFlagTile(t, p);
        if (flag >= 0 && w.land.canBuildDef(t, flag, def, p)) n++;
      }
      fits[`within${reach}`] = n;
    }
  }
  console.log(JSON.stringify({ ...info, placed, fits }));
}
