import { describe, expect, it } from "vitest";
import { Region, regionFor } from "../src/sim/biomes/regions";
import { sunHeight } from "../src/sim/biomes/sun";
import { BUILDINGS, goodId, goodsFor } from "../src/sim/econ/defs";
import { Feature, GLOWCAP_RIPE, Use } from "../src/sim/econ/landuse";
import { Biome } from "../src/sim/planet/terrain";
import { World } from "../src/sim/world";

const LOCKED = "hedge-1";

describe("Lumen Mire", () => {
  it("a tidally locked planet has a fixed sun: a hot day side, a frozen far side, a twilight ring of mire", () => {
    const w = new World(LOCKED, { size: "small" });
    expect(w.planet.params.locked).toBe(true);
    const land = w.land;
    let lumen = 0;
    for (let t = 0; t < land.region.length; t++) {
      if (land.region[t] !== Region.LumenMire) continue;
      lumen++;
      expect(Math.abs(sunHeight(w.planet, t))).toBeLessThan(0.22);
    }
    expect(lumen).toBeGreaterThan(5);
    // Local time never moves, and day and night are fixed by place.
    const eco = w.economy;
    const day = Array.from({ length: land.region.length }, (_, t) => t).find((t) => sunHeight(w.planet, t) > 0.6)!;
    const night = Array.from({ length: land.region.length }, (_, t) => t).find((t) => sunHeight(w.planet, t) < -0.6)!;
    for (let k = 0; k < 6; k++) {
      eco.tick = w.tick + k * 1000;
      expect(eco.sunUp(day)).toBe(true);
      expect(eco.sunUp(night)).toBe(false);
    }
    w.climate.step(w.tick);
    expect(w.climate.temp[day]!).toBeGreaterThan(w.climate.temp[night]! + 30);
    expect(w.climate.season(w.tick, 0.5)).toBe("summer");
  });

  it("glowcaps grow in the dark, light the ground around them, and a farm plants and harvests them", () => {
    const w = new World(LOCKED, { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const farm = BUILDINGS.find((b) => b.id === "glowcapfarm")!;
    const site = land.ring(keep.tile, 4).find((t) => land.canBuildDef(t, land.bestFlagTile(t, 0), farm, 0))!;
    const patch = land.ring(site, 2).find((t) => land.use[t] === Use.Free && land.feature[t] === Feature.None && land.isLand(t))!;
    land.feature[patch] = Feature.Glowcap;
    land.amount[patch] = 0;
    let tick = w.tick;
    while (tick % 300 !== 149) tick++;
    for (let h = 0; h < 16; h++) eco.step(tick + 1 + h * 300);
    expect(land.amount[patch]).toBe(GLOWCAP_RIPE);
    expect(land.glow[patch]).toBe(1);
    for (const n of w.planet.grid.neighborsOf(patch)) expect(land.glow[n]).toBe(1);
    expect(goodsFor("food")).toContain(goodId("glowcap"));
  });

  it("dark mire slows walkers; peat burns in forges in place of coal", () => {
    const w = new World(LOCKED, { size: "small" });
    const land = w.land;
    const t = Array.from({ length: land.region.length }, (_, i) => i).find((i) => land.region[i] === Region.LumenMire)!;
    const a = w.planet.grid.neighborsOf(t)[0]!;
    land.dim[t] = 0;
    const lit = land.stepCost(a, t);
    land.dim[t] = 1;
    expect(land.stepCost(a, t)).toBeCloseTo(lit * 1.3);
    const smelter = BUILDINGS.find((b) => b.id === "smelter")!;
    expect(smelter.inputs?.fuel).toBe(1);
    expect(goodsFor("fuel")).toEqual(expect.arrayContaining([goodId("coal"), goodId("peat")]));
  });
});

describe("Skyreef", () => {
  it("the highest peaks are Skyreef, with sky islands spread over them that drift but stay near home", () => {
    expect(regionFor(Biome.Rock, 10, 0.3, false, 0.8)).toBe(Region.Skyreef);
    expect(regionFor(Biome.Rock, 10, 0.3, false, 0.5)).toBe(Region.EmberglassSteppe);
    const w = new World("ai-rival-1", { size: "small" });
    const eco = w.economy;
    const islands = eco.skyIslands();
    expect(islands.length).toBeGreaterThan(1);
    for (const i of islands) expect(w.land.region[i.home]).toBe(Region.Skyreef);
    let tick = w.tick;
    const moved = new Set<number>();
    for (let d = 0; d < 10; d++) {
      while (tick % eco.dayLength !== 5401 % eco.dayLength) tick++;
      eco.step(tick);
      tick++;
      for (const i of islands) {
        if (i.at !== i.home) moved.add(i.id);
        expect(i.at === i.home || w.land.ring(i.home, 3).includes(i.at)).toBe(true);
      }
    }
    expect(moved.size).toBeGreaterThan(0);
  });

  it("skystone builds like stone at a construction site, and light worlds carry faster", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const def = BUILDINGS.find((b) => b.id === "house")!;
    const site = land.ring(keep.tile, 5).find((t) => land.canBuildDef(t, land.bestFlagTile(t, 0), def, 0))!;
    expect(eco.apply({ t: "build", type: "house", tile: site, flagTile: land.bestFlagTile(site, 0) }).ok).toBe(true);
    const b = eco.buildings.find((x) => x.def.id === "house" && !x.built)!;
    const stone = goodId("stone");
    const sky = goodId("skystone");
    const need = eco.need(b, stone);
    expect(need).toBeGreaterThan(0);
    expect(eco.need(b, sky)).toBe(need);
    // A skystone on its way counts against the stone still needed.
    b.pending[sky] = 1;
    expect(eco.need(b, stone)).toBe(need - 1);
    expect(eco.need(b, sky)).toBe(need - 1);
    expect(w.planet.params.gravity).toBeLessThan(0.9);
    expect(land.lightness).toBeLessThan(1);
  });
});
