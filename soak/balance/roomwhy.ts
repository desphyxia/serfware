import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { diagnoseBorder } from "../../src/sim/ai/borderwhy";
import { World } from "../../src/sim/world";
import { BUILDINGS, buildingType, type BuildingDef } from "../../src/sim/econ/defs";
import { Feature, Use } from "../../src/sim/econ/landuse";

/**
 * Where a seat's land goes, and why what is left takes no building (#164): `node roomwhy.mjs <size> <seed> <day,day,...> [lattice]`
 * plays the assess game (the standard stack, three rivals, no war) and at each day counts, per rival seat, the tiles inside its
 * border by what holds them (water, building, flag, road, tree, rock, field, steep, free), the nodes its roads and flags use
 * (tile centres against tile corners on the lattice), and, for the free tiles where a house fits, why a road cannot reach them
 * (`diagnoseBorder`'s road questions, one tile at a time, first 8 tiles). Read-only.
 */
const [size, seed, daysArg, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
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
const house = BUILDINGS[buildingType("house")] as BuildingDef;
const checks = daysArg.split(",").map(Number);
const report = (day: number) => {
  console.log(`\n${size} ${seed} day ${day} ${lattice ? "LATTICE" : "tile-centre roads"}`);
  for (let p = 1; p <= 3; p++) {
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    if (!keep) continue;
    const built = eco.buildings.filter((b) => b.alive && b.owner === p && b.built).length;
    const cat: Record<string, number> = {};
    const fit: number[] = [];
    let own = 0;
    for (let t = 0; t < land.tileCount; t++) {
      if (land.territory[t] !== p + 1) continue;
      own++;
      let k: string;
      if (!land.isLand(t)) k = "water";
      else if (land.use[t] === Use.Building) k = "building";
      else if (land.use[t] === Use.Flag) k = "flag";
      else if (land.use[t] === Use.Road) k = "road";
      else if (land.use[t] === Use.Blocked) k = "beside a large building";
      else {
        const f = land.feature[t] as number;
        if (f === Feature.Tree) k = "tree";
        else if (f === Feature.Rock) k = "rock";
        else if (f === Feature.Field) k = "field";
        else if (f !== Feature.None && f !== Feature.Stump && f !== Feature.Shrub) k = `feature ${Feature[f]}`;
        else if (land.buildBlocker(t, house, p)) k = "free, but " + land.buildBlocker(t, house, p)!.replace(/\(.*\)/, "(…)").replace(/\.$/, "");
        else {
          k = "free, a house fits";
          fit.push(t);
        }
      }
      cat[k] = (cat[k] ?? 0) + 1;
    }
    const nodeUse = { roadCentre: 0, roadCorner: 0, flagCentre: 0, flagCorner: 0 };
    for (let n = 0; n < land.nodes; n++) {
      if (land.ownerOf(n) !== p + 1) continue;
      const u = land.use[n];
      if (u === Use.Road) nodeUse[n < land.tileCount ? "roadCentre" : "roadCorner"]++;
      if (u === Use.Flag) nodeUse[n < land.tileCount ? "flagCentre" : "flagCorner"]++;
    }
    console.log(`== seat ${p}: built ${built}, own tiles ${own}`);
    console.log("   " + Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(" | "));
    console.log(`   road nodes on tile centres ${nodeUse.roadCentre}, on corners ${nodeUse.roadCorner}; flags on centres ${nodeUse.flagCentre}, on corners ${nodeUse.flagCorner}`);
    const why: Record<string, number> = {};
    for (const t of fit.slice(0, 8)) diagnoseBorder(w, p, "house", [t], (r) => (why[r] = (why[r] ?? 0) + 1));
    console.log("   house-fitting tiles, road questions: " + (Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(" | ") || "none"));
  }
};
for (let d = 1; d <= Math.max(...checks); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (checks.includes(d)) report(d);
}
