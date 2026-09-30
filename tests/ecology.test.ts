import { describe, expect, it } from "vitest";
import { Ecology, FIRE_STEP, type EcologyHost } from "../src/sim/econ/ecology";
import { Feature, TREE_MATURE, Use } from "../src/sim/econ/landuse";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

const DAY = 7200;

function host(over: Partial<EcologyHost> = {}): EcologyHost & { burnt: number[]; seeds: number[] } {
  const burnt: number[] = [];
  const seeds: number[] = [];
  return {
    dayLength: DAY,
    wellCovers: () => false,
    beesBoost: () => false,
    scorchBuilding: (t) => burnt.push(t),
    seedling: (t) => seeds.push(t),
    temp: () => 24,
    rain: () => 0,
    notifyFire: () => {},
    burnt,
    seeds,
    ...over,
  };
}

/** A land tile far from any keep with many land neighbours, turned into a dry forest patch. */
function forestPatch(w: World): { centre: number; tiles: number[] } {
  const land = w.land;
  const keeps = w.economy.keeps.map((k) => w.economy.buildings[k]!.tile);
  for (let t = 0; t < w.planet.grid.count; t++) {
    if (!land.isLand(t) || land.slope(t) > 1.5 || keeps.some((k) => land.ring(k, 12).includes(t))) continue;
    const tiles = [t, ...land.ring(t, 4)];
    if (!tiles.every((x) => land.isLand(x) && land.use[x] === Use.Free && !land.isRiver(x))) continue;
    for (const x of tiles) {
      land.feature[x] = Feature.Tree;
      land.amount[x] = TREE_MATURE;
      land.snowCover[x] = 0;
      land.mud[x] = 0;
    }
    return { centre: t, tiles };
  }
  throw new Error("no patch");
}

function burn(eco: Ecology, from: number, to: number): void {
  for (let tick = from; tick < to; tick += FIRE_STEP) eco.step(tick, false);
}

describe("fire", () => {
  it("spreads through a dry forest, leaves charred stumps and burns out", () => {
    const w = new World("fire-1", { size: "small" });
    const { centre, tiles } = forestPatch(w);
    const eco = new Ecology(w.land, host());
    for (const t of tiles) eco.dry[t] = 1;
    expect(eco.ignite(centre)).toBe(true);
    burn(eco, 5, 5 + FIRE_STEP * 400);
    expect(eco.burning.length).toBe(0);
    const stumps = tiles.filter((t) => w.land.feature[t] === Feature.Stump).length;
    expect(stumps).toBeGreaterThan(8);
    expect(eco.scorch[centre]).toBeGreaterThan(0);
  });

  it("does not take hold in wet or snowy ground", () => {
    const w = new World("fire-2", { size: "small" });
    const { centre, tiles } = forestPatch(w);
    const eco = new Ecology(w.land, host());
    for (const t of tiles) w.land.snowCover[t] = 1;
    expect(eco.ignite(centre)).toBe(false);
  });

  it("is quenched by wells: fewer tiles burn", () => {
    const run = (wells: boolean) => {
      const w = new World("fire-3", { size: "small" });
      const { centre, tiles } = forestPatch(w);
      const eco = new Ecology(w.land, host({ wellCovers: () => wells }));
      for (const t of tiles) eco.dry[t] = 1;
      eco.ignite(centre);
      burn(eco, 5, 5 + FIRE_STEP * 400);
      return tiles.filter((t) => w.land.feature[t] === Feature.Stump).length;
    };
    expect(run(true)).toBeLessThan(run(false));
  });
});

describe("succession", () => {
  it("turns a grassy clearing next to seed trees into scrub and then young trees", () => {
    const w = new World("succession-1", { size: "small" });
    const { centre } = forestPatch(w);
    const land = w.land;
    land.feature[centre] = Feature.None;
    land.amount[centre] = 0;
    const h = host({ temp: () => 15 });
    const eco = new Ecology(land, h);
    eco.cover[centre] = 255;
    let shrub = false;
    for (let tick = 10; tick < DAY * 60 && land.feature[centre] !== Feature.Tree; tick += 10) {
      eco.step(tick, false);
      if (land.feature[centre] === Feature.Shrub) shrub = true;
    }
    expect(shrub).toBe(true);
    expect(land.feature[centre]).toBe(Feature.Tree);
    expect(h.seeds).toContain(centre);
  });
});

