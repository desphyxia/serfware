import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { GOODS } from "../../src/sim/econ/defs";
import { FLAG_CAPACITY, transportOptions, type Flag } from "../../src/sim/econ/economy";

/**
 * What puts a 9th good on a flag (#163): `node flag9.mjs <size> <seed> <days> [lattice] [from=<day>]` plays the assess game
 * (standard stack, three rivals, no war) like `run.ts` does and, from day `from` (default 20), watches every flag that holds a
 * full load: the first push that takes one over the capacity is reported with its stack, and the flag, its roads, carriers
 * and goods are dumped. Stops at the first flag over the capacity or at the last day.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
const from = Number(flags.find((f) => f.startsWith("from="))?.slice(5) ?? 20);
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
aiOptions.borderReach = aiOptions.borderClear = aiOptions.surveyAgain = aiOptions.borderCandidates = aiOptions.woodByNeed = false;
aiOptions.reserveRail = aiOptions.railWithSites = aiOptions.orderEarly = false;
aiOptions.foodWithoutIdle = true;
transportOptions.breakRings = false;
Error.stackTraceLimit = 14;
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
const priv = eco as unknown as { nextHop(g: unknown): number; settlers: Record<number, { state: string; target: number; carryGood: number; roadIdx: number }> };
const goodName = (type: number) => GOODS[type]?.id ?? String(type);
const watched = new WeakSet<number[]>();
let reported = false;
/** A flag is watched from the time it holds this many goods. */
const WATCH_FROM = 5;

function dump(f: Flag, how: string): void {
  console.log(`day ${(w.tick / eco.dayTicks).toFixed(2)} tick ${w.tick}: flag ${f.id} (owner ${f.owner}) over the capacity by ${how}; goods ${f.goods.length}, reserved ${f.reserved}`);
  console.log(`  tile ${f.tile} ${f.tile >= land.tileCount ? "(a corner)" : "(a tile centre)"}, building ${f.building} ${f.building >= 0 ? (eco.buildings[f.building]?.def.id ?? "") : ""}`);
  for (const rid of f.roads) {
    const r = eco.roads[rid];
    if (!r) continue;
    const c = r.carrier >= 0 ? priv.settlers[r.carrier] : undefined;
    console.log(`  road ${rid} ${r.a}-${r.b} ${r.tiles.length} tiles${r.ferry ? " ferry" : ""}${r.alive ? "" : " DEAD"}: carrier ${r.carrier} ${c ? `${c.state} target ${c.target} carrying ${c.carryGood}` : ""}, helpers ${r.helpers.length}`);
  }
  for (const gid of f.goods) {
    const g = eco.goods[gid];
    if (!g) continue;
    const d = eco.buildings[g.dest];
    console.log(`  good ${gid} ${goodName(g.type)} -> building ${g.dest} ${d ? d.def.id : "?"} (flag ${d?.flag ?? -1}), hop ${g.dest >= 0 ? priv.nextHop(g) : "-"}, carrier ${g.carrier}, waited ${((w.tick - g.since) / eco.dayTicks).toFixed(2)} days, flag field ${g.flag}`);
  }
}

/** The last events on each watched flag: pushes and splices of its goods and every change of `reserved`, with the callers. */
const events = new Map<number, string[]>();
const note = (f: Flag, text: string) => {
  const list = events.get(f.id) ?? [];
  events.set(f.id, list);
  const frames = String(new Error().stack)
    .split("\n")
    .slice(3, 12)
    .map((l) => l.trim().replace(/^at (\S+) .*$/, "$1"))
    .join("<");
  list.push(`t${w.tick} ${text} [${frames}]`);
  if (list.length > 40) list.shift();
};
const reservedOf = new WeakSet<Flag>();
const dropAt = (eco as unknown as { dropAt(s: { id: number; target: number; back: number; carryGood: number }, road: { id: number }, at: number): boolean }).dropAt;
(eco as unknown as { dropAt: unknown }).dropAt = function (this: unknown, s: { id: number; target: number; back: number; carryGood: number }, road: { id: number }, at: number) {
  const f = eco.flags[at] as Flag;
  if (events.has(at)) note(f, `dropAt carrier ${s.id} road ${road.id}: target ${s.target}, back ${s.back}, flag has ${f.goods.length}+${f.reserved}, good ${s.carryGood}`);
  return dropAt.call(this, s, road, at);
};

function watch(f: Flag): void {
  if (!reservedOf.has(f)) {
    reservedOf.add(f);
    let value = f.reserved;
    Object.defineProperty(f, "reserved", {
      get: () => value,
      set: (v: number) => {
        if (v !== value) note(f, `reserved ${value}->${v} (goods ${f.goods.length})`);
        value = v;
      },
      enumerable: true,
      configurable: true,
    });
    events.set(f.id, events.get(f.id) ?? []);
  }
  if (watched.has(f.goods)) return;
  watched.add(f.goods);
  for (const op of ["push", "unshift", "splice"] as const) {
    const orig = f.goods[op] as (...a: number[]) => unknown;
    (f.goods as unknown as Record<string, unknown>)[op] = function (this: number[], ...a: number[]) {
      const r = orig.apply(this, a);
      note(f, `${op}(${a.join(",")}) -> ${this.length} goods`);
      if (!reported && this.length > FLAG_CAPACITY) {
        reported = true;
        console.log(`${op} took flag ${f.id} to ${this.length} goods; stack:`);
        console.log(String(new Error().stack).split("\n").slice(2, 12).join("\n"));
      }
      return r;
    };
  }
}

for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) {
    w.step();
    if (d < from) continue;
    for (const f of eco.flags) {
      if (!f.alive) continue;
      if (f.goods.length > FLAG_CAPACITY) {
        dump(f, reported ? "the push above" : "an unwatched route");
        console.log(`  last events on flag ${f.id}:`);
        for (const e of events.get(f.id) ?? []) console.log(`    ${e}`);
        process.exit(0);
      }
      if (f.goods.length >= WATCH_FROM) watch(f);
    }
  }
}
console.log(`${size} ${seed}: no flag over ${FLAG_CAPACITY} goods in ${days} days (watching from day ${from})`);
