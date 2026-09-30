import { describe, expect, it } from "vitest";
import { Region } from "../src/sim/biomes/regions";
import { moonsOf, tideAt, tideLevel } from "../src/sim/biomes/tides";
import { BUILDINGS, goodId } from "../src/sim/econ/defs";
import { Feature, Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

describe("Tidewater Reach", () => {
  it("the moons raise tides that cover and uncover the flats twice a day or so", () => {
    const w = new World(SEED, { size: "small" });
    const moons = moonsOf(w.planet, w.economy.dayLength);
    expect(moons.length).toBeGreaterThanOrEqual(1);
    expect(moons.length).toBeLessThanOrEqual(3);
    const land = w.land;
    const flats = Array.from({ length: land.tidal.length }, (_, t) => t).filter((t) => land.tidal[t]);
    expect(flats.length).toBeGreaterThan(20);
    let lo = 1;
    let hi = -1;
    const seen = new Map<number, Set<number>>();
    for (let tick = w.tick; tick < w.tick + w.economy.dayLength; tick += 100) {
      const tide = tideAt(moons, tick);
      lo = Math.min(lo, tide);
      hi = Math.max(hi, tide);
      w.climate.step(tick);
      for (const t of flats) (seen.get(t) ?? seen.set(t, new Set()).get(t)!).add(land.flooded[t]!);
    }
    expect(lo).toBeLessThan(-0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect([...seen.values()].some((s) => s.size === 2)).toBe(true);
    // Only flats below the water line flood.
    w.climate.step(w.tick);
    for (const t of flats) expect(land.flooded[t]).toBe(w.planet.terrain.elevation[t]! < tideLevel(w.climate.tide) ? 1 : 0);
  });

  it("flooded flats can't be walked, but a causeway (one stone) keeps the road dry", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const eco = w.economy;
    const t = Array.from({ length: land.tidal.length }, (_, i) => i).find((i) => land.tidal[i] && land.use[i] === Use.Free && land.feature[i] === Feature.None)!;
    land.territory[t] = 1;
    land.flooded[t] = 1;
    expect(land.walkable(t)).toBe(false);
    const keep = eco.buildings[eco.keeps[0]!]!;
    const stone = keep.stock[goodId("stone")]!;
    expect(eco.apply({ t: "causeway", tile: t })).toEqual({ ok: true });
    expect(keep.stock[goodId("stone")]).toBe(stone - 1);
    expect(land.walkable(t)).toBe(true);
    expect(eco.apply({ t: "causeway", tile: t }).ok).toBe(false);
    const dry = land.ring(keep.tile, 2).find((x) => !land.tidal[x])!;
    expect(eco.apply({ t: "causeway", tile: dry }).ok).toBe(false);
  });

  it("shellfishers gather only from exposed flats; tide mills and shellfishers go by the sea", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const shell = BUILDINGS.find((b) => b.id === "shellfisher")!;
    const mill = BUILDINGS.find((b) => b.id === "tidemill")!;
    expect(shell.terrain).toBe("coast");
    expect(mill.tidal).toBe(true);
    const flat = Array.from({ length: land.tidal.length }, (_, i) => i).find((i) => land.tidal[i])!;
    expect(land.shell[flat]).toBeGreaterThan(0);
  });
});

describe("Saltglass Flats", () => {
  it("crystal spires stand only on the Saltglass, never side by side, and block the way", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    let spires = 0;
    for (let t = 0; t < land.feature.length; t++) {
      if (land.feature[t] !== Feature.Spire) continue;
      spires++;
      expect(land.region[t]).toBe(Region.SaltglassFlats);
      expect(land.walkable(t)).toBe(false);
      for (const m of w.planet.grid.neighborsOf(t)) expect(land.feature[m]).not.toBe(Feature.Spire);
    }
    expect(spires).toBeGreaterThan(0);
  });

  it("work slows in the heat of the day and quickens at night", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const t = Array.from({ length: w.land.region.length }, (_, i) => i).find((i) => w.land.region[i] === Region.SaltglassFlats)!;
    w.climate.temp[t] = 38;
    let day = false;
    let night = false;
    for (let k = 0; k < 24 && !(day && night); k++) {
      eco.tick = w.tick + k * Math.round(eco.dayLength / 24);
      if (eco.sunUp(t)) {
        day = true;
        expect(eco.heatSpeed(t)).toBeGreaterThan(1.5);
      } else {
        night = true;
        expect(eco.heatSpeed(t)).toBeLessThan(1);
      }
    }
    expect(day && night).toBe(true);
    const meadow = Array.from({ length: w.land.region.length }, (_, i) => i).find((i) => w.land.region[i] === Region.Meadowlands)!;
    expect(eco.heatSpeed(meadow)).toBe(1);
  });

  it("sandstorms bury roads, which traffic clears; storms blow out after six hours", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const t = Array.from({ length: land.region.length }, (_, i) => i).find((i) => land.region[i] === Region.SaltglassFlats && land.isLand(i))!;
    const n = w.planet.grid.neighborsOf(t)[0]!;
    land.use[t] = Use.Road;
    const clear = land.stepCost(n, t);
    eco.startStorm(t);
    let tick = w.tick;
    while (tick % 300 !== 149) tick++;
    for (let h = 0; h < 3; h++) eco.step(tick + 1 + h * 300);
    expect(land.sand[t]).toBeGreaterThan(0.5);
    expect(land.stepCost(n, t)).toBeGreaterThan(clear * 1.5);
    for (let h = 3; h < 8; h++) eco.step(tick + 1 + h * 300);
    expect(eco.storms).toHaveLength(0);
  });

  it("dew condensers speed the dry fields around them; salt and glass lift Glow", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const dew = BUILDINGS.find((b) => b.id === "dewcondenser")!;
    const site = land.ring(keep.tile, 4).find((t) => land.canBuildDef(t, land.bestFlagTile(t, 0), dew, 0))!;
    const near = land.ring(site, 2).find((t) => land.isLand(t))!;
    const before = eco.fieldGrowthTicks(near);
    expect(eco.apply({ t: "build", type: "dewcondenser", tile: site, flagTile: land.bestFlagTile(site, 0) }).ok).toBe(true);
    eco.buildings.find((b) => b.def.id === "dewcondenser")!.built = true;
    eco.structureVersion++;
    expect(eco.fieldGrowthTicks(near)).toBeLessThan(before);
    expect(eco.wellCovers(near)).toBe(true);
    // Clear the trees and spires around the Hearthship, so beauty sits below its cap.
    for (const t of land.ring(keep.tile, 7)) if (land.feature[t] === Feature.Tree || land.feature[t] === Feature.Spire) land.feature[t] = Feature.None;
    let tick = w.tick;
    const run = () => {
      for (let i = 0; i < 400; i++) eco.step(++tick);
      return eco.glowParts[0]!;
    };
    const a = run();
    keep.stock[goodId("salt")] = 12;
    keep.stock[goodId("glass")] = 12;
    const b = run();
    expect(b.beauty).toBeGreaterThan(a.beauty);
    expect(b.nourishment).toBeGreaterThanOrEqual(a.nourishment);
  });
});
