import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { FLAG_CAPACITY, transportOptions, type Flag } from "../../src/sim/econ/economy";

/**
 * Does a keep flag with one road jam (#169): `node keeproad.mjs <size> <seed> <fixDay> <days> [lattice] [norings] [nofix]` plays the assess
 * game (the standard stack, three rivals, no war). On `fixDay` every seat whose keep flag has fewer than 3 roads gets roads from it to
 * the nearest flags of its own that it does not join yet (path of 12 nodes or fewer, over free ground), until it has 3; `nofix` plays
 * the same game without that. Every 5 days it prints per seat the goods stuck on flags (6 game hours or more), the full flags, the
 * buildings and the roads out of the keep flag. Not a game rule: a probe that changes the game it plays.
 */
const [size, seed, fixArg, daysArg, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, ...string[]];
const lattice = flags.includes("lattice");
transportOptions.breakRings = !flags.includes("norings");
const fix = !flags.includes("nofix");
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
const hour = Math.max(1, Math.round(eco.dayTicks / 24));
const keepFlag = (p: number): Flag | null => {
  const k = eco.buildings[eco.keeps[p] as number];
  return k ? (eco.flags[k.flag] as Flag) : null;
};
const stuck = (p: number): number => {
  let n = 0;
  for (const f of eco.flags) if (f.alive && f.owner === p) for (const id of f.goods) if (eco.goods[id]?.alive && (eco.tick - (eco.goods[id]?.since ?? 0)) / hour >= 6) n++;
  return n;
};
const full = (p: number): number => eco.flags.filter((f) => f.alive && f.owner === p && f.goods.length + f.reserved >= FLAG_CAPACITY).length;
const built = (p: number): number => eco.buildings.filter((b) => b.alive && b.built && b.owner === p).length;

const addRoads = (p: number) => {
  const kf = keepFlag(p);
  if (!kf || kf.roads.length >= 3) return;
  const joined = new Set<number>([kf.id]);
  for (const id of kf.roads) {
    const r = eco.roads[id]!;
    joined.add(r.a === kf.id ? r.b : r.a);
  }
  const near = eco.flags
    .filter((f) => f.alive && f.owner === p && !joined.has(f.id))
    .map((f) => ({ f, d: land.lattice ? land.lattice.dist(kf.tile, f.tile) : 0 }))
    .sort((a, b) => a.d - b.d || a.f.id - b.f.id)
    .slice(0, 40);
  const before = kf.roads.length;
  for (const { f } of near) {
    if (kf.roads.length >= 3) break;
    const path = land.findPath(kf.tile, f.tile, (n) => land.roadable(n, p), 200);
    if (!path || path.length > 12 || path.length < 2) continue;
    w.command({ t: "road", tiles: path, player: p });
  }
  console.log(`  fix: seat ${p} keep flag ${before} -> ${kf.roads.length} roads`);
};

console.log(`${size} ${seed} fix day ${fixArg} ${daysArg} days ${lattice ? "LATTICE" : "tile-centre roads"}${transportOptions.breakRings ? " +breakRings" : ""}${fix ? " +keep roads" : " (no fix)"}`);
for (let d = 1; d <= Number(daysArg); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (fix && d === Number(fixArg)) for (const p of [1, 2, 3]) addRoads(p);
  if (d % 5 === 0)
    console.log(`day ${String(d).padStart(2)}  ` + [1, 2, 3].map((p) => `seat ${p}: stuck ${stuck(p)} full ${full(p)} bld ${built(p)} keep roads ${keepFlag(p)?.roads.length ?? 0}`).join("  |  "));
}
