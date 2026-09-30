import { describe, expect, it } from "vitest";
import { LIFE } from "../src/sim/climate/atmosphere";
import { BUILDINGS } from "../src/sim/econ/defs";
import { Feature } from "../src/sim/econ/landuse";
import { Rng } from "../src/sim/rng";
import { worldFor } from "../src/sim/system/system";
import { planetSeed, World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** A rooted colony on another planet of the system (the native flag forced when asked). */
function colony(opts: { native?: boolean; kind?: string } = {}) {
  const home = new World(SEED, { size: "tiny" });
  const p = home.system.planets.find((q) => q.surface && !q.home && (!opts.kind || q.kind === opts.kind)) ?? home.system.planets.find((q) => q.surface && !q.home)!;
  const spec = worldFor(p);
  const w = new World(planetSeed(SEED, p.name), { ...spec, native: opts.native ?? spec.native, colony: true, players: 1, startTick: 0 });
  const eco = w.economy;
  const site = Array.from({ length: eco.land.region.length }, (_, t) => t).find((t) => eco.landingProblem(t) === null)!;
  eco.settleAt(site, new Rng("t"), 0, { people: [], stock: new Array(64).fill(20), radius: 6 });
  eco.rooted[0] = true;
  return { w, eco, land: w.land, site, p };
}

function build(w: World, type: string, near: number): number {
  const def = BUILDINGS.find((b) => b.id === type)!;
  for (let r = 2; r < 9; r++)
    for (const t of w.land.ring(near, r)) {
      const f = w.land.bestFlagTile(t, 0);
      if (f < 0 || !w.land.canBuildDef(t, f, def, 0)) continue;
      if (!w.command({ t: "build", type, tile: t, flagTile: f }).ok) continue;
      const b = w.economy.buildings[w.economy.buildings.length - 1]!;
      b.built = true;
      return b.tile;
    }
  throw new Error(`no site for ${type}`);
}

describe("terraforming", () => {
  it("other planets start bare: no trees or scrub, barren ground, thin or poisonous air; home already blooms", () => {
    const home = new World(SEED, { size: "tiny" });
    expect(home.atmosphere.bloom).toBe(true);
    expect(home.land.life.every((v) => v === LIFE.woodland)).toBe(true);
    const { w, land } = colony();
    expect(w.atmosphere.bloom).toBe(false);
    expect(w.atmosphere.oxygen).toBeLessThan(0.05);
    let trees = 0;
    for (let t = 0; t < land.feature.length; t++) {
      if (land.feature[t] === Feature.Tree || land.feature[t] === Feature.Shrub) trees++;
      if (land.isLand(t)) expect(land.life[t]).toBe(LIFE.barren);
    }
    expect(trees).toBe(0);
    // One world in three had life of its own: native mats in patches.
    const withNative = colony({ native: true });
    expect(withNative.land.native.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  it("works are for rooted colonies only, never home", () => {
    const home = new World(SEED, { size: "tiny" });
    const keep = home.economy.buildings[home.economy.keeps[0]!]!;
    expect(() => build(home, "mirrorworks", keep.tile)).toThrow();
    const { w, eco, site } = colony();
    eco.rooted[0] = false;
    expect(() => build(w, "mirrorworks", site)).toThrow();
    eco.rooted[0] = true;
    expect(build(w, "mirrorworks", site)).toBeGreaterThanOrEqual(0);
  });

  it("mirrors warm the world (and the warming fades unless kept up); comets bring water and raise the seas", () => {
    const { w } = colony();
    const a = w.atmosphere;
    for (let i = 0; i < 20; i++) a.work("mirror", 0);
    a.day(1);
    expect(a.warming).toBeGreaterThan(5);
    expect(w.climate.tempOffset).toBe(a.warming);
    const t0 = w.climate.temp[10]!;
    w.climate.step(w.tick);
    expect(w.climate.temp[10]!).toBeGreaterThan(t0 + 4);
    const warm = a.warming;
    a.day(2);
    expect(a.warming).toBeLessThan(warm);
    // Comets: water, then the sea rises over the lowest shores.
    const water = a.water;
    for (let i = 0; i < 40; i++) a.work("comet", 0);
    a.day(3);
    expect(a.water).toBeGreaterThan(water + 1);
    expect(w.climate.seaRise).toBeGreaterThan(0.05);
    const low = Array.from({ length: w.land.flooded.length }, (_, t) => t).filter((t) => w.land.isLand(t) && w.planet.terrain.elevation[t]! < 0.05 + w.climate.seaRise);
    w.climate.step(w.tick + 60);
    if (low.length) expect(low.every((t) => w.land.flooded[t] === 1)).toBe(true);
  });

  it("seed houses sow life as far as the air allows, and it spreads by succession", () => {
    const { w, land, site } = colony();
    const a = w.atmosphere;
    // Thin, cold air: lichen at most.
    a.pressure = 0.2;
    a.work("life", site);
    a.day(1);
    const around = land.ring(site, 5).filter((t) => land.isLand(t));
    expect(around.some((t) => land.life[t] === LIFE.lichen)).toBe(true);
    expect(around.every((t) => land.life[t]! <= LIFE.lichen)).toBe(true);
    // Better air, warmth and water: grass and woodland, and life spreads by itself.
    a.pressure = 1;
    a.oxygen = 0.15;
    a.water = 0.8;
    a.warming = 30 - a.baseTemp;
    a.apply();
    w.climate.step(w.tick);
    const before = land.life.reduce((s, v) => s + v, 0);
    for (let d = 2; d < 14; d++) {
      a.work("life", site);
      a.day(d);
    }
    expect(around.some((t) => land.life[t] === LIFE.woodland)).toBe(true);
    expect(land.life.reduce((s, v) => s + v, 0)).toBeGreaterThan(before + 60);
  });

  it("native life fades under the new air except in reserves; a gene bank keeps its species", () => {
    const { w, land, eco } = colony({ native: true });
    const a = w.atmosphere;
    const mats = Array.from({ length: land.native.length }, (_, t) => t).filter((t) => land.native[t]);
    // A reserve over one patch.
    const patch = mats[0]!;
    eco.buildings.push({ ...eco.buildings[eco.keeps[0]!]!, id: eco.buildings.length, tile: patch, def: BUILDINGS.find((b) => b.id === "reserve")!, built: true, alive: true });
    a.oxygen = 0.2;
    for (let d = 1; d < 40; d++) a.day(d);
    expect(land.native[patch]).toBe(1);
    expect(mats.filter((t) => land.native[t]).length).toBeLessThan(mats.length / 2);
    // Gene bank next to native life: banked after six cycles.
    const near = mats.find((t) => land.native[t])!;
    for (let d = 0; d < 6; d++) {
      a.work("bank", near);
      a.day(100 + d);
    }
    expect(a.banked).toBe(true);
    expect(a.check().native).toBe(true);
  });

  it("a world blooms when the air, warmth, water and life are all there", () => {
    const { w, land, eco } = colony();
    const a = w.atmosphere;
    expect(a.checkBloom()).toBe(false);
    a.pressure = 1;
    a.oxygen = 0.2;
    a.water = 0.9;
    a.warming = 15 - a.baseTemp;
    for (let t = 0; t < land.life.length; t++) if (land.isLand(t)) land.life[t] = LIFE.grass;
    a.day(1);
    expect(a.check()).toEqual({ pressure: true, oxygen: true, temp: true, water: true, life: true, native: true });
    expect(a.checkBloom()).toBe(true);
    expect(a.bloom).toBe(true);
    expect(eco.notices.some((n) => n.text.includes("bloomed"))).toBe(true);
  });

  it("terraforming is deterministic: the same works give the same world", () => {
    const run = () => {
      const { w, site } = colony();
      build(w, "mirrorworks", site);
      for (let i = 0; i < 3000; i++) w.step();
      w.atmosphere.work("comet", site);
      w.atmosphere.work("life", site);
      w.atmosphere.day(99);
      return w.checksum();
    };
    expect(run()).toBe(run());
  });
});
