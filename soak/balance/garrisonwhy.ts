import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * Who holds a lantern building's places: `node garrisonwhy.mjs <size> <seed> <day> <seat> [peace] [armed]` plays the assess game with
 * war (as keepwhy) to `day` and prints, for each of the seat's lantern buildings, its places, wanted wardens and each garrison entry:
 * the settler's id, whether it is alive, its role, state and building, and whether its person is alive or held captive. Read-only.
 */
const [size, seed, dayArg, seatArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?, string?];
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
while (w.tick < Number(dayArg) * eco.dayTicks) w.step();
for (const b of eco.buildings) {
  if (!b.alive || !b.built || b.owner !== seat || !b.def.slots) continue;
  const entries = b.garrison.map((id) => {
    const s = eco.settlers[id];
    if (!s) return `${id}:none`;
    const p = eco.people[s.person];
    return `${id}:${s.alive ? "" : "DEAD,"}${s.role}/${s.state}@${s.building}${p ? (p.alive ? "" : ",person dead") + (p.captive !== undefined ? ",captive" : "") : ",no person"}`;
  });
  console.log(`${b.def.id} ${b.id} threat ${b.threat} places ${eco.wardenPlaces(b)} want ${eco.garrisonWant(b)} garrison ${b.garrison.length} on watch ${eco.defendersOf(b).length}: ${entries.join(" ")}`);
  const e = eco as unknown as { route(a: number, b: number): { dist: number }; pickWarden(b: unknown): { origin: { id: number }; person: { id: number } } | null };
  const keep = eco.buildings[eco.keeps[seat] ?? -1];
  const f = eco.flags[b.flag]!;
  const route = keep ? e.route(keep.flag, b.flag).dist : -1;
  const pick = b.garrison.length < eco.garrisonWant(b) ? e.pickWarden(b) : null;
  console.log(`  flag ${b.flag} roads ${f.roads.filter((r) => r >= 0).length} stranded ${b.stranded} route from keep ${route === Infinity ? "none" : route.toFixed(0)} pick ${pick ? pick.person.id : "-"}`);
}
const free = eco.people.filter((x) => x.alive && x.owner === seat && x.stage === "adult" && x.settler < 0);
console.log(`free adults ${free.length}; wounded ${free.filter((x) => x.woundedUntil > w.tick).length}`);
