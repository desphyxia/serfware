import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { Deposit } from "../../src/sim/econ/landuse";
import { landmassOf } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * Does a seat's border grow toward ground a mine could use: `node borderrock.mjs <size> <seed> <rivals> <days>` plays the
 * AI with the switches in BALANCE_EXTRA (as `mining.ts`) and, at some days, prints one JSON line per seat with the granite
 * (tiles, loads) and mountain tiles inside the border, free on the Hearthship's land within 5, 10 and 20 land steps of the
 * border, and the number of own tiles the lantern frontier offers. Read-only.
 */
const [size, seed, rivals, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
aiOptions.forgeRoom = extra.includes("forge");
aiOptions.graniteFirst = extra.includes("granite");
const n = Number(rivals);
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden"].concat(["builder", "trader", "warden"]).slice(0, n),
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const grid = land.planet.grid;
const CHECK = [5, 10, 20, 40, 60];
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop && eco.winner < 0) w.step();
  if (!CHECK.includes(d)) continue;
  for (let p = 1; p <= n; p++) {
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    if (!keep) continue;
    const home = landmassOf(w, keep.tile);
    const mine = (t: number) => land.territory[t] === p + 1 && land.isLand(t);
    const stats = (pick: (t: number) => boolean) => {
      let tiles = 0;
      let loads = 0;
      for (let t = 0; t < land.territory.length; t++) {
        if (!pick(t)) continue;
        tiles++;
        loads += land.deposit[t] === Deposit.Granite ? (land.depositAmount[t] as number) : 0;
      }
      return [tiles, loads];
    };
    const granite = (t: number) => land.deposit[t] === Deposit.Granite;
    const inside = stats((t) => mine(t) && granite(t));
    const mountainInside = stats((t) => mine(t) && land.isMountain(t))[0];
    // Land steps from the border over land of the Hearthship: the free granite and free mountain tiles within 5, 10 and 20.
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (let t = 0; t < land.territory.length; t++) if (mine(t)) { dist.set(t, 0); queue.push(t); }
    const free = { g: [0, 0, 0], gl: [0, 0, 0], m: [0, 0, 0], all: [0, 0, 0] };
    let nearestGranite = -1;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i] as number;
      const dd = dist.get(t) as number;
      if (dd > 20) break;
      if (land.territory[t] === 0 && home.has(t)) {
        if (granite(t) && nearestGranite < 0) nearestGranite = dd;
        [5, 10, 20].forEach((r, k) => {
          if (dd > r) return;
          if (granite(t)) { free.g[k]!++; free.gl[k]! += land.depositAmount[t] as number; }
          if (land.isMountain(t)) free.m[k]!++;
          free.all[k]!++;
        });
      }
      for (const x of grid.neighborsOf(t)) if (!dist.has(x) && land.isLand(x)) { dist.set(x, dd + 1); queue.push(x); }
    }
    let own = 0;
    for (let t = 0; t < land.territory.length; t++) if (mine(t)) own++;
    console.log(
      JSON.stringify({ seed, size, day: d, seat: p, territory: own, graniteInside: inside, mountainInside, freeGranite: free.g, freeGraniteLoads: free.gl, freeMountain: free.m, freeLand: free.all, nearestFreeGranite: nearestGranite }),
    );
  }
}
