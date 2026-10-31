import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * When a seat's lantern buildings lose their road route to its Hearthship: `node splitwhy.mjs <size> <seed> <to> <seat> [peace] [armed]`
 * plays the assess game with war (as keepwhy) and prints each time the set of the seat's built lantern buildings with no road route
 * from its Hearthship changes, with the buildings that changed hands since the last line (id, kind, old and new owner) and the
 * seat's roads lost since then. Read-only.
 */
const [size, seed, toArg, seatArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?, string?];
// REJOIN=0 plays without the `rejoinRoads` switch (on by default).
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
const seat = Number(seatArg);
const e = eco as unknown as { route(a: number, b: number): { dist: number } };
const ex = eco as unknown as { removeRoad(r: { id: number; owner: number; tiles: number[] }): void };
const orig = ex.removeRoad.bind(eco);
const watchFrom = Number(process.env.WATCH_FROM ?? 1e9) * eco.dayTicks;
const watchTo = Number(process.env.WATCH_TO ?? 0) * eco.dayTicks;
ex.removeRoad = (r) => {
  if (r.owner === seat && w.tick >= watchFrom && w.tick <= watchTo) {
    const stack = (new Error().stack ?? "").split("\n").slice(2, 7).map((l) => l.trim().replace(/^at /, "").replace(/ \(.*\)$/, "")).join(" < ");
    console.log(`  day ${(w.tick / eco.dayTicks).toFixed(3)} road ${r.id} of seat ${r.owner} removed (${r.tiles.length} tiles): ${stack}`);
  }
  orig(r);
};
const owners = new Map<number, number>();
const changed: string[] = [];
let lastCut = "";
let roadsBefore = -1;
const endTick = Number(toArg) * eco.dayTicks;
while (w.tick < endTick) {
  w.step();
  if (w.tick % 50 !== 0) continue;
  for (const b of eco.buildings) {
    if (!b.alive || !b.built) continue;
    const o = owners.get(b.id);
    if (o !== undefined && o !== b.owner && (o === seat || b.owner === seat)) changed.push(`${b.def.id} ${b.id} ${o}->${b.owner}`);
    owners.set(b.id, b.owner);
  }
  const keep = eco.buildings[eco.keeps[seat] ?? -1];
  if (!keep || eco.defeated[seat]) break;
  const cut = eco.buildings
    .filter((b) => b.alive && b.built && b.owner === seat && b.def.slots && e.route(keep.flag, b.flag).dist === Infinity)
    .map((b) => `${b.def.id[0]}${b.id}`)
    .join(" ");
  const roads = eco.roads.filter((r) => r.alive && r.owner === seat).length;
  if (cut !== lastCut) {
    console.log(`day ${(w.tick / eco.dayTicks).toFixed(2)} cut off: [${cut}]; seat roads ${roads} (was ${roadsBefore}); changed hands: ${changed.join(", ") || "-"}`);
    changed.length = 0;
    lastCut = cut;
  }
  roadsBefore = roads;
}
