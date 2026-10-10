import { AiBuilder, aiOptions, aiStats } from "../../src/sim/ai/builder";
import { AI_LEVELS } from "../../src/sim/ai/personality";
import { FLAG_CAPACITY } from "../../src/sim/econ/economy";
import { BUILDINGS, buildingType, GOODS, type BuildingDef } from "../../src/sim/econ/defs";
import { Use } from "../../src/sim/econ/landuse";
import { World } from "../../src/sim/world";

/**
 * Why building sites wait: `node sites.mjs <size> <seed> <rivals> <days>` plays the AI (BALANCE_EXTRA="tools,ore,release,smith,forge"
 * adds the experimental switches on top of pilot 6's) and, four times a day, looks at every unfinished site of every AI seat
 * that has no material on site and no dig left (what `probe.ts` calls wait_none / wait_transit). Prints one JSON line:
 * counts by `<block of 10 days>|<state>:<good>|<why>`, where why is, for a site nothing was sent to: the good is not in any
 * of the seat's warehouses ("no stock"), or it is and no warehouse with it has a route to the site ("no route"), every such
 * warehouse's flag is full ("flag full"), the supply claim is zero ("claim 0"), or none of those ("sendable"); and for a
 * site the good is on its way to: how long the oldest such good has waited since it was put on a flag. Also the seat's
 * unfinished sites against the AI's cap. Read-only.
 */
