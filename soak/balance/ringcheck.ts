import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { FLAG_CAPACITY } from "../../src/sim/econ/economy";

/**
 * Why ring breaking leaves a jam: `node ringcheck.mjs <size> <seed> <seat> <day> [peace]` plays the assess game with war (the default
 * AI, lattice roads, peace 5 unless given) to `day` and, over `seat`'s full flags, finds those no good can leave (every good's next
 * hop is a full flag with nothing to swap back), the cycles among them in the next-hop graph, and for each good waiting on one for a
 * full flag what keeps `chooseTransfer` from putting it over the capacity: the target already over it, the ring longer than
 * RING_DEPTH, or the walk failing on a flag that is not full. Read-only.
 */
const [size, seed, seatArg, dayArg, peaceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string?];
const seat = Number(seatArg);
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: Number(peaceArg ?? 5),
  latticeRoads: true,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const priv = eco as unknown as { nextHop(g: unknown): number; returnGood(r: unknown, at: number, c: number): number };
const stopTick = Number(dayArg) * eco.dayTicks;
while (w.tick < stopTick) w.step();
const F = (id: number) => eco.flags[id]!;
const full = (id: number) => F(id).goods.length + F(id).reserved >= FLAG_CAPACITY;
const roadBetween = (a: number, b: number) => F(a).roads.map((r) => eco.roads[r]!).find((r) => r.alive && (r.a === b || r.b === b));
const hopsOf = (id: number) => {
  const out: number[] = [];
  for (const gid of F(id).goods) {
    const g = eco.goods[gid]!;
    if (g.carrier >= 0 || g.dest < 0) continue;
    const h = priv.nextHop(g);
    if (h >= 0) out.push(h);
  }
  return out;
};
const mine = eco.flags.filter((f) => f.alive && f.owner === seat && full(f.id)).map((f) => f.id);
const hops = new Map(mine.map((id) => [id, hopsOf(id)]));
// A flag is free when a good can leave it: its next hop is not full, goes into the building there, or has a good to swap back.
const stuck = new Set(mine);
const freedBy = new Map<string, number>();
for (let changed = true; changed; ) {
  changed = false;
  for (const id of [...stuck]) {
    let reason = "";
    for (const gid of F(id).goods) {
      const g = eco.goods[gid]!;
      if (g.carrier >= 0) {
        reason = "a good already taken";
        break;
      }
      if (g.dest < 0) continue;
      const h = priv.nextHop(g);
      if (h < 0) continue;
      if (eco.buildings[g.dest]?.flag === h) reason = "a good for the building at the next flag";
      else if (!stuck.has(h)) reason = mine.includes(h) ? "next hop a full flag freed earlier" : `next hop not full (${F(h).goods.length}+${F(h).reserved}, owner ${F(h).owner})`;
      else {
        const r = roadBetween(id, h);
        if (r && priv.returnGood(r, h, -1) >= 0) reason = "a good to swap back";
      }
      if (reason) break;
    }
    if (reason) {
      stuck.delete(id);
      freedBy.set(reason.replace(/\(.*\)/, "").trim(), (freedBy.get(reason.replace(/\(.*\)/, "").trim()) ?? 0) + 1);
      changed = true;
    }
  }
}
console.log(`  full flags freed by: ${JSON.stringify(Object.fromEntries(freedBy))}`);
const sizes = [...stuck].map((id) => `${id}:${F(id).goods.length}+${F(id).reserved}`);
console.log(`day ${dayArg} seat ${seat}: ${mine.length} full flags, ${stuck.size} no good can leave: ${sizes.join(" ")}`);
// Cycles in the next-hop graph among the stuck flags (shortest through each flag, by breadth-first search).
const seenCycles = new Set<string>();
for (const start of stuck) {
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  let found: number[] | null = null;
  while (queue.length && !found) {
    const at = queue.shift() as number;
    for (const h of new Set(hops.get(at) ?? [])) {
      if (!stuck.has(h)) continue;
      if (h === start) {
        const cyc = [at];
        for (let p = prev.get(at) as number; p >= 0; p = prev.get(p) as number) cyc.push(p);
        found = cyc.reverse();
        break;
      }
      if (!prev.has(h)) {
        prev.set(h, at);
        queue.push(h);
      }
    }
  }
  if (!found) continue;
  const key = [...found].sort((a, b) => a - b).join(",");
  if (seenCycles.has(key)) continue;
  seenCycles.add(key);
  console.log(`  cycle of ${found.length}: ${found.map((id) => `${id}(${F(id).goods.length}+${F(id).reserved})`).join(" -> ")} -> ${start}`);
}
if (!seenCycles.size) console.log("  no cycle among them: the stuck flags drain into each other without coming back");
// What the ring rule sees for each stuck good, without its time gates.
const ringDepth = (from: number, to: number, limit: number): number => {
  const seen = new Set<number>([from, to]);
  let best = -1;
  const walk = (at: number, depth: number): boolean => {
    const flag = F(at);
    if (flag.goods.length + flag.reserved < FLAG_CAPACITY || depth > limit) return false;
    const hs = new Set(hopsOf(at));
    if (hs.has(from)) {
      best = depth;
      return true;
    }
    for (const h of [...hs].sort((a, b) => a - b)) {
      if (seen.has(h)) continue;
      seen.add(h);
      if (walk(h, depth + 1)) return true;
    }
    return false;
  };
  walk(to, 1);
  return best;
};
const why = new Map<string, number>();
for (const id of stuck) {
  for (const gid of F(id).goods) {
    const g = eco.goods[gid]!;
    if (g.carrier >= 0 || g.dest < 0) continue;
    const to = priv.nextHop(g);
    if (to < 0) {
      why.set("no next hop", (why.get("no next hop") ?? 0) + 1);
      continue;
    }
    const t = F(to);
    let k: string;
    if (F(id).goods.length < FLAG_CAPACITY) k = "own flag under 8 goods (reserved places make it full)";
    else if (t.goods.length + t.reserved > FLAG_CAPACITY) k = `target over capacity (${t.goods.length}+${t.reserved})`;
    else {
      const d = ringDepth(id, to, 12);
      const d99 = d >= 0 ? d : ringDepth(id, to, 999);
      k = d >= 0 ? `ring found within RING_DEPTH (depth ${d})` : d99 >= 0 ? `ring only deeper than RING_DEPTH (depth ${d99})` : "no ring back to this flag";
    }
    why.set(k, (why.get(k) ?? 0) + 1);
  }
}
console.log("  goods on stuck flags, by what the ring rule sees:");
for (const [k, v] of [...why].sort((a, b) => b[1] - a[1])) console.log(`    ${v}x ${k}`);
