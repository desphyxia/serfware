import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { DEFAULT_TRANSPORT, helperCap, type Economy } from "../src/sim/econ/economy";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** Private parts of the economy the tests reach into. */
const inside = (eco: Economy) => eco as unknown as { spawnGood(type: number, flag: number): { dest: number }; supply(): void };

describe("transport (Serf City's rules)", () => {
  it("a road may have more carriers the longer it is", () => {
    expect([1, 3, 4, 6, 7, 10, 13, 18, 24].map(helperCap)).toEqual([1, 1, 2, 3, 4, 6, 8, 11, 15]);
  });

  it("a busy road calls extra carriers, who go home when it is quiet", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    expect(placeConnected(w, "woodcutter", { minDist: 6, maxDist: 9 })).toBe(true);
    for (let i = 0; i < 200; i++) w.step();
    const keep = eco.buildings[eco.keeps[0]!]!;
    // A long road off the keep's flag, and a pile of goods at its far end bound for the keep.
    const road = eco.roads.filter((r) => r.alive && (r.a === keep.flag || r.b === keep.flag)).sort((a, b) => b.tiles.length - a.tiles.length)[0]!;
    expect(helperCap(road.tiles.length - 1)).toBeGreaterThan(1);
    const far = road.a === keep.flag ? road.b : road.a;
    for (let i = 0; i < 6; i++) inside(eco).spawnGood(goodId("log"), far).dest = keep.id;
    keep.pending[goodId("log")]! += 6;
    let most = 0;
    for (let i = 0; i < 600; i++) {
      w.step();
      most = Math.max(most, road.helpers.length);
    }
    expect(most).toBeGreaterThan(0);
    // Once the pile is gone the extra carriers leave (after three idle hours).
    for (let i = 0; i < eco.dayTicks / 2; i++) w.step();
    expect(road.helpers.length).toBe(0);
  }, 60000);

  it("supplies go round the buildings that want them, halving each one's claim per good it holds", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    expect(placeConnected(w, "woodcutter", { minDist: 3 })).toBe(true);
    expect(placeConnected(w, "quarry", { minDist: 3 })).toBe(true);
    const sites = eco.buildings.filter((b) => b.alive && !b.built);
    expect(sites.length).toBe(2);
    const plank = goodId("plank");
    const [a, b] = sites as [(typeof sites)[0], (typeof sites)[0]];
    // Equal weights: each extra plank on its way halves a site's claim.
    const c0 = eco.claim(a, plank);
    a.pending[plank]! += 1;
    expect(eco.claim(a, plank)).toBeCloseTo(c0 / 2);
    a.pending[plank]! -= 1;
    // One supply round sends planks to both sites, not all to one.
    inside(eco).supply();
    expect(a.pending[plank]).toBeGreaterThan(0);
    expect(b.pending[plank]).toBeGreaterThan(0);
    expect(Math.abs(a.pending[plank]! - b.pending[plank]!)).toBeLessThanOrEqual(1);
  });

  it("materials go first to sites whose builder has arrived", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    expect(placeConnected(w, "woodcutter", { minDist: 3 })).toBe(true);
    const site = eco.buildings.find((b) => b.alive && !b.built)!;
    const plank = goodId("plank");
    const before = eco.claim(site, plank);
    for (let i = 0; i < 3000 && !(site.builder >= 0 && eco.settlers[site.builder]!.state !== "goto"); i++) w.step();
    site.pending[plank] = 0;
    site.delivered[plank] = 0;
    expect(eco.claim(site, plank)).toBeCloseTo(before * 4);
  }, 60000);

  it("players set which goods carriers take first", () => {
    const w = new World(SEED, { size: "tiny" });
    const eco = w.economy;
    expect(eco.prefs[0]!.transport).toEqual(DEFAULT_TRANSPORT);
    expect(eco.transportRank(0, goodId("plank"))).toBe(0);
    expect(w.command({ t: "transport", good: "goldore", to: 0 }).ok).toBe(true);
    expect(eco.transportRank(0, goodId("goldore"))).toBe(0);
    expect(eco.transportRank(0, goodId("plank"))).toBe(1);
    expect(w.command({ t: "transport", good: "nonsense", to: 0 }).ok).toBe(false);
  });

  it("two full flags never block each other: carriers swap goods (the old deadlock seed)", () => {
    // On this seed the keep's flag and its neighbour used to fill with goods for each other.
    const w = new World(SEED, { size: "small", peaceDays: 13 });
    w.command({ t: "steward", of: 0, on: true });
    const eco = w.economy;
    const end = w.tick + 12 * eco.dayTicks;
    let stuck = 0;
    while (w.tick < end) {
      w.step();
      if (w.tick % 300) continue;
      for (const r of eco.roads) {
        if (!r.alive) continue;
        const a = eco.flags[r.a]!;
        const b = eco.flags[r.b]!;
        // A deadlock: both full, each holding goods for the other, and nobody moving them.
        const forOther = (from: number, to: number) => eco.flags[from]!.goods.some((g) => (eco as unknown as { nextHop(g: unknown): number }).nextHop(eco.goods[g]) === to);
        if (a.goods.length >= 8 && b.goods.length >= 8 && forOther(r.a, r.b) && forOther(r.b, r.a) && (eco.settlers[r.carrier]?.state ?? "idle") === "idle") stuck++;
      }
    }
    expect(stuck).toBe(0);
  }, 300000);
});
