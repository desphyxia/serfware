import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { GOODS } from "../../src/sim/econ/defs";
import { World } from "../../src/sim/world";

/**
 * Goods stranded on the flag of the building they are bound for: `node strand.mjs <size> <seed> <rivals> <days> [good id]`.
 * Without a good id: plays the game and, after every `supply` round, looks for goods lying on a flag with no carrier whose
 * destination building stands on that very flag (`candidates`). Prints one JSON line: the redirects that put a good there, every
 * candidate that stayed over 1500 ticks (when it first lay there, how it got its destination, how it ended), the sites that held
 * one (whether they finished), and per day the counts. With a good id: replays the same game and logs every change to that
 * good's fields with the call stack, and once a day the state of the good, its flag and its destination building.
 * BALANCE_EXTRA="none" turns every AI switch off (the pilot-6 ones too); otherwise as sites.ts. Read-only.
 */
const [size, seed, rivals, days, traceArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string, string | undefined];
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
const none = extra.includes("none");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = !none;
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
aiOptions.forgeRoom = extra.includes("forge");
const n = Number(rivals);
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden", "builder", "trader", "warden"].slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const STRANDED_TICKS = 1500;
const describe = (id: number) => {
  const b = eco.buildings[id];
  return b ? { id, building: b.def.id, built: b.built, storage: !!b.def.storage, owner: b.owner } : { id, building: "?" };
};
const tag = (type: number) => (GOODS[type] as { id: string }).id;

type Cand = { first: number; last: number; type: number; dest: number; flag: number; prev: { dest: number; storage: boolean } | null; viaRedirect: boolean };
const cands = new Map<number, Cand>();
const prevDest = new Map<number, { dest: number; storage: boolean }>();
const redirects: Record<string, unknown>[] = [];
const redirectIds = new Set<number>();
const done: Record<string, unknown>[] = [];
const sites = new Map<number, { building: string; owner: number; first: number; goods: Set<string>; finished: number; gone: number }>();
let supplyCalls = 0;

const holder = eco as unknown as { supply: () => void; spawnGood: (type: number, flag: number) => { id: number } };
const target = traceArg !== undefined ? Number(traceArg) : -1;
const log: Record<string, unknown>[] = [];

if (target >= 0) {
  // Replay: put accessors on the one good so every write to its fields is logged with the calls that made it.
  const spawn = holder.spawnGood.bind(eco);
  holder.spawnGood = (type: number, flag: number) => {
    const g = spawn(type, flag) as unknown as Record<string, unknown> & { id: number };
    if (g.id === target) {
      log.push({ tick: w.tick, event: "spawned", type: tag(type), flag, stack: new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim()) });
      for (const field of ["flag", "dest", "carrier", "since", "alive"]) {
        let v = g[field];
        Object.defineProperty(g, field, {
          enumerable: true,
          configurable: true,
          get: () => v,
          set: (nv: unknown) => {
            if (nv !== v && field !== "since") log.push({ tick: w.tick, field, old: v, new: nv, stack: new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim()) });
            v = nv;
          },
        });
      }
    }
    return g;
  };
}

