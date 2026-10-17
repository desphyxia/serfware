import { afterEach, describe, expect, it } from "vitest";
import { AiBuilder } from "../src/sim/ai/builder";
import { AiContext } from "../src/sim/ai/brain";
import { aiOptions } from "../src/sim/ai/options";
import { VoyagePlanner } from "../src/sim/ai/voyage";
import { goodId, goodsFor } from "../src/sim/econ/defs";
import { placeOn } from "../src/sim/econ/planner";
import { Rng } from "../src/sim/rng";
import { World } from "../src/sim/world";

const found = { ...VoyagePlanner.found };
afterEach(() => {
  aiOptions.foodByNeed = false;
  aiOptions.foodWithoutIdle = true;
  aiOptions.railWithSites = false;
  aiOptions.orderEarly = false;
  VoyagePlanner.found = { ...found };
});

/** A small world with one rival (seat 1) whose brain is not stepped: the tests drive the AI by hand. */
function seat() {
  const w = new World("voyage-food", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[1]!]!;
  return { w, eco, keep, ctx: new AiContext(w, 1) };
}

/** Houses placed round the keep and all marked finished, up to `n` buildings in all. */
function grown(w: World, n: number) {
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[1]!]!;
  const ring = w.land.ring(keep.tile, 12);
  for (let i = 0; i < 80 && eco.buildings.filter((b) => b.alive && b.owner === 1).length < n; i++) placeOn(w, "house", ring, 1, true);
  for (const b of eco.buildings) if (b.alive && b.owner === 1) b.built = true;
}

const owned = (w: World, id: string) => w.economy.buildings.filter((b) => b.alive && b.owner === 1 && b.def.id === id);

describe("the launch rail while other buildings are unfinished (railWithSites)", () => {
  function ready() {
    const s = seat();
    grown(s.w, 34);
    // One building still under construction, and the goods for a rail in the stores.
    const open = s.eco.buildings.find((b) => b.alive && b.owner === 1 && b.def.id === "house")!;
    open.built = false;
    for (const g of ["iron", "plank", "stone"]) (s.keep.stock as number[])[goodId(g)] = 40;
    expect(s.eco.buildings.filter((b) => b.alive && b.owner === 1 && b.built).length).toBeGreaterThanOrEqual(30);
    return s;
  }

  it("keeps the rail and early-order switches off by default, and the food one on", () => {
    expect(aiOptions.railWithSites).toBe(false);
    expect(aiOptions.orderEarly).toBe(false);
    expect(aiOptions.foodWithoutIdle).toBe(true);
    expect(aiOptions.foodByNeed).toBe(false);
  });

  it("waits for every building to be finished with the switch off", () => {
    const { w, ctx } = ready();
    const planner = new VoyagePlanner(1);
    expect(planner.step(ctx, 1)).toBe(false);
    expect(owned(w, "launchrail")).toHaveLength(0);
  });

  it("orders the rail while a building is unfinished with the switch on", () => {
    aiOptions.railWithSites = true;
    const { w, ctx } = ready();
    const planner = new VoyagePlanner(1);
    expect(planner.step(ctx, 1)).toBe(true);
    expect(owned(w, "launchrail")).toHaveLength(1);
  });

  it("still orders one rail at a time with the switch on", () => {
    aiOptions.railWithSites = true;
    const { w, ctx } = ready();
    const planner = new VoyagePlanner(1);
    planner.step(ctx, 1);
    expect(planner.step(ctx, 100)).toBe(false);
    expect(owned(w, "launchrail")).toHaveLength(1);
  });
});

describe("the food wishes when no adult is idle (foodWithoutIdle)", () => {
  /** Every adult dead, so nobody is idle; the food stores empty so the seat is short of food. */
  function hungry() {
    const s = seat();
    grown(s.w, 16);
    for (const b of s.eco.buildings) if (b.alive && b.owner === 1 && b.def.storage) for (const g of goodsFor("food")) (b.stock as number[])[g] = 0;
    for (const g of ["plank", "stone", "log"]) (s.keep.stock as number[])[goodId(g)] = 60;
    for (const p of s.eco.people) if (p.owner === 1 && p.stage === "adult") p.alive = false;
    expect(s.eco.population(1).idle).toBe(0);
    return s;
  }
  const FOOD = ["fisher", "hunter", "orchard", "farm"];
  const foodSites = (w: World) => FOOD.reduce((n, id) => n + owned(w, id).length, 0);

  function think(w: World, ctx: AiContext, times: number) {
    const brain = new AiBuilder(1, new Rng("food-think"), "builder", "normal");
    for (let i = 0; i < times; i++) brain.think(ctx);
  }

  it("builds no food while nobody is idle with the switch off", () => {
    aiOptions.foodByNeed = true;
    aiOptions.foodWithoutIdle = false;
    const { w, ctx } = hungry();
    const before = foodSites(w);
    think(w, ctx, 300);
    expect(foodSites(w)).toBe(before);
  });

  it("adds a food building while nobody is idle with the switch on", () => {
    aiOptions.foodByNeed = true;
    aiOptions.foodWithoutIdle = true;
    const { w, ctx } = hungry();
    const before = foodSites(w);
    think(w, ctx, 300);
    expect(foodSites(w)).toBeGreaterThan(before);
  });

  it("does nothing extra without foodByNeed, switch or not", () => {
    aiOptions.foodByNeed = false;
    aiOptions.foodWithoutIdle = true;
    const { w, ctx } = hungry();
    const before = foodSites(w);
    think(w, ctx, 300);
    expect(foodSites(w)).toBe(before);
  });
});

describe("ordering the Hearthship before its goods are in the stores (orderEarly)", () => {
  /** Seat 1 with a launch rail, every other world surveyed, and nothing in the stores. */
  function railed() {
    const s = seat();
    grown(s.w, 20);
    const keep = s.keep;
    expect(placeOn(s.w, "launchrail", s.w.land.ring(keep.tile, 14), 1, true)).toBeGreaterThanOrEqual(0);
    for (const b of s.eco.buildings) if (b.alive && b.owner === 1) b.built = true;
    for (const b of s.eco.buildings) if (b.alive && b.owner === 1 && b.def.storage) for (let g = 0; g < b.stock.length; g++) (b.stock as number[])[g] = 0;
    const voyages = s.w.voyages!;
    for (const p of s.w.system.planets) if (p.surface) voyages.surveyed[1] = (voyages.surveyed[1] ?? 0) | (1 << p.index);
    VoyagePlanner.found = { population: 1, idle: 0 };
    return { ...s, voyages };
  }
  const hearthships = (w: World) => w.voyages!.list.filter((v) => v.owner === 1 && v.kind === "hearthship");

  it("orders nothing from empty stores with the switch off", () => {
    const { w, ctx } = railed();
    new VoyagePlanner(1).step(ctx, 1);
    expect(hearthships(w)).toHaveLength(0);
  });

  it("orders the Hearthship from empty stores with the switch on, and the rail asks for its goods", () => {
    aiOptions.orderEarly = true;
    const { w, ctx, eco } = railed();
    expect(new VoyagePlanner(1).step(ctx, 1)).toBe(true);
    const ship = hearthships(w);
    expect(ship).toHaveLength(1);
    expect(ship[0]!.state).toBe("loading");
    for (let i = 0; i < 60; i++) w.step();
    const rail = eco.buildings.find((b) => b.alive && b.owner === 1 && b.def.rail)!;
    expect(rail.want?.[goodId("plank")] ?? 0).toBeGreaterThan(0);
    expect(rail.want?.[goodId("log")] ?? 0).toBeGreaterThan(0);
  });
});
