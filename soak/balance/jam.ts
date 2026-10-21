import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { FLAG_CAPACITY, transportOptions, type Flag, type Good, type Building } from "../../src/sim/econ/economy";
import { GOODS } from "../../src/sim/econ/defs";

/**
 * Jams of goods on flags (#169): `node jam.mjs <size> <seed> <days> [lattice] [norings] [dump=<day>,<day>...]` plays the assess game (the
 * standard stack, three rivals, no war). Every 5 days it prints per seat the goods stuck on flags (waiting 6 game hours or more, as
 * the sweep counts them) and the full flags. On the dump days it opens up each seat with 20 stuck goods or more: the stuck goods by
 * what they wait for (no destination; the next flag full; the next flag with room; no route; the building at this very flag), by
 * good, how many sit on flags at tile corners, and the rings of full flags (each holding a good bound for the next). `norings` plays without
 * `transportOptions.breakRings`. Read-only: it only reads the economy.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
transportOptions.breakRings = !flags.includes("norings");
const dump = (flags.find((f) => f.startsWith("dump="))?.slice(5) ?? "").split(",").filter(Boolean).map(Number);
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
const hop = (g: Good): number => (eco as unknown as { nextHop(g: Good): number }).nextHop(g);

const stuckOf = (p: number): Good[] => {
  const out: Good[] = [];
  for (const f of eco.flags) {
    if (!f.alive || f.owner !== p) continue;
    for (const id of f.goods) {
      const g = eco.goods[id];
      if (g?.alive && (eco.tick - g.since) / hour >= 6) out.push(g);
    }
  }
  return out;
};
const fullOf = (p: number): Flag[] => eco.flags.filter((f) => f.alive && f.owner === p && f.goods.length + f.reserved >= FLAG_CAPACITY);

const open = (day: number, p: number) => {
  const stuck = stuckOf(p);
  const why: Record<string, number> = {};
  const byGood: Record<string, number> = {};
  const bound: Record<string, number> = {};
  const hopOf = new Map<number, Set<number>>();
  for (const g of stuck) {
    const f = eco.flags[g.flag] as Flag;
    let k: string;
    if (g.carrier >= 0) k = "a carrier has promised it";
    else if (g.dest < 0) k = "no destination";
    else {
      const h = hop(g);
      if (h === -2) k = "bound for the building at this flag";
      else if (h < 0) k = "no route";
      else {
        const t = eco.flags[h] as Flag;
        k = t.goods.length + t.reserved >= FLAG_CAPACITY ? "next flag full" : "next flag has room";
        (hopOf.get(f.id) ?? hopOf.set(f.id, new Set()).get(f.id)!).add(h);
      }
    }
    why[k] = (why[k] ?? 0) + 1;
    const db = g.dest >= 0 ? (eco.buildings[g.dest] as Building) : null;
    const dk = db ? `${db.def.id}${db.def.storage ? "(store)" : ""}` : "none";
    bound[dk] = (bound[dk] ?? 0) + 1;
    const name = GOODS[g.type]?.id ?? String(g.type);
    byGood[name] = (byGood[name] ?? 0) + 1;
  }
  const full = fullOf(p);
  const corner = (f: Flag) => (land.lattice ? f.tile >= land.tileCount : false);
  const stuckFlags = new Set(stuck.map((g) => g.flag));
  console.log(`  day ${day} seat ${p}: ${stuck.length} stuck on ${stuckFlags.size} flags; ${full.length} full flags (${full.filter(corner).length} on corners); roads out of the stuck flags: ${[...stuckFlags].map((id) => (eco.flags[id] as Flag).roads.length).sort((a, b) => a - b).join(",")}`);
  console.log("    waiting for: " + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(" | "));
  console.log("    bound for: " + Object.entries(bound).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" "));
  const stores = eco.buildings.filter((b) => b.alive && b.built && b.owner === p && b.def.storage);
  console.log("    stores: " + stores.map((s) => `${s.def.id}@flag${s.flag} (flag ${(eco.flags[s.flag] as Flag).goods.length}+${(eco.flags[s.flag] as Flag).reserved} goods, ${s.stock.reduce((a, n) => a + n, 0)} stored)`).join("; "));
  console.log("    goods: " + Object.entries(byGood).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" "));
  // Rings: full flags that hold a good bound for the next full flag, round to the start.
  const fullIds = new Set(full.map((f) => f.id));
  const edges = new Map<number, number[]>();
  for (const f of full) {
    const hs = new Set<number>();
    for (const id of f.goods) {
      const g = eco.goods[id] as Good;
      if (g.carrier >= 0 || g.dest < 0) continue;
      const h = hop(g);
      if (h >= 0 && fullIds.has(h)) hs.add(h);
    }
    edges.set(f.id, [...hs].sort((a, b) => a - b));
  }
  const state = new Map<number, number>();
  let cycles = 0;
  let longest = 0;
  const path: number[] = [];
  const dfs = (a: number) => {
    state.set(a, 1);
    path.push(a);
    for (const b of edges.get(a) ?? []) {
      const s = state.get(b) ?? 0;
      if (s === 1) {
        cycles++;
        longest = Math.max(longest, path.length - path.indexOf(b));
      } else if (s === 0) dfs(b);
    }
    path.pop();
    state.set(a, 2);
  };
  for (const id of fullIds) if (!state.has(id)) dfs(id);
  console.log(`    full flags with a good bound for another full flag: ${[...edges.values()].filter((e) => e.length).length}; cycles found ${cycles}, longest ${longest}`);
};

/** The shape of a seat's road network: flags, flags with 3 or more roads, and the triangles and 4-cycles of its flag graph. */
const shape = (p: number): string => {
  const adj = new Map<number, Set<number>>();
  for (const r of eco.roads) {
    if (!r.alive || r.owner !== p || r.a === r.b) continue;
    (adj.get(r.a) ?? adj.set(r.a, new Set()).get(r.a)!).add(r.b);
    (adj.get(r.b) ?? adj.set(r.b, new Set()).get(r.b)!).add(r.a);
  }
  let tri = 0;
  let quad = 0;
  for (const [a, na] of adj) {
    for (const b of na) {
      if (b <= a) continue;
      for (const c of adj.get(b) ?? []) {
        if (c <= b) continue;
        if (na.has(c)) tri++;
      }
    }
  }
  // 4-cycles a-b-c-d-a: count pairs (b, d) of neighbours of a that share another neighbour c, once per cycle.
  for (const [a, na] of adj) {
    const via = new Map<number, number>();
    for (const b of na) for (const c of adj.get(b) ?? []) if (c > a) via.set(c, (via.get(c) ?? 0) + 1);
    for (const n of via.values()) quad += (n * (n - 1)) / 2;
  }
  const deg3 = [...adj.values()].filter((s) => s.size >= 3).length;
  return `flags ${adj.size} deg3+ ${deg3} triangles ${tri} 4-cycles ${quad / 2}`;
};

console.log(`${size} ${seed} ${days} days ${lattice ? "LATTICE" : "tile-centre roads"}${transportOptions.breakRings ? " +breakRings" : ""}`);
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
  if (d % 5 === 0) {
    const row: string[] = [];
    for (let p = 1; p <= 3; p++) row.push(`seat ${p}: stuck ${stuckOf(p).length} full ${fullOf(p).length} bld ${eco.buildings.filter((b: Building) => b.alive && b.built && b.owner === p).length}`);
    console.log(`day ${String(d).padStart(2)}  ${row.join("  |  ")}`);
    if (d % 10 === 0) for (let p = 1; p <= 3; p++) console.log(`      seat ${p} network: ${shape(p)}`);
  }
  if (dump.includes(d)) for (let p = 1; p <= 3; p++) if (stuckOf(p).length >= 20) open(d, p);
}
