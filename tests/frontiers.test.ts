import { describe, expect, it } from "vitest";
import { Region } from "../src/sim/biomes/regions";
import { BUILDINGS, goodId } from "../src/sim/econ/defs";
import { Feature, Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

/** A lake tile with land around it, all given to player 0. */
function claimedLake(w: World): { lake: number; shore: number } {
  const land = w.land;
  const grid = w.planet.grid;
  for (let t = 0; t < grid.count; t++) {
    if (!land.hydro.lake[t]) continue;
    const shore = grid.neighborsOf(t).find((n) => land.isLand(n) && land.use[n] === Use.Free && land.feature[n] === Feature.None && land.slope(n) < 2);
    if (shore === undefined) continue;
    for (const m of [t, ...land.ring(t, 3)]) land.territory[m] = 1;
    return { lake: t, shore };
  }
  throw new Error("no lake");
}

describe("Rimefall Tundra", () => {
  it("lakes freeze in a hard frost; ice roads cross them and sink in the thaw", () => {
    const w = new World("frost-1", { size: "small" });
    const land = w.land;
    const eco = w.economy;
    const { lake, shore } = claimedLake(w);
    expect(land.walkable(lake)).toBe(false);
    expect(land.roadable(lake, 0)).toBe(false);
    land.frozen[lake] = 1;
    expect(land.isIce(lake)).toBe(true);
    expect(land.walkable(lake)).toBe(true);
    expect(land.canPlaceFlag(lake, 0)).toBe(true);
    // A flag out on the ice, joined to one on the shore beyond.
    const far = land.planet.grid.neighborsOf(shore).find((n) => n !== lake && !land.planet.grid.neighborsOf(n).includes(lake) && land.canPlaceFlag(n, 0));
    expect(far).toBeDefined();
    expect(eco.apply({ t: "flag", tile: lake }).ok).toBe(true);
    expect(eco.apply({ t: "flag", tile: far! }).ok).toBe(true);
    expect(eco.apply({ t: "road", tiles: [lake, shore, far!] })).toEqual({ ok: true });
    // Ice is quick with a sledge on a road.
    expect(land.stepCost(shore, lake)).toBeLessThan(0.7);
    expect(land.sledging(lake)).toBe(true);
    // The thaw.
    land.frozen[lake] = 0;
    w.climate.thawed = true;
    const notices = eco.notices.length;
    eco.step(w.tick + 1);
    expect(land.use[lake]).toBe(Use.Free);
    expect(eco.roads.filter((r) => r.alive && r.tiles.includes(shore))).toHaveLength(0);
    expect(eco.notices.slice(notices).some((n) => /ice/.test(n.text))).toBe(true);
  });

  it("the climate freezes lakes below -3 °C and thaws them above 1 °C", () => {
    // A planet with seasons (hedge-1 is tidally locked: no seasons, so its lakes never cycle).
    const w = new World("lake-1", { size: "small" });
    expect(w.planet.params.locked).toBe(false);
    const land = w.land;
    // Run through a year and see some lake both frozen and open.
    const seen = new Map<number, Set<number>>();
    for (let tick = w.tick; tick < w.tick + w.economy.dayLength * 24; tick += 20 * 30) {
      w.climate.step(tick);
      for (let t = 0; t < land.frozen.length; t++) if (land.hydro.lake[t]) (seen.get(t) ?? seen.set(t, new Set()).get(t)!).add(land.frozen[t]!);
    }
    expect([...seen.values()].some((s) => s.size === 2)).toBe(true);
  });

  it("drifts slow walkers off-road, sledges speed carriers on snowy roads, and cold bites far from a hearth", () => {
    const w = new World("ember-1", { size: "small" });
    const land = w.land;
    const grid = w.planet.grid;
    const e = w.planet.terrain.elevation;
    const t = Array.from({ length: grid.count }, (_, i) => i).find((i) => land.region[i] === Region.RimefallTundra && land.use[i] === Use.Free && land.slope(i) < 0.5)!;
    const a = grid.neighborsOf(t).reduce((x, y) => (Math.abs(e[y]! - e[t]!) < Math.abs(e[x]! - e[t]!) ? y : x));
    land.snowCover[t] = 0;
    land.mud[t] = 0;
    land.chill[t] = 0;
    const bare = land.stepCost(a, t);
    land.snowCover[t] = 1;
    const drift = land.stepCost(a, t);
    expect(drift).toBeGreaterThan(bare * 1.8);
    land.chill[t] = 1;
    const cold = land.stepCost(a, t);
    expect(cold).toBeGreaterThan(drift * 1.3);
    land.warm[t] = 1;
    expect(land.stepCost(a, t)).toBeCloseTo(drift);
    land.use[t] = Use.Road;
    expect(land.stepCost(a, t)).toBeLessThan(bare * 0.7);
    expect(land.sledging(t)).toBe(true);
  });

  it("a waystation burns logs in the cold and warms the land around it; houses warm their doorsteps", () => {
    const w = new World("ember-1", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const way = BUILDINGS.find((b) => b.id === "waystation")!;
    expect(way.warmth).toBe(4);
    // Put a working waystation near the keep (via a building record) and freeze the land.
    const site = land.ring(keep.tile, 4).find((t) => land.canBuildDef(t, land.bestFlagTile(t, 0), way, 0))!;
    expect(eco.apply({ t: "build", type: "waystation", tile: site, flagTile: land.bestFlagTile(site, 0) }).ok).toBe(true);
    const b = eco.buildings.find((x) => x.def.id === "waystation")!;
    b.built = true;
    b.stock[goodId("log")] = 2;
    const far = land.ring(site, 4).at(-1)!;
    land.chill.fill(1);
    let tick = w.tick;
    while (tick % 300 !== 149) tick++;
    eco.step(tick + 1);
    expect(b.stock[goodId("log")]).toBe(1);
    expect(eco.heated(b)).toBe(true);
    expect(land.warm[far]).toBe(1);
    // Without fuel it goes cold once the log burns out.
    b.stock[goodId("log")] = 0;
    b.fuelUntil = 0;
    eco.step(tick + 301);
    expect(eco.heated(b)).toBe(false);
    expect(land.warm[keep.tile]).toBe(1);
    // It asks for firewood without a worker.
    expect(eco.need(b, goodId("log"))).toBeGreaterThan(0);
  });
});

describe("Emberglass Steppe", () => {
  it("vents appear only in the Emberglass, never side by side, and block roads and buildings", () => {
    const w = new World("frost-1", { size: "small" });
    const land = w.land;
    const vents = w.economy.vents();
    expect(vents.length).toBeGreaterThan(3);
    for (const t of vents) {
      expect(land.region[t]).toBe(Region.EmberglassSteppe);
      expect(land.walkable(t)).toBe(false);
      expect(land.roadable(t, (land.territory[t] || 1) - 1)).toBe(false);
      for (const m of w.planet.grid.neighborsOf(t)) expect(land.feature[m]).not.toBe(Feature.Vent);
    }
  });

  it("forges by a vent need no coal; greenhouses go only beside one", () => {
    const w = new World("frost-1", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const vent = eco.vents()[0]!;
    const smelter = BUILDINGS.find((b) => b.id === "smelter")!;
    const green = BUILDINGS.find((b) => b.id === "greenhouse")!;
    const near = land.planet.grid.neighborsOf(vent)[0]!;
    const fake = (tile: number) => ({ def: smelter, tile }) as unknown as Parameters<typeof eco.ventHeat>[0];
    expect(eco.ventHeat(fake(near))).toBe(true);
    const away = land.ring(vent, 6).at(-1)!;
    if (!land.nearVent(away, 2)) expect(eco.ventHeat(fake(away))).toBe(false);
    for (const t of land.ring(vent, 2)) land.territory[t] = 1;
    const ok = land.planet.grid.neighborsOf(vent).some((t) => land.planet.grid.neighborsOf(t).some((f) => land.canBuildDef(t, f, green, 0)));
    const farOk = land.canBuildDef(away, land.planet.grid.neighborsOf(away)[0]!, green, 0);
    expect(farOk).toBe(false);
    expect(ok).toBe(true);
  });

  it("pressure builds into tremors and an eruption: ash, richer soil, scorched buildings", () => {
    const w = new World("frost-1", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const vent = eco.vents()[0]!;
    const ring = land.ring(vent, 3).filter((t) => land.isLand(t));
    const soil = ring.map((t) => land.soil[t]!);
    for (const t of ring) land.territory[t] = 1;
    land.amount[vent] = 200;
    const notices = eco.notices.length;
    let tick = w.tick;
    let erupted = false;
    let tremors = 0;
    for (let d = 0; d < 20 && !erupted; d++) {
      while (tick % eco.dayLength !== 3601 % eco.dayLength) tick++;
      eco.step(tick);
      tremors = Math.max(tremors, eco.tremors.get(vent) ?? 0);
      erupted = land.amount[vent]! < 50;
      tick++;
    }
    expect(erupted).toBe(true);
    expect(tremors).toBeGreaterThan(0);
    expect(land.ash[ring[0]!]).toBeGreaterThan(0.5);
    expect(ring.every((t, i) => land.soil[t]! >= soil[i]!)).toBe(true);
    expect(eco.notices.slice(notices).some((n) => /erupted/.test(n.text))).toBe(true);
    expect(eco.notices.slice(notices).some((n) => /trembles/.test(n.text))).toBe(true);
  });

  it("obsidian in store lifts Glow's beauty", () => {
    const w = new World("frost-1", { size: "small" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    let tick = w.tick;
    const run = () => {
      for (let i = 0; i < 400; i++) eco.step(++tick);
      return eco.glowParts[0]!.beauty;
    };
    const before = run();
    keep.stock[goodId("obsidian")] = 12;
    expect(run()).toBeGreaterThan(before);
  });
});
