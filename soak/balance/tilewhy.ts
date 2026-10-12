import { AiBuilder, aiOptions, aiTrace } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { BUILDINGS, buildingType, type BuildingDef } from "../../src/sim/econ/defs";
import { chooseSide, placeConnected } from "../../src/sim/econ/planner";

/**
 * Why a stalled seat can place nothing: `node tilewhy.mjs <size> <seed> <days> [turn] [wide]` plays the assess game and at the end
 * takes every tile of each seat's land and says, for a house and for a farm, why a building cannot stand there (the reason the
 * build tool would give), or, if it can, whether a road can join it. Also the land by use and feature. Read-only.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = flags.includes("turn");
aiOptions.widePlacement = flags.includes("wide");
aiTrace.on = true;
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
// The last 10 days of the builder's thoughts, per seat: where they stopped, and what was tried and placed.
for (let p = 1; p <= 3; p++) {
  const rows = aiTrace.filter((r) => r.pl === p && r.tick >= w.tick - 10 * eco.dayTicks);
  const stage: Record<string, number> = {};
  const failed: Record<string, number> = {};
  const placed: Record<string, number> = {};
  for (const r of rows) {
    stage[r.stage + (r.stage === "wants" && !r.listed ? "(empty)" : "")] = (stage[r.stage + (r.stage === "wants" && !r.listed ? "(empty)" : "")] ?? 0) + 1;
    if (r.placed) placed[r.placed] = (placed[r.placed] ?? 0) + 1;
    for (const k of r.failed ? r.failed.split(",") : []) failed[k] = (failed[k] ?? 0) + 1;
  }
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`seat ${p} last 10 days: thoughts ${rows.length} stages ${JSON.stringify(stage)} | placed ${top(placed) || "none"} | failed ${top(failed)}`);
}
const FEATURES = ["None", "Tree", "Rock", "Stump", "Field", "Shrub", "Hedge", "Giant", "Vent", "Spire", "Glowcap", "Ruin"];
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const inner = new Set(land.ring(keep.tile, 9));
  const outer = new Set(land.ring(keep.tile, 16));
  const own: number[] = [];
  for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === p + 1) own.push(t);
  const built = eco.buildings.filter((b) => b.alive && b.owner === p && b.built).length;
  console.log(`== seat ${p}: built ${built}, own tiles ${own.length}, land tiles ${own.filter((t) => land.isLand(t)).length}, within 9 of keep ${own.filter((t) => inner.has(t)).length}, within 16 ${own.filter((t) => outer.has(t)).length}`);
  const use: Record<string, number> = {};
  const feat: Record<string, number> = {};
  for (const t of own) {
    if (!land.isLand(t)) continue;
    const u = ["Free", "Flag", "Road", "Building", "Blocked"][land.use[t] as number] ?? String(land.use[t]);
    use[u] = (use[u] ?? 0) + 1;
    const f = FEATURES[land.feature[t] as number] ?? String(land.feature[t]);
    feat[f] = (feat[f] ?? 0) + 1;
  }
  console.log(`   use ${JSON.stringify(use)} feature ${JSON.stringify(feat)}`);
  // Where the builder looks: for each lit lantern, the tiles within 9 steps that fit a house with a road, and whether placeConnected
  // (the builder's own search, centred on that lantern) places one.
  {
    const houseDef = BUILDINGS[buildingType("house")] as BuildingDef;
    const lanterns = eco.buildings.filter((b) => b.alive && b.built && b.owner === p && b.lit && b.def.slots);
    let withSpots = 0;
    let placedNow = 0;
    const seen = new Set<number>();
    for (const l of lanterns) {
      let n = 0;
      for (const t of land.ring(l.tile, 9)) {
        if (land.territory[t] !== p + 1 || land.buildBlocker(t, houseDef, p) || !chooseSide(w, houseDef, t, p)) continue;
        n++;
        seen.add(t);
      }
      if (n) withSpots++;
    }
    const wideWas = aiOptions.widePlacement;
    aiOptions.widePlacement = false;
    for (const l of lanterns) if (placeConnected(w, "house", { minDist: 2, maxDist: 9, player: p, center: l.tile, splitRoads: true })) placedNow++;
    const keepOk = placeConnected(w, "house", { minDist: 2, maxDist: 9, player: p, splitRoads: true });
    aiOptions.widePlacement = wideWas;
    console.log(`   lit lanterns ${lanterns.length}: ${withSpots} have a house spot with a road within 9 (${seen.size} distinct tiles); placeConnected centred on a lantern placed ${placedNow}; centred on the keep: ${keepOk}`);
  }
  for (const type of ["house", "farm"]) {
    const def = BUILDINGS[buildingType(type)] as BuildingDef;
    const why: Record<string, number> = {};
    let fits = 0;
    let withRoad = 0;
    let fitsInner = 0;
    let withRoadInner = 0;
    for (const t of own) {
      const r = land.buildBlocker(t, def, p);
      if (r) {
        why[r.replace(/\(.*\)/, "(…)")] = (why[r.replace(/\(.*\)/, "(…)")] ?? 0) + 1;
        continue;
      }
      fits++;
      if (inner.has(t)) fitsInner++;
      if (chooseSide(w, def, t, p)) {
        withRoad++;
        if (inner.has(t)) withRoadInner++;
      }
    }
    // What a player could do right now: build on any tile that fits, with the flag on any side that works, a flag on a road
    // tile splitting that road. Counted in turn (each build changes the ground), at most 40, houses only on the last pass.
    if (type === "house") {
      let direct = 0;
      let onRoad = 0;
      for (const t of own) {
        if (direct >= 40) break;
        if (land.buildBlocker(t, def, p)) continue;
        for (const n of land.planet.grid.neighborsOf(t)) {
          if (!land.canBuildDef(t, n, def, p)) continue;
          const roadSide = land.use[n] === 2;
          if (w.command({ t: "build", type, tile: t, flagTile: n, player: p } as never).ok) {
            direct++;
            if (roadSide) onRoad++;
            break;
          }
        }
      }
      console.log(`   house by hand: ${direct} more could be placed at once (${onRoad} with the flag on an existing road)`);
    }
    const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${v} ${k}`).join(" | ");
    console.log(`   ${type}: tile fits ${fits} (within 9: ${fitsInner}), with a road ${withRoad} (within 9: ${withRoadInner}); blocked by: ${top}`);
  }
}
