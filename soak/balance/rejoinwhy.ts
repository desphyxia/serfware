import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { landmassOf } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * Why a cut-off building is not joined again: `node rejoinwhy.mjs <size> <seed> <day> <seat> [peace] [armed]` plays the assess game with
 * war and `rejoinRoads` on (REJOIN=0 plays without it) to `day` and prints, for each of the seat's buildings that no road route joins to
 * its Hearthship, whether its flag is on the Hearthship's land, the nearest joined flags and, for each, the path found over free ground
 * (its length, or none) and what `checkRoad` says of it. Read-only.
 */
const [size, seed, dayArg, seatArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?, string?];
aiOptions.rejoinRoads = process.env.REJOIN !== "0";
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: Number(peaceArg ?? 5),
  latticeRoads: true,
  armedWardens: armedArg === "armed",
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const seat = Number(seatArg);
while (w.tick < Number(dayArg) * eco.dayTicks) w.step();
const keep = eco.buildings[eco.keeps[seat] ?? -1];
if (!keep) throw new Error("no keep");
const home = landmassOf(w, keep.tile);
const joined = eco.flags.filter((f) => f.alive && f.owner === seat && eco.route(f.id, keep.flag).dist < Infinity);
const c = land.lattice ? land.lattice.pos : land.planet.grid.center;
const d2 = (s: number, t: number) => ((c[s * 3] as number) - (c[t * 3] as number)) ** 2 + ((c[s * 3 + 1] as number) - (c[t * 3 + 1] as number)) ** 2 + ((c[s * 3 + 2] as number) - (c[t * 3 + 2] as number)) ** 2;
console.log(`seat ${seat} day ${dayArg}: joined flags ${joined.length}`);
for (const b of eco.buildings) {
  if (!b.alive || b.owner !== seat || b.flag < 0 || eco.route(b.flag, keep.flag).dist < Infinity) continue;
  const f = eco.flags[b.flag]!;
  const nbrs = land.nbrs(f.tile);
  const open = nbrs.filter((n) => land.roadable(n, seat)).length;
  console.log(`${b.def.id} ${b.id} built ${b.built} threat ${b.threat}: flag ${f.id} tile ${f.tile} roads ${f.roads.length} on home land ${home.has(f.tile)} roadable nbrs ${open}/${nbrs.length}`);
  for (const j of joined.map((j) => ({ j, d: d2(j.tile, f.tile) })).sort((x, y) => x.d - y.d).slice(0, 6)) {
    const path = land.findPath(j.j.tile, f.tile, (x) => land.roadable(x, seat), 1500);
    const free = land.findPath(j.j.tile, f.tile, () => true, 1500);
    console.log(`  from flag ${j.j.id} (dist ${Math.sqrt(j.d).toFixed(3)}): path ${path ? path.length : "none"} ${path ? eco.checkRoad(path, seat) ?? "ok" : ""}; any-ground path ${free ? free.length : "none"}`);
  }
}
