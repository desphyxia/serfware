import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * When a flag stops being on its tile: `node flagwhy.mjs <size> <seed> <level> <days>` plays the war suite's setup (three
 * Wardens, peace 5 days, the pilot-6 AI) and, each tick, checks every live flag against the land (`use` is Flag and `ref` is the
 * flag's id, as soak/invariants.ts does). It prints the first tick a flag fails, with the flag, its tile, what the land says is
 * there now, and the last commands issued before that tick. Read-only.
 */
const [size, seed, level, days] = process.argv.slice(2) as [string, string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["warden", "warden", "warden"],
  aiLevel: level,
  difficulty: "honest",
  peaceDays: 5,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
const recent: string[] = [];
const command = w.command.bind(w);
w.command = ((cmd: { t: string }) => {
  const r = command(cmd as never);
  recent.push(`tick ${w.tick} ${JSON.stringify(cmd)} -> ${JSON.stringify(r)}`);
  if (recent.length > 12) recent.shift();
  return r;
}) as typeof w.command;
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const stop = Number(days) * eco.dayTicks;
const seen = new Set<number>();
let reported = 0;
while (w.tick < stop && eco.winner < 0 && reported < 3) {
  w.step();
  for (const f of eco.flags) {
    if (!f.alive || seen.has(f.id)) continue;
    if (land.use[f.tile] !== Use.Flag || land.ref[f.tile] !== f.id) {
      seen.add(f.id);
      reported++;
      console.log(
        JSON.stringify({
          tick: w.tick, day: Number((w.tick / eco.dayTicks).toFixed(2)), flag: f.id, owner: f.owner, tile: f.tile, building: f.building, roads: f.roads.length,
          landUse: land.use[f.tile], landRef: land.ref[f.tile], feature: land.feature[f.tile],
          buildingsOnTile: eco.buildings.filter((b) => b.alive && b.tile === f.tile).map((b) => `${b.id}:${b.def.id}:owner${b.owner}`),
          flagsOnTile: eco.flags.filter((g) => g.alive && g.tile === f.tile).map((g) => g.id),
        }),
      );
      // The building the flag belongs to: its tile and why none of that tile's neighbours can take a flag.
      const b = eco.buildings[f.building];
      if (b) {
        const grid = land.planet.grid;
        console.log(
          JSON.stringify({
            building: b.def.id, buildingTile: b.tile, slope: Number(land.slope(b.tile).toFixed(2)), degree: grid.degree(b.tile), territory: land.territory[b.tile],
            bestFlagTile: land.bestFlagTile(b.tile, f.owner),
            neighbours: Array.from(grid.neighborsOf(b.tile)).map((n) => ({ n, land: land.isLand(n), slope: Number(land.slope(n).toFixed(2)), blocker: land.flagBlocker(n, f.owner), use: land.use[n], feature: land.feature[n] })),
          }),
        );
      }
      console.log(recent.join("\n"));
    }
  }
}
console.log(`stopped at tick ${w.tick}, ${reported} failing flags`);
