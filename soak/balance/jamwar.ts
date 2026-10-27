import { AiBuilder } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Goods piling up after a conquest: `node jamwar.mjs <size> <seed> <seat> <from> <to> [peace]` plays the assess game as the sweep
 * does with war (the default AI, lattice roads, peace 5 unless given) and, each day from `from` to `to`, prints for one seat its
 * people, carriers, flags and goods on them; from the first day with 60 goods on its flags, the fullest flags with each good's
 * destination, route length and next hop, and whether that next flag is full. Read-only.
 */
const [size, seed, seatArg, fromArg, toArg, peaceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string, string?];
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
const hopOf = (eco as unknown as { nextHop(g: unknown): number }).nextHop.bind(eco);
for (let d = 1; d <= Number(toArg); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d < Number(fromArg)) continue;
  const mine = eco.flags.filter((f) => f.alive && f.owner === seat);
  const total = mine.reduce((a, f) => a + f.goods.length, 0);
  const full = mine.filter((f) => f.goods.length + f.reserved >= 8);
  const people = eco.people.filter((p) => p.alive && p.owner === seat);
  const homeless = people.filter((p) => p.house < 0).length;
  const settlers = eco.settlers.filter((s) => s.alive && s.owner === seat);
  const roles = new Map<string, number>();
  for (const s of settlers) roles.set(`${s.role}:${s.state}`, (roles.get(`${s.role}:${s.state}`) ?? 0) + 1);
  const roads = eco.roads.filter((r) => r.alive && r.owner === seat);
  const noCarrier = roads.filter((r) => r.carrier < 0).length;
  const foreign = eco.flags.filter((f) => f.alive && f.owner !== seat && f.goods.length).reduce((m, f) => m.set(f.owner, (m.get(f.owner) ?? 0) + f.goods.length), new Map<number, number>());
  console.log(`day ${d}: people ${people.length} homeless ${homeless} settlers ${settlers.length} roads ${roads.length} no carrier ${noCarrier} flags ${mine.length} goods ${total} full ${full.length} | goods on others' flags ${JSON.stringify([...foreign])} | defeated ${JSON.stringify(eco.defeated)}`);
  console.log(`  settlers by role:state ${[...roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (total < 60) continue;
  // The full flags no good can leave (as in ringwhy.ts): each good's next hop is another flag of the set with no good coming back.
  const hops = new Map<number, number[]>();
  for (const f of full) hops.set(f.id, f.goods.map((gid) => eco.goods[gid]!).filter((g) => g.alive).map((g) => (g.carrier >= 0 ? -3 : hopOf(g))));
  const stuck = new Set(full.map((f) => f.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...stuck]) {
      const movable = (hops.get(id) ?? []).some((h) => h === -3 || (h >= 0 && (!stuck.has(h) || (hops.get(h) ?? []).includes(id))));
      if (movable) {
        stuck.delete(id);
        changed = true;
      }
    }
  }
  console.log(`  deadlocked ${stuck.size} of ${full.length} full flags; ring turns so far ${eco.ringBreaks}`);
  for (const id of stuck) {
    const byHop = new Map<number, number>();
    for (const h of hops.get(id) ?? []) byHop.set(h, (byHop.get(h) ?? 0) + 1);
    const f = eco.flags[id]!;
    console.log(`    flag ${id} (${f.building >= 0 ? eco.buildings[f.building]!.def.id : "none"}) goods ${f.goods.length} reserved ${f.reserved} hops ${[...byHop.entries()].map(([h, n]) => `${n}x->${h}`).join(" ")}`);
  }
  if (stuck.size) {
    const path: number[] = [[...stuck][0] as number];
    for (;;) {
      const next = (hops.get(path[path.length - 1] as number) ?? []).find((h) => h >= 0 && stuck.has(h));
      if (next === undefined) break;
      const at = path.indexOf(next);
      if (at >= 0) {
        console.log(`    cycle (${path.length - at} flags): ${[...path.slice(at), next].join(" -> ")}`);
        break;
      }
      path.push(next);
    }
  }
  const fullIds = new Set(full.map((f) => f.id));
  for (const f of [...mine].sort((a, b) => b.goods.length - a.goods.length).slice(0, 5)) {
    const b = f.building >= 0 ? eco.buildings[f.building] : undefined;
    const rs = f.roads.map((rid) => {
      const r = eco.roads[rid]!;
      const other = r.a === f.id ? r.b : r.a;
      return `flag ${other}${fullIds.has(other) ? " FULL" : ""} len ${r.tiles.length} carrier ${r.carrier >= 0 ? (eco.settlers[r.carrier]?.state ?? "?") : "NO"}`;
    });
    console.log(`  flag ${f.id} tile ${f.tile} on ${b ? `${b.def.id}(owner ${b.owner})` : "none"} goods ${f.goods.length} reserved ${f.reserved}: ${rs.join("; ")}`);
    const seen = new Map<string, number>();
    for (const gid of f.goods) {
      const g = eco.goods[gid];
      if (!g || !g.alive) continue;
      const dest = g.dest >= 0 ? eco.buildings[g.dest] : undefined;
      const route = dest ? eco.route(f.id, dest.flag) : undefined;
      const key = `${GOODS[g.type]?.id}->${dest ? `${dest.def.id}(owner ${dest.owner}${dest.alive ? "" : " dead"})` : "none"} route ${route ? (route.dist === Infinity ? "none" : route.dist) : "-"}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    console.log(`    ${[...seen.entries()].map(([k, v]) => `${v}x ${k}`).join("; ")}`);
  }
}
