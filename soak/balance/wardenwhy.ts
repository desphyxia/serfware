import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { goodId } from "../../src/sim/econ/defs";
import { World } from "../../src/sim/world";

/**
 * Why a seat's wardens stop growing and so few can attack: `node wardenwhy.mjs <size> <seed> <to> [every] [peace] [armed]` plays the
 * assess game with war (as keepwhy) and every `every` days (default 10) prints, per seat still standing: its lantern buildings by
 * kind (built and lit, on the front, warden places, wanted, on watch, and how many could go to an attack, one staying at home), the
 * sites of lantern buildings standing, those with no road route from the Hearthship (cut off), adults and those free for a job, wardens in all, and planks and stone in the stores. Read-only.
 */
const [size, seed, toArg, everyArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string?, string?, string?];
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
const every = Number(everyArg ?? 10) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
const seats = eco.keeps.map((_, i) => i);
const kinds = ["lantern", "lamphouse", "beacon"];
let next = every;
while (w.tick < endTick) {
  w.step();
  if (w.tick < next) continue;
  next += every;
  console.log(`day ${(w.tick / eco.dayTicks).toFixed(0)}`);
  for (const p of seats) {
    if (eco.defeated[p]) continue;
    const parts: string[] = [];
    for (const k of kinds) {
      const bs = eco.buildings.filter((b) => b.alive && b.owner === p && b.def.id === k && b.built);
      const front = bs.filter((b) => b.threat >= 2);
      const sites = eco.buildings.filter((b) => b.alive && b.owner === p && b.def.id === k && !b.built).length;
      const places = bs.reduce((n, b) => n + eco.wardenPlaces(b), 0);
      const want = bs.reduce((n, b) => n + eco.garrisonWant(b), 0);
      const on = bs.reduce((n, b) => n + eco.defendersOf(b).length, 0);
      const spare = front.reduce((n, b) => n + Math.max(0, eco.defendersOf(b).length - 1), 0);
      parts.push(`${k} ${bs.length} (front ${front.length}, sites ${sites}) places ${places} want ${want} on ${on} spare-at-front ${spare}`);
    }
    const adults = eco.people.filter((x) => x.alive && x.owner === p && x.stage === "adult");
    const free = adults.filter((x) => x.settler < 0).length;
    const wardens = eco.settlers.filter((s) => s.alive && s.owner === p && (s.role === "warden" || s.role === "attacker")).length;
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    const e = eco as unknown as { route(a: number, b: number): { dist: number } };
    const cut = eco.buildings.filter((b) => b.alive && b.built && b.owner === p && b.def.slots && keep && e.route(keep.flag, b.flag).dist === Infinity);
    const cutTxt = `cut off ${cut.length} (front ${cut.filter((b) => b.threat >= 2).length}) want ${cut.reduce((n, b) => n + eco.garrisonWant(b), 0)} on ${cut.reduce((n, b) => n + eco.defendersOf(b).length, 0)}`;
    const st = eco.storageTotals(p);
    console.log(`  seat ${p}: ${parts.join(" | ")}; adults ${adults.length} free ${free}; wardens ${wardens}; ${cutTxt}; plank ${st[goodId("plank")] ?? 0} stone ${st[goodId("stone")] ?? 0}`);
  }
}
