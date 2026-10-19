import { AiBuilder, aiOptions, aiTrace } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { BUILDINGS, buildingType, type BuildingDef } from "../../src/sim/econ/defs";
import { chooseSide, placeConnected } from "../../src/sim/econ/planner";

/**
 * Why a seat on the road lattice builds less: `node latticewhy.mjs <size> <seed> <days> [lattice]` plays the assess game (the
 * standard stack, three rivals, no war), on the road lattice with `lattice` and on tile-centre roads without, and at the end
 * says per seat where the builder's last 10 days of thoughts stopped and what failed, and for a house and a farm: the tiles of
 * its land where one fits, where a flag side with a road to the network exists, and whether the builder's own search
 * (`placeConnected`, 9 and 16 steps) places one. Run it both ways and compare. Places buildings at the end (the last step).
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
aiTrace.on = true;
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
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
console.log(`${size} ${seed} day ${days} ${lattice ? "LATTICE" : "tile-centre roads"}; nodes ${land.nodes}, tiles ${land.tileCount}`);
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const rows = aiTrace.filter((r) => r.pl === p && r.tick >= w.tick - 10 * eco.dayTicks);
  const stage: Record<string, number> = {};
  const failed: Record<string, number> = {};
  const placed: Record<string, number> = {};
  for (const r of rows) {
    const k = r.stage + (r.stage === "wants" && !r.listed ? "(empty)" : "");
    stage[k] = (stage[k] ?? 0) + 1;
    if (r.placed) placed[r.placed] = (placed[r.placed] ?? 0) + 1;
    for (const f of r.failed ? r.failed.split(",") : []) failed[f] = (failed[f] ?? 0) + 1;
  }
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" ");
  const built = eco.buildings.filter((b) => b.alive && b.owner === p && b.built).length;
  const sites = eco.buildings.filter((b) => b.alive && b.owner === p && !b.built).length;
  const flagsOf = eco.flags.filter((f) => f.alive && f.owner === p).length;
  console.log(`== seat ${p}: built ${built}, sites ${sites}, flags ${flagsOf}, thoughts ${rows.length} stages ${JSON.stringify(stage)} | placed ${top(placed) || "none"} | failed ${top(failed)}`);
  const inner = new Set(land.ring(keep.tile, 9));
  const outer = new Set(land.ring(keep.tile, 16));
  const own: number[] = [];
  for (let t = 0; t < land.tileCount; t++) if (land.territory[t] === p + 1) own.push(t);
  console.log(`   own tiles ${own.length}, within 9 of the keep ${own.filter((t) => inner.has(t)).length}, within 16 ${own.filter((t) => outer.has(t)).length}`);
  for (const type of ["house", "farm", "woodcutter"]) {
    const def = BUILDINGS[buildingType(type)] as BuildingDef;
    const why: Record<string, number> = {};
    let fits = 0;
    let withRoad = 0;
    for (const t of own) {
      const r = land.buildBlocker(t, def, p);
      if (r) {
        const k = r.replace(/\(.*\)/, "(…)");
        why[k] = (why[k] ?? 0) + 1;
        continue;
      }
      fits++;
      if (chooseSide(w, def, t, p)) withRoad++;
    }
    const near = placeConnected(w, type, { minDist: 2, maxDist: 9, player: p, splitRoads: true });
    const far = near || placeConnected(w, type, { minDist: 2, maxDist: 16, player: p, splitRoads: true });
    const reasons = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v} ${k}`).join(" | ");
    console.log(`   ${type}: fits on ${fits} own tiles, with a flag side and road ${withRoad}; placeConnected within 9: ${near}, within 16: ${far}; blocked by: ${reasons}`);
  }
}
