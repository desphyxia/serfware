import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";

/**
 * Why a Hearthship falls without a fight: `node keepwhy.mjs <size> <seed> <from> <to> [peace] [armed]` plays the assess game with war
 * (the default AI, lattice roads, peace 5 unless given; `armed` plays armed wardens) and from day `from` to `to` prints, each time
 * wardens start marching on a Hearthship and when it changes hands: its owner's wardens on watch there and its reserve, the owner's
 * adults by what they are doing (free to take up arms or not), the owner's lanterns and wardens on watch, and the attackers on their way.
 * Read-only.
 */
const [size, seed, fromArg, toArg, peaceArg, armedArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?, string?];
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
const day = () => (w.tick / eco.dayTicks).toFixed(3);
const startTick = Number(fromArg) * eco.dayTicks;
const endTick = Number(toArg) * eco.dayTicks;
const keepIds = eco.keeps.filter((k) => k !== undefined) as number[];
const owners = new Map(keepIds.map((k) => [k, eco.buildings[k]!.owner]));
const marching = new Map<number, number>();
const describe = (k: number, why: string) => {
  const b = eco.buildings[k]!;
  const p = owners.get(k) as number;
  const adults = eco.people.filter((x) => x.alive && x.owner === p && x.stage === "adult");
  const free = adults.filter((x) => x.settler < 0 && x.woundedUntil <= w.tick).length;
  const byRole = new Map<string, number>();
  for (const x of adults) {
    if (x.settler < 0) continue;
    const s = eco.settlers[x.settler];
    const key = s ? `${s.role}:${s.state}` : "?";
    byRole.set(key, (byRole.get(key) ?? 0) + 1);
  }
  const lanterns = eco.buildings.filter((x) => x.alive && x.built && x.owner === p && x.def.slots);
  const watch = lanterns.reduce((n, x) => n + eco.defendersOf(x).length, 0);
  const atk = eco.settlers.filter((s) => s.alive && s.role === "attacker" && s.building === k);
  console.log(
    `day ${day()} ${why}: keep ${k} of seat ${p} now owner ${b.owner}; on watch in it ${eco.defendersOf(b).length} (garrison ${b.garrison.length}, wants ${eco.garrisonWant(b)}); adults ${adults.length}, free to take up arms ${free}; busy ${[...byRole].sort((a, c) => c[1] - a[1]).slice(0, 6).map(([r, n]) => `${r} ${n}`).join(", ")}`,
  );
  console.log(`  seat ${p}: ${lanterns.length} lit lantern buildings, ${watch} wardens on watch; attackers on it ${atk.length} from seat(s) ${[...new Set(atk.map((s) => s.owner))].join(",")} states ${atk.map((s) => s.state).join(",")}`);
};
while (w.tick < endTick) {
  w.step();
  if (w.tick < startTick) continue;
  for (const k of keepIds) {
    const n = eco.settlers.filter((s) => s.alive && s.role === "attacker" && s.building === k).length;
    if (n > (marching.get(k) ?? 0)) describe(k, `${n} attackers on their way`);
    marching.set(k, n);
    const b = eco.buildings[k]!;
    if (b.owner !== owners.get(k)) {
      describe(k, "taken");
      owners.set(k, b.owner);
    }
  }
}
