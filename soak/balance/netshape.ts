import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { transportOptions, type Flag, type Road, type Building } from "../../src/sim/econ/economy";

/**
 * What the road network looks like before it jams (#169): `node netshape.mjs <size> <seed> <day>,<day>... [lattice] [norings]` plays the
 * assess game (the standard stack, three rivals, no war) and on each day prints, per rival seat: roads, the mean and longest road in
 * tiles, the share of roads of 3 tiles or more, the carriers' load (the share of the day each carrier worked yesterday: mean and
 * share over 80%), helpers called to busy roads, the flags that carry a building and also join 3 roads or more, the roads out of
 * each store's flag, and the goods on flags bound for a store. `norings` plays without `transportOptions.breakRings`. Read-only.
 */
const [size, seed, daysArg, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
transportOptions.breakRings = !flags.includes("norings");
const at = new Set(daysArg.split(",").map(Number));
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

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "-");
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const report = (day: number, p: number): string => {
  const roads = eco.roads.filter((r: Road) => r.alive && r.owner === p && !r.ferry);
  const len = roads.map((r) => r.tiles.length);
  const load = roads.filter((r) => r.busyPrev >= 0).map((r) => r.busyPrev / eco.dayTicks);
  const helped = roads.filter((r) => r.helpers.length > 0).length;
  const fl = eco.flags.filter((f: Flag) => f.alive && f.owner === p);
  const withB = fl.filter((f) => f.building >= 0);
  const bj = withB.filter((f) => f.roads.length >= 3);
  const stores = eco.buildings.filter((b: Building) => b.alive && b.built && b.owner === p && b.def.storage);
  const storeDeg = stores.map((s) => (eco.flags[s.flag] as Flag).roads.length);
  const storeIds = new Set(stores.map((s) => s.id));
  let onFlags = 0;
  let toStore = 0;
  for (const f of fl) {
    for (const id of f.goods) {
      const g = eco.goods[id];
      if (!g?.alive) continue;
      onFlags++;
      if (g.dest >= 0 && storeIds.has(g.dest)) toStore++;
    }
  }
  const built = eco.buildings.filter((b: Building) => b.alive && b.built && b.owner === p).length;
  return (
    `day ${day} seat ${p}: bld ${built} roads ${roads.length} len mean ${mean(len).toFixed(2)} max ${Math.max(0, ...len)} >=3 tiles ${pct(len.filter((n) => n >= 3).length, len.length)}` +
    ` | load mean ${mean(load).toFixed(2)} >80% ${pct(load.filter((x) => x > 0.8).length, load.length)} helped ${pct(helped, roads.length)}` +
    ` | flags ${fl.length} with building ${withB.length} of which junction ${bj.length}` +
    ` | store flag roads [${storeDeg.join(",")}] goods on flags ${onFlags} bound for a store ${toStore}`
  );
};

console.log(`${size} ${seed} ${daysArg} ${lattice ? "LATTICE" : "tile-centre roads"}${transportOptions.breakRings ? "" : " no rings"}`);
const last = Math.max(...at);
for (let d = 1; d <= last; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (at.has(d)) for (const p of [1, 2, 3]) console.log(report(d, p));
}