// STRAND_BUILDING=<id>: log every write to that building's flag, built and builder fields (with the calls) and when it was created.
const watchBuilding = process.env.STRAND_BUILDING !== undefined ? Number(process.env.STRAND_BUILDING) : -1;
if (watchBuilding >= 0) {
  const holder2 = eco as unknown as { createBuilding: (...a: unknown[]) => Record<string, unknown> & { id: number } };
  const create = holder2.createBuilding.bind(eco);
  holder2.createBuilding = (...a: unknown[]) => {
    const b = create(...a);
    if (b.id === watchBuilding) {
      log.push({ tick: w.tick, event: "building created", args: a.map((x) => (typeof x === "object" ? "obj" : x)), flag: b.flag, stack: new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim()) });
      for (const field of ["flag", "built", "builder"]) {
        let v = b[field];
        Object.defineProperty(b, field, {
          enumerable: true,
          configurable: true,
          get: () => v,
          set: (nv: unknown) => {
            if (nv !== v) log.push({ tick: w.tick, building: watchBuilding, field, old: v, new: nv, stack: new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim()) });
            v = nv;
          },
        });
      }
    }
    return b;
  };
}
const original = holder.supply.bind(eco);
holder.supply = () => {
  supplyCalls++;
  const before = new Map<number, number>();
  for (const g of eco.goods) if (g.alive && g.carrier < 0 && g.flag >= 0 && g.dest >= 0 && eco.buildings[g.dest]?.def.storage) before.set(g.id, g.dest);
  original();
  for (const [id, was] of before) {
    const g = eco.goods[id];
    if (!g || !g.alive || g.dest === was || g.dest < 0) continue;
    if (eco.buildings[g.dest]?.flag === g.flag) {
      redirectIds.add(id);
      redirects.push({ tick: w.tick, good: id, type: tag(g.type), from: describe(was), to: describe(g.dest), flag: g.flag, goodsOnFlag: eco.flags[g.flag]?.goods.length });
    }
  }
  // Goods lying with no carrier on the flag of their own destination.
  for (const g of eco.goods) {
    if (!g.alive) continue;
    const here = g.carrier < 0 && g.flag >= 0 && g.dest >= 0 && eco.buildings[g.dest]?.alive && eco.buildings[g.dest]?.flag === g.flag && eco.flags[g.flag]?.goods.includes(g.id);
    const c = cands.get(g.id);
    if (here) {
      if (!c) cands.set(g.id, { first: w.tick, last: w.tick, type: g.type, dest: g.dest, flag: g.flag, prev: prevDest.get(g.id) ?? null, viaRedirect: redirectIds.has(g.id) });
      else c.last = w.tick;
      const b = eco.buildings[g.dest];
      if (b && !b.built && w.tick - (cands.get(g.id) as Cand).first >= STRANDED_TICKS) {
        const s = sites.get(b.id) ?? { building: b.def.id, owner: b.owner, first: w.tick, goods: new Set<string>(), finished: -1, gone: -1 };
        s.goods.add(tag(g.type));
        sites.set(b.id, s);
      }
    } else {
      if (c) {
        done.push({ good: g.id, type: tag(c.type), first: c.first, last: c.last, ticks: c.last - c.first, dest: describe(c.dest), flag: c.flag, viaRedirect: c.viaRedirect, prev: c.prev, endedAs: !g.alive ? "gone" : g.carrier >= 0 ? "carried" : g.dest !== c.dest ? "dest changed" : "left the flag" });
        cands.delete(g.id);
      }
      if (g.dest >= 0 && g.carrier < 0 && g.flag >= 0) prevDest.set(g.id, { dest: g.dest, storage: !!eco.buildings[g.dest]?.def.storage });
    }
  }
};

const daily: Record<string, unknown>[] = [];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  const standing = [...cands.entries()].filter(([, c]) => w.tick - c.first >= STRANDED_TICKS);
  const stuckSites = new Set(standing.map(([, c]) => c.dest).filter((id) => eco.buildings[id] && !eco.buildings[id]?.built));
  for (const [id, s] of sites) {
    const b = eco.buildings[id];
    if (b && b.built && s.finished < 0) s.finished = w.tick;
    if ((!b || !b.alive) && s.gone < 0) s.gone = w.tick;
  }
  daily.push({ day: d, strandedGoods: standing.length, sitesWithAStrandedGood: stuckSites.size, finishedGoodsOnOwnFlag: standing.length - stuckSites.size });
  if (target >= 0) {
    const g = eco.goods[target];
    if (g) {
      const b = g.dest >= 0 ? eco.buildings[g.dest] : undefined;
      const fl = eco.flags[g.flag];
      log.push({
        tick: w.tick, day: d, event: "day-end", alive: g.alive, flag: g.flag, dest: g.dest, destBuilding: b ? { ...describe(g.dest), flag: b.flag, dig: b.dig, builder: b.builder, delivered: b.delivered[g.type], pending: b.pending[g.type], cost: b.cost[g.type] } : null,
        carrier: g.carrier, since: g.since, goodsOnFlag: fl?.goods.length, roadsAtFlag: fl?.roads.map((r) => ({ road: r, carrier: eco.roads[r]?.carrier, a: eco.roads[r]?.a, b: eco.roads[r]?.b })),
      });
    }
  }
}
// Whatever is still lying there at the end.
for (const [id, c] of cands) done.push({ good: id, type: tag(c.type), first: c.first, last: c.last, ticks: c.last - c.first, dest: describe(c.dest), flag: c.flag, viaRedirect: c.viaRedirect, prev: c.prev, endedAs: "still there at the end" });
for (const [id, s] of sites) {
  const b = eco.buildings[id];
  if (b && b.built && s.finished < 0) s.finished = w.tick;
  if ((!b || !b.alive) && s.gone < 0) s.gone = w.tick;
}
console.log(
  JSON.stringify({
    size, seed, none, dayTicks: eco.dayTicks, supplyCalls, redirectsOntoOwnFlag: redirects, long: done.filter((x) => (x.ticks as number) >= STRANDED_TICKS), shortCount: done.filter((x) => (x.ticks as number) < STRANDED_TICKS).length,
    sites: [...sites].map(([id, s]) => ({ site: id, building: s.building, owner: s.owner, firstStrandedTick: s.first, goods: [...s.goods], finishedTick: s.finished, goneTick: s.gone })),
    daily, trace: log,
  }),
);
