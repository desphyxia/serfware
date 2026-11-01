import { afterEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/builder";
import { Feature } from "../src/sim/econ/landuse";
import { fellable } from "../src/sim/econ/landuse";
import { feedingForesters, placeConnected, spurFlags, woodcutterSpent } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

afterEach(() => {
  aiOptions.dropIdleWoodcutters = false;
  aiOptions.woodcutterTrees = false;
});

const SEED = "quiet-cairn-171";
const P = 1;

/** A world grown by its AI seats for a while, on the road lattice as the game plays it. */
const grown = (ticks: number): World => {
  const w = new World(SEED, { rivals: 1, latticeRoads: true });
  for (let i = 0; i < ticks; i++) w.step();
  return w;
};

const joinedToKeep = (w: World, p: number): Set<number> => {
  const eco = w.economy;
  const kf = eco.buildings[eco.keeps[p] as number]!.flag;
  return new Set(eco.buildings.filter((b) => b.alive && b.owner === p && eco.route(b.flag, kf).dist < Infinity).map((b) => b.id));
};

/** Clear every tree the woodcutter could fell, and take down the foresters that plant within its reach. */
const strip = (w: World, b: { tile: number; def: { radius?: number } }): void => {
  const land = w.land;
  const reach = land.ring(b.tile, b.def.radius ?? 5);
  for (const t of reach) if (land.feature[t] === Feature.Tree || land.feature[t] === Feature.Giant) land.feature[t] = Feature.None;
  land.featureVersion++;
  const inReach = new Set(reach);
  for (const f of w.economy.buildings) {
    if (f.alive && f.owner === P && f.def.id === "forester" && land.ring(f.tile, f.def.radius ?? 5).some((t) => inReach.has(t))) w.command({ t: "demolish", tile: f.tile, player: P });
  }
};

describe("pulling down idle woodcutters (dropIdleWoodcutters)", () => {
  it("is off by default", () => {
    expect(aiOptions.dropIdleWoodcutters).toBe(false);
  });

  it("spurFlags takes a building and the road that served it alone, and leaves every other building joined", () => {
    const w = grown(6000);
    const eco = w.economy;
    const before = joinedToKeep(w, P);
    const cases = eco.buildings
      .filter((b) => b.alive && b.owner === P && b.built && b.id !== eco.keeps[P] && !b.def.slots)
      .map((b) => ({ b, spur: spurFlags(w, b.flag) }))
      .filter((x) => x.spur.length > 0)
      .sort((x, y) => y.spur.length - x.spur.length);
    expect(cases.length).toBeGreaterThan(0);
    const { b, spur } = cases[0]!;
    expect(spur[0]).toBe(b.flag);
    for (const f of spur.slice(1)) expect(eco.flags[f]!.building).toBe(-1);
    for (const f of spur) expect(w.command({ t: "demolish", tile: eco.flags[f]!.tile, player: P }).ok).toBe(true);
    expect(b.alive).toBe(false);
    for (const f of spur) expect(eco.flags[f]!.alive).toBe(false);
    const after = joinedToKeep(w, P);
    for (const id of before) if (id !== b.id) expect(after.has(id), `building ${id} still joined`).toBe(true);
  }, 120000);

  it("a flag that two roads meet at is no spur", () => {
    const w = grown(6000);
    const eco = w.economy;
    const through = eco.buildings.find((b) => b.alive && b.owner === P && (eco.flags[b.flag]?.roads.filter((r) => eco.roads[r]?.alive).length ?? 0) >= 2);
    expect(through).toBeDefined();
    expect(spurFlags(w, through!.flag)).toEqual([]);
  }, 120000);

  it("woodcutterSpent: idle all day, no tree and no forester in reach; a sapling or a forester keeps it", () => {
    const w = grown(12000);
    const eco = w.economy;
    const b = eco.buildings.find((x) => x.alive && x.owner === P && x.built && x.def.id === "woodcutter");
    expect(b).toBeDefined();
    const cutter = b!;
    strip(w, cutter);
    cutter.busyPrev = 0;
    expect(woodcutterSpent(w, cutter)).toBe(true);
    cutter.busyPrev = 1;
    expect(woodcutterSpent(w, cutter), "worked yesterday").toBe(false);
    cutter.busyPrev = 0;
    const t = w.land.ring(cutter.tile, cutter.def.radius ?? 5).find((x) => w.land.isLand(x) && w.land.feature[x] === Feature.None)!;
    w.land.feature[t] = Feature.Tree;
    w.land.amount[t] = 1;
    w.land.variety[t] = 0;
    expect(woodcutterSpent(w, cutter), "a sapling in reach").toBe(false);
    w.land.feature[t] = Feature.None;
    expect(woodcutterSpent(w, cutter)).toBe(true);
  }, 120000);

  it("with the switch on, the AI pulls a spent woodcutter down with its dead-end road", () => {
    aiOptions.dropIdleWoodcutters = true;
    const w = grown(12000);
    const eco = w.economy;
    const cutters = eco.buildings.filter((x) => x.alive && x.owner === P && x.built && x.def.id === "woodcutter" && spurFlags(w, x.flag).length > 0);
    expect(cutters.length).toBeGreaterThan(0);
    // Idle all of the last day, as the day's tally would say: the test does not wait for a day to turn, in which the AI may join
    // another road to the flag (which makes it no spur). Each spur is taken as it was just before the step.
    const spur = new Map<number, number[]>();
    for (let i = 0; i < 3000 && cutters.some((c) => c.alive); i++) {
      for (const c of cutters) {
        if (!c.alive) continue;
        if (i % 500 === 0) strip(w, c);
        c.busyPrev = 0;
        spur.set(c.id, spurFlags(w, c.flag));
      }
      w.step();
    }
    const gone = cutters.filter((c) => !c.alive);
    expect(gone.length).toBeGreaterThan(0);
    for (const c of gone) {
      for (const f of spur.get(c.id) ?? []) expect(eco.flags[f]!.alive, `flag ${f}`).toBe(false);
      const flag = eco.flags[c.flag]!;
      if (flag.alive) expect(flag.roads.filter((r) => eco.roads[r]?.alive).length, "a flag left standing joins others").toBeGreaterThanOrEqual(2);
    }
    // At least one went with a road that served it alone.
    expect(gone.some((c) => (spur.get(c.id)?.length ?? 0) >= 1)).toBe(true);
  }, 240000);
});

describe("woodcutters only where trees stand (woodcutterTrees)", () => {
  it("is off by default", () => {
    expect(aiOptions.woodcutterTrees).toBe(false);
  });

  it("placeConnected with need and ripe puts a woodcutter only where that many fellable trees stand in its reach", () => {
    const w = grown(6000);
    const eco = w.economy;
    const land = w.land;
    const ripeIn = (t: number) => land.ring(t, 6).filter((x) => fellable(land, x)).length;
    const before = eco.buildings.length;
    expect(placeConnected(w, "woodcutter", { minDist: 2, maxDist: 9, near: Feature.Tree, need: 6, ripe: true, player: P, splitRoads: true })).toBe(true);
    const placed = eco.buildings.slice(before).find((b) => b.alive && b.def.id === "woodcutter");
    expect(placed).toBeDefined();
    expect(ripeIn(placed!.tile)).toBeGreaterThanOrEqual(6);
    // A need no spot meets places nothing.
    expect(placeConnected(w, "woodcutter", { minDist: 2, maxDist: 9, near: Feature.Tree, need: 500, ripe: true, player: P, splitRoads: true })).toBe(false);
  }, 120000);
});

describe("a forester keeps a woodcutter only when it can plant in its reach (dropIdleWoodcutters)", () => {
  it("counts a forester with plantable ground in the woodcutter's reach, and not once that ground cannot take a sapling", () => {
    const w = grown(12000);
    const eco = w.economy;
    const land = w.land;
    const cutter = eco.buildings.find((b) => b.alive && b.owner === P && b.built && b.def.id === "woodcutter" && feedingForesters(w, b) > 0);
    expect(cutter, "a woodcutter a forester feeds").toBeDefined();
    const b = cutter!;
    for (const t of land.ring(b.tile, b.def.radius ?? 5)) if (land.feature[t] === Feature.Tree || land.feature[t] === Feature.Giant) land.feature[t] = Feature.None;
    b.busyPrev = 0;
    expect(woodcutterSpent(w, b), "fed by a forester").toBe(false);
    // Dead soil in the woodcutter's reach: no forester can plant there, so none keeps it.
    for (const t of land.ring(b.tile, b.def.radius ?? 5)) land.life[t] = 0;
    expect(feedingForesters(w, b)).toBe(0);
    expect(woodcutterSpent(w, b)).toBe(true);
  }, 120000);
});
