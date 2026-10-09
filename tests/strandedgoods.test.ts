import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import type { Building, Economy, Good, Settler } from "../src/sim/econ/economy";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** Private parts of the economy the tests reach into. */
const inside = (eco: Economy) =>
  eco as unknown as { spawnGood(type: number, flag: number): Good; assignDestination(g: Good): void; supply(): void; dropCarriedGoodAt(s: Settler, flag: number): void };

/** Goods lying on a flag, with nobody carrying them, for the building whose own flag that is, for at least `ticks`. */
const stranded = (eco: Economy, ticks: number): Good[] =>
  eco.goods.filter((g) => {
    if (!g.alive || g.carrier >= 0 || g.flag < 0 || g.dest < 0) return false;
    const d = eco.buildings[g.dest];
    return !!d && d.alive && d.flag === g.flag && eco.tick - g.since >= ticks;
  });

/** Buildings whose `pending` count differs from the number of live goods bound for them (a good lost, or counted twice). */
const pendingOff = (eco: Economy): string[] => {
  const bound = new Map<string, number>();
  for (const g of eco.goods) if (g.alive && g.dest >= 0) bound.set(`${g.dest}:${g.type}`, (bound.get(`${g.dest}:${g.type}`) ?? 0) + 1);
  const off: string[] = [];
  for (const b of eco.buildings) {
    if (!b.alive) continue;
    b.pending.forEach((n, type) => {
      const want = bound.get(`${b.id}:${type}`) ?? 0;
      if (n !== want) off.push(`${b.def.id}#${b.id} good ${type}: pending ${n}, bound ${want}`);
    });
  }
  return off;
};

const siteOf = (w: World, type: string, opts: { minDist: number; maxDist?: number }): Building => {
  expect(placeConnected(w, type, opts)).toBe(true);
  return w.economy.buildings.filter((b) => b.alive && !b.built && b.def.id === type).at(-1)!;
};

describe("goods stranded on their destination's own flag (#136)", () => {
  it("a store-bound good lying on a site's flag is not re-aimed at the site and left there", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const site = siteOf(w, "house", { minDist: 3 });
    const keep = eco.buildings[eco.keeps[0]!]!;
    const stone = goodId("stone");
    keep.stock[stone] = 20;
    keep.stock[goodId("plank")] = 20;
    // A stone on its way into the keep that happens to lie on the site's flag; the house wants one stone.
    const g = inside(eco).spawnGood(stone, site.flag);
    g.dest = keep.id;
    keep.pending[stone]!++;
    for (let i = 0; i < 3000; i++) w.step();
    expect(site.delivered[stone]).toBe(site.cost[stone]);
    expect(stranded(eco, 1500)).toEqual([]);
    expect(pendingOff(eco)).toEqual([]);
  }, 120000);

  it("a building is not given the good it made itself for its own upkeep and left with it on its own flag", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const site = siteOf(w, "woodcutter", { minDist: 3 });
    // Finished and weathered: it asks for one plank of upkeep, and a plank is lying on its flag.
    site.built = true;
    site.wear = 0.6;
    const plank = goodId("plank");
    const g = inside(eco).spawnGood(plank, site.flag);
    inside(eco).assignDestination(g);
    for (let i = 0; i < 3000; i++) w.step();
    expect(stranded(eco, 1500)).toEqual([]);
    expect(pendingOff(eco)).toEqual([]);
  }, 120000);

  it("a road split does not put a carried good down on its destination's flag and leave it", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const site = siteOf(w, "house", { minDist: 6, maxDist: 9 });
    const plank = goodId("plank");
    const keep = eco.buildings[eco.keeps[0]!]!;
    keep.stock[plank] = 20;
    keep.stock[goodId("stone")] = 20;
    // The longest road into the site's flag, and a plank sent over it from the other end.
    const road = eco.roads.filter((r) => r.alive && (r.a === site.flag || r.b === site.flag)).sort((a, b) => b.tiles.length - a.tiles.length)[0]!;
    expect(road.tiles.length).toBeGreaterThanOrEqual(7);
    const far = road.a === site.flag ? road.b : road.a;
    const g = inside(eco).spawnGood(plank, far);
    g.dest = site.id;
    site.pending[plank]!++;
    // Put a flag on the road at the moment the carrier is walking the plank into the building: it has reached the site's flag and
    // the road is replaced under it, so it puts the plank down on that flag.
    const at = Math.floor(road.tiles.length / 2);
    let split = false;
    for (let i = 0; i < 2000 && !split; i++) {
      w.step();
      const s = g.carrier >= 0 ? eco.settlers[g.carrier] : undefined;
      if (!s || s.state !== "enter" || s.carryGood !== g.id) continue;
      expect(w.command({ t: "flag", tile: road.tiles[at]!, player: 0 }).ok).toBe(true);
      split = true;
    }
    expect(split).toBe(true);
    for (let i = 0; i < 3000; i++) w.step();
    expect(site.delivered[plank]).toBe(site.cost[plank]);
    expect(stranded(eco, 1500)).toEqual([]);
    expect(pendingOff(eco)).toEqual([]);
  }, 120000);
});
