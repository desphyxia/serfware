import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";
import { transportOptions } from "../../src/sim/econ/economy";

/**
 * Is a jam a ring of full flags: `node ringwhy.mjs <size> <seed> <seat> <days> [turn] [wide] [w=<weight>]` plays the assess game
 * (full AI stack, no war, three rivals; `rings` plays `transportOptions.breakRings`) and, every 10 days, takes the full flags of one seat (8 goods with those reserved) and
 * keeps those where no good can move: each good's next hop is a flag in the same set, and the flag it goes to holds no good that
 * comes back (a swap). What is left is deadlocked as long as nothing else changes. Prints that set, each flag's goods by next hop,
 * and a cycle through it. Read-only.
 */
const [size, seed, seatArg, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, ...string[]];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = flags.includes("turn");
aiOptions.widePlacement = flags.includes("wide");
transportOptions.breakRings = flags.includes("rings");
for (const f of flags) if (f.startsWith("w=")) aiOptions.turnPartnerWeight = Number(f.slice(2));
const seat = Number(seatArg);
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
const hopOf = (eco as unknown as { nextHop(g: unknown): number }).nextHop.bind(eco);
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d % 10 !== 0) continue;
  const mine = eco.flags.filter((f) => f.alive && f.owner === seat);
  const total = mine.reduce((a, f) => a + f.goods.length, 0);
  const full = mine.filter((f) => f.goods.length + f.reserved >= 8);
  // The hop of each good on each full flag.
  const hops = new Map<number, number[]>();
  for (const f of full) {
    const hs: number[] = [];
    for (const gid of f.goods) {
      const g = eco.goods[gid];
      if (!g || !g.alive) continue;
      hs.push(g.carrier >= 0 ? -3 : hopOf(g));
    }
    hops.set(f.id, hs);
  }
  const inSet = new Set(full.map((f) => f.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...inSet]) {
      const movable = (hops.get(id) ?? []).some((h) => {
        if (h === -3) return true; // a carrier has it already
        if (h < 0) return false; // no route, or bound for a building on this flag
        if (!inSet.has(h)) return true; // the next flag is not stuck
        return (hops.get(h) ?? []).includes(id); // a swap
      });
      if (movable) {
        inSet.delete(id);
        changed = true;
      }
    }
  }
  console.log(`day ${d}: seat ${seat} flags ${mine.length} goods on flags ${total} full ${full.length} deadlocked ${inSet.size} ring turns so far ${eco.ringBreaks}`);
  if (inSet.size === 0) continue;
  for (const id of inSet) {
    const f = eco.flags[id]!;
    const b = f.building >= 0 ? eco.buildings[f.building] : undefined;
    const byHop = new Map<number, number>();
    for (const h of hops.get(id) ?? []) byHop.set(h, (byHop.get(h) ?? 0) + 1);
    console.log(`  flag ${id} (${b?.def.id ?? "none"}) goods ${f.goods.length} reserved ${f.reserved}: next hops ${[...byHop.entries()].map(([h, n]) => `${n}x->${h}`).join(" ")}`);
  }
  // A cycle: follow, from any deadlocked flag, a next hop that is also deadlocked, until a flag repeats.
  const start = [...inSet][0] as number;
  const path: number[] = [start];
  for (;;) {
    const here = path[path.length - 1] as number;
    const next = (hops.get(here) ?? []).find((h) => h >= 0 && inSet.has(h));
    if (next === undefined) break;
    const at = path.indexOf(next);
    if (at >= 0) {
      console.log(`  cycle: ${[...path.slice(at), next].join(" -> ")}`);
      break;
    }
    path.push(next);
  }
  const goodsByName = new Map<string, number>();
  for (const id of inSet) for (const gid of eco.flags[id]!.goods) goodsByName.set(GOODS[eco.goods[gid]!.type]?.id ?? "?", (goodsByName.get(GOODS[eco.goods[gid]!.type]?.id ?? "?") ?? 0) + 1);
  console.log(`  goods in the set: ${[...goodsByName.entries()].map(([k, v]) => `${v} ${k}`).join(", ")}`);
}