const [size, seed, rivals, days] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const extra = (process.env.BALANCE_EXTRA ?? "").split(",");
aiOptions.toolsByDemand = extra.includes("tools");
aiOptions.oreMines = extra.includes("ore");
aiOptions.releaseStalled = extra.includes("release");
aiOptions.toolsmithAnyway = extra.includes("smith");
aiOptions.forgeRoom = extra.includes("forge");
const n = Number(rivals);
const level = (process.env.BALANCE_LEVEL ?? "normal") as "easy" | "normal" | "hard";
const w = new World(seed, {
  size,
  rivals: n,
  personalities: ["builder", "trader", "warden", "builder", "trader", "warden"].slice(0, n),
  aiLevel: level,
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const cap = Math.round(AI_LEVELS[level].sites);
const counts: Record<string, number> = {};
const bump = (k: string, by = 1): void => {
  counts[k] = (counts[k] ?? 0) + by;
};
const land = w.land;
const houseDef = BUILDINGS[buildingType("house")] as BuildingDef;
const centre = w.planet.grid.center;
/** What placeOn would make of tile t for a house of player p: "ok", or the first thing that stops it. */
function houseSpot(t: number, p: number): string {
  const flagTile = land.bestFlagTile(t, p);
  if (flagTile < 0) return "no flag spot";
  if (!land.canBuildDef(t, flagTile, houseDef, p)) return "cannot build";
  const existing = eco.flagAt(flagTile);
  if (existing && existing.building >= 0) return "flag spot taken by a building";
  const own = eco.flags.filter((f) => f.alive && f.owner === p && f.tile !== flagTile);
  const d2 = (ft: number) => (centre[ft * 3]! - centre[flagTile * 3]!) ** 2 + (centre[ft * 3 + 1]! - centre[flagTile * 3 + 1]!) ** 2 + (centre[ft * 3 + 2]! - centre[flagTile * 3 + 2]!) ** 2;
  const near = own.map((f) => [d2(f.tile), f.tile] as const).sort((a, b) => a[0] - b[0]).slice(0, 6);
  for (const [, ft] of near) {
    const path = land.findPath(ft, flagTile, (x) => land.roadable(x, p) && x !== t, 1500);
    if (path && path.length >= 3 && !eco.checkRoad(path, p)) return "ok";
  }
  return existing ? "ok" : "no road";
}
const claimOf = eco as unknown as { claim: (b: unknown, type: number) => number };
// Goods that `supply` (econ/economy.ts) re-aims from a store to a building while they lie on a flag: how many, and how many lie on that
// building's own flag when it does (a carrier only enters a building with a good it brings to the flag, so such a good has no next hop).
{
  const holder = eco as unknown as { supply: () => void };
  const original = holder.supply.bind(eco);
  holder.supply = () => {
    const before = new Map<number, number>();
    for (const g of eco.goods) if (g.alive && g.carrier < 0 && g.flag >= 0 && g.dest >= 0 && eco.buildings[g.dest]?.def.storage) before.set(g.id, g.dest);
    original();
    for (const [id, was] of before) {
      const g = eco.goods[id];
      if (!g || !g.alive || g.dest === was || g.dest < 0) continue;
      const to = eco.buildings[g.dest];
      if (!to) continue;
      const good = (GOODS[g.type] as { id: string }).id;
      bump(`redirected:${good}|${to.built ? "to a finished building" : "to a site"}`);
      if (to.flag === g.flag) bump(`redirected-onto-own-flag:${good}|${to.built ? "to a finished building" : "to a site"}`);
    }
  };
}
const SLOTS = 4;
const quarter = Math.max(1, Math.floor(eco.dayTicks / SLOTS));
let capped = 0;
let seatSamples = 0;
for (let d = 1; d <= Number(days) && eco.winner < 0; d++) {
  for (let slot = 0; slot < SLOTS && eco.winner < 0; slot++) {
    const stop = w.tick + quarter;
    while (w.tick < stop && eco.winner < 0) w.step();
    const block = Math.floor((d - 1) / 10);
    for (let p = 1; p <= n; p++) {
      if (eco.defeated[p]) continue;
      const mine = eco.buildings.filter((b) => b.alive && b.owner === p);
      const sites = mine.filter((b) => !b.built);
      seatSamples++;
      bump(`${block}|seat-samples`);
      if (sites.length >= cap) {
        capped++;
        bump(`${block}|seat-at-cap`);
      }
      const stock = eco.storageTotals(p);
      const stores = mine.filter((b) => b.built && b.def.storage);
      // The AI's house wants (ai/builder.ts): why a seat does or does not place a house, read from outside.
      const people = eco.peopleOf(p).length;
      const houses = mine.filter((b) => b.def.id === "house" && !b.exhausted);
      const housed = eco.capacity(p) >= people + 6;
      const quota = Math.floor(people / 7);
      const openHouses = houses.filter((b) => !b.built).length;
      const idleHands = eco.population(p).idle;
      const houseWant = !housed && houses.length < quota;
      bump(`${block}|house:${housed ? "housed (room for everyone and 6 spare)" : houses.length >= quota ? "not housed, quota met (houses >= people/7)" : openHouses > 0 ? "not housed, want on, a house site is open" : (stock[GOODS.findIndex((g) => g.id === "plank")] as number) < 5 ? "not housed, want on, planks under 5" : "not housed, want on, no house site open"}`);
      if (houseWant) bump(`${block}|house-want-idle:${idleHands < 2 ? "idle<2" : "idle>=2"}`);
      // Once a day, for a seat that wants a house with none open: is there a tile where placeOn (econ/planner.ts) could put one,
      // within 9 steps of the keep or of a lit lantern (what `near("house")` searches)? Stops at the first that works.
      if (slot === 0 && houseWant && openHouses === 0) {
        const keepTile = eco.buildings[eco.keeps[p] ?? -1]?.tile ?? 0;
        const centres = [keepTile, ...mine.filter((b) => b.built && b.lit && b.def.slots).map((b) => b.tile)];
        const seen = new Set<number>(land.ring(keepTile, 1));
        const verdict = new Map<string, number>();
        let found = false;
        let examined = 0;
        outer: for (const c0 of centres) {
          for (const t of land.ring(c0, 9)) {
            if (seen.has(t)) continue;
            seen.add(t);
            if (land.territory[t] !== p + 1 || land.use[t] !== Use.Free) continue;
            const r = houseSpot(t, p);
            verdict.set(r, (verdict.get(r) ?? 0) + 1);
            if (r === "ok") {
              found = true;
              break outer;
            }
            if (++examined >= 400) {
              bump(`${block}|house-room-stopped-at-400`);
              break outer;
            }
          }
        }
        bump(`${block}|house-room:${found ? "a house could be placed" : "no tile found"}`);
        if (!found) for (const [r, k] of verdict) bump(`${block}|house-room-no:${r}`, k);
      }
      for (const b of sites) {
        if (b.dig > 0) continue;
        const onSite = b.delivered.reduce((a, v) => a + v, 0) - b.consumed;
        if (onSite > 0) continue;
        let want = -1;
        let most = 0;
        for (let g = 0; g < GOODS.length; g++) {
          const left = (b.cost[g] as number) - (b.delivered[g] as number);
          if (left > most) {
            most = left;
            want = g;
          }
        }
        if (want < 0) continue;
        const good = (GOODS[want] as { id: string }).id;
        if ((b.pending[want] as number) > 0) {
          let oldest = 0;
          let oldGood: (typeof eco.goods)[number] | undefined;
          for (const g of eco.goods) {
            if (!g.alive || g.dest !== b.id || g.type !== want) continue;
            if (w.tick - g.since >= oldest) {
              oldest = w.tick - g.since;
              oldGood = g;
            }
          }
          const age = oldest < eco.dayTicks / 4 ? "under 6h" : oldest < eco.dayTicks ? "6h to 1d" : "over 1d";
          bump(`${block}|transit:${good}|${age}`);
          // Where the oldest one is, for those that have waited over a day: on its way with a carrier who promised it, or lying on a flag, and then why.
          if (oldGood && age === "over 1d") {
            let where: string;
            if (oldGood.carrier >= 0) where = "a carrier has promised it";
            else if (oldGood.flag < 0) where = "not on a flag";
            else {
              const fl = eco.flags[oldGood.flag];
              const roads = (fl?.roads ?? []).map((id) => eco.roads[id]).filter((r) => r?.alive);
              const noCarrier = roads.some((r) => (r?.carrier ?? 0) < 0);
              const d = eco.route(oldGood.flag, b.flag).dist;
              // The road it must take next, and what is wrong there: the next flag is full, or the road's carrier is doing something else.
              const hop = (eco as unknown as { nextHop: (g: unknown) => number }).nextHop(oldGood);
              const nextFlag = hop >= 0 ? eco.flags[hop] : undefined;
              const road = roads.find((r) => r && (r.a === hop || r.b === hop));
              const carrier = road && road.carrier >= 0 ? eco.settlers[road.carrier] : undefined;
              if (d === Infinity) where = "on a flag with no route to the site";
              else if (hop === -2) {
                where = "lies on the site's own flag (nobody carries it in)";
                bump(`${block}|stuck-days:${good}|${Math.min(6, Math.floor(oldest / eco.dayTicks))}`);
              }
              else if (hop < 0) where = "on a flag; the good has no next hop";
              else if (!nextFlag || !road) where = "on a flag; no road to the next hop found";
              else if (fl && fl.goods.length >= FLAG_CAPACITY) where = "on a full flag";
              else if (nextFlag.goods.length + nextFlag.reserved >= FLAG_CAPACITY) where = "next flag full";
              else if (!carrier) where = noCarrier ? "road to the next flag has no carrier" : "no carrier";
              else where = `carrier ${carrier.state}, helpers ${road.helpers.length}`;
            }
            bump(`${block}|transit-old:${good}|${where}`);
          }
          continue;
        }
        let why = "no stock";
        if ((stock[want] as number) > 0) {
          const holders = stores.filter((s) => (s.stock[want] as number) > 0);
          const reach = holders.filter((s) => eco.route(s.flag, b.flag).dist < Infinity);
          const open = reach.filter((s) => {
            const f = eco.flags[s.flag];
            return !!f && f.goods.length + f.reserved < FLAG_CAPACITY;
          });
          why = !holders.length ? "stock not in a built store" : !reach.length ? "no route" : !open.length ? "flag full" : claimOf.claim(b, want) <= 0 ? "claim 0" : "sendable";
        }
        bump(`${block}|none:${good}|${why}`);
        bump(`${block}|none-by-type:${good}|${b.def.id}`);
      }
    }
  }
}
console.log(JSON.stringify({ size, seed, level, cap, seatSamples, capped, counts, thoughts: Object.fromEntries(Object.entries(aiStats).map(([p, v]) => [p, [v[0], v[1]]])) }));