describe("wildlife and erosion", () => {
  it("herds grow toward what the land carries, overshoot and stay bounded; hunting thins them", () => {
    const w = new World("game-1", { size: "small" });
    const eco = new Ecology(w.land, host({ temp: () => 15 }));
    const land = w.land;
    const forest = Array.from({ length: w.planet.grid.count }, (_, t) => t).filter((t) => land.isLand(t) && eco.game[t]! > 50);
    expect(forest.length).toBeGreaterThan(10);
    const totals: number[] = [];
    for (let d = 1; d <= 40; d++) {
      eco.step(d * DAY, false);
      totals.push(forest.reduce((s, t) => s + eco.game[t]!, 0));
    }
    expect(Math.max(...totals)).toBeLessThan(forest.length * 255);
    expect(Math.min(...totals)).toBeGreaterThan(0);
    const t = forest[0]!;
    eco.game[t] = 100;
    expect(eco.hunt(t)).toBe(true);
    expect(eco.game[t]).toBe(82);
  });

  it("washes soil off bare, muddy slopes onto the land below", () => {
    const w = new World("erosion-1", { size: "small" });
    const land = w.land;
    const e = w.planet.terrain.elevation;
    const eco = new Ecology(land, host({ temp: () => 15 }));
    let slope = -1;
    for (let t = 0; t < w.planet.grid.count; t++) {
      if (land.isLand(t) && !land.isRiver(t) && land.slope(t) > 1.5 && land.feature[t] === Feature.None && land.use[t] === Use.Free) {
        slope = t;
        break;
      }
    }
    expect(slope).toBeGreaterThanOrEqual(0);
    const low = w.planet.grid.neighborsOf(slope).reduce((a, b) => (e[b]! < e[a]! ? b : a));
    for (let t = 0; t < land.mud.length; t++) land.mud[t] = 1;
    land.soil[slope] = 0.8;
    land.soil[low] = 0.3;
    eco.cover[slope] = 0;
    const before = land.soil[slope]!;
    for (let tick = 10; tick < 1800 * 3; tick += 10) {
      eco.cover[slope] = 0;
      eco.step(tick, false);
    }
    expect(land.soil[slope]!).toBeLessThan(before);
    if (land.isLand(low)) expect(land.soil[low]!).toBeGreaterThan(0.3);
  });
});

describe("buildings weather and ask for upkeep", () => {
  it("a house grows weathered and asks for a plank; a built well needs groundwater", () => {
    const w = new World("upkeep-1", { size: "small" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    keep.wear = 0.6;
    // Storage mends itself from its own stock the next day.
    const planks = keep.stock[goodId("plank")]!;
    for (let i = 0; i < DAY + 5; i++) w.step();
    expect(keep.wear).toBeLessThan(0.5);
    expect(keep.stock[goodId("plank")]!).toBeLessThan(planks + 1);
    // A lone, weathered house would ask for a plank.
    const house = { ...keep, def: { ...keep.def, storage: false, id: "house" }, cost: keep.cost.map(() => 0), stock: keep.stock.map(() => 0), pending: keep.pending.map(() => 0), wear: 0.7 };
    house.cost[goodId("plank")] = 3;
    expect(eco.need(house, goodId("plank"))).toBe(1);
    expect(eco.need(house, goodId("stone"))).toBe(0);
    // Wells only go where the ground holds water.
    const aq = eco.ecology.aquifer;
    let dry = -1;
    for (let t = 0; t < aq.length; t++) if (w.land.isLand(t) && aq[t]! < 0.2) dry = t;
    expect(dry).toBeGreaterThanOrEqual(0);
    const def = { id: "well", name: "Well", description: "", category: "storage" as const, cost: {}, terrain: "aquifer" as const };
    expect(w.land.canBuildDef(dry, w.planet.grid.neighborsOf(dry)[0]!, def, 0)).toBe(false);
  });
});
