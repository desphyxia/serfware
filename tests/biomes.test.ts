import { describe, expect, it } from "vitest";
import { Region, REGIONS, regionFor } from "../src/sim/biomes/regions";
import { Biome } from "../src/sim/planet/terrain";
import { Feature, fellable, ORCHARD, TREE_MATURE, Use } from "../src/sim/econ/landuse";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

describe("regions", () => {
  it("place the game's biomes by terrain, warmth and wetness", () => {
    expect(regionFor(Biome.Meadow, 14, 0.4, false)).toBe(Region.Meadowlands);
    expect(regionFor(Biome.DeepForest, 18, 0.8, false)).toBe(Region.CanopyDeeps);
    expect(regionFor(Biome.DeepForest, 4, 0.8, false)).toBe(Region.Meadowlands);
    expect(regionFor(Biome.Tundra, -4, 0.5, false)).toBe(Region.RimefallTundra);
    expect(regionFor(Biome.Sea, 10, 1, false)).toBe(Region.None);
    expect(regionFor(Biome.Beach, 18, 0.5, true)).toBe(Region.TidewaterReach);
    for (const r of Object.values(REGIONS)) expect(r.rules.fieldGrowth).toBeGreaterThan(0);
  });

  it("give every land tile a region, and ancient giants only in the Canopy Deeps, never side by side", () => {
    const w = new World("deep-green-7", { size: "small" });
    const land = w.land;
    let giants = 0;
    for (let t = 0; t < land.region.length; t++) {
      expect(land.region[t] !== Region.None).toBe(land.isLand(t));
      if (land.feature[t] !== Feature.Giant) continue;
      giants++;
      expect(land.region[t]).toBe(Region.CanopyDeeps);
      for (const m of w.planet.grid.neighborsOf(t)) expect(land.feature[m]).not.toBe(Feature.Giant);
    }
    expect(giants).toBeGreaterThan(5);
  });
});

describe("Meadowlands", () => {
  it("hedgerows take a log, shelter the fields beside them and can be grubbed up", () => {
    const w = new World("hedge-1", { size: "tiny" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const t = land.ring(keep.tile, 5).find((x) => land.isLand(x) && land.use[x] === Use.Free && land.feature[x] === Feature.None && w.planet.grid.degree(x) === 6)!;
    const field = w.planet.grid.neighborsOf(t).find((x) => land.isLand(x) && land.use[x] === Use.Free && land.feature[x] === Feature.None)!;
    const before = eco.fieldGrowthTicks(field);
    const logs = keep.stock[goodId("log")]!;
    expect(eco.apply({ t: "hedge", tile: t }).ok).toBe(true);
    expect(land.feature[t]).toBe(Feature.Hedge);
    expect(keep.stock[goodId("log")]).toBe(logs - 1);
    expect(eco.fieldGrowthTicks(field)).toBeLessThan(before);
    expect(land.roadable(t)).toBe(false);
    expect(eco.apply({ t: "demolish", tile: t }).ok).toBe(true);
    expect(land.feature[t]).toBe(Feature.None);
    // No logs, no hedgerow.
    keep.stock[goodId("log")] = 0;
    expect(eco.apply({ t: "hedge", tile: t }).ok).toBe(false);
  });

  it("orchard trees bear fruit when grown and in season, and are never felled", () => {
    const w = new World("orchard-1", { size: "tiny" });
    const eco = w.economy;
    const land = w.land;
    const t = land.ring(eco.buildings[eco.keeps[0]!]!.tile, 4).find((x) => land.isLand(x) && land.feature[x] === Feature.None)!;
    land.feature[t] = Feature.Tree;
    land.variety[t] = ORCHARD;
    land.amount[t] = TREE_MATURE;
    land.nextGrowth[t] = 0;
    expect(fellable(land, t)).toBe(false);
    // In season: fruit is ready; in frost it waits.
    w.climate.temp[t] = 18;
    land.snowCover[t] = 0;
    expect(eco.inFruit(t)).toBe(true);
    w.climate.temp[t] = -4;
    expect(eco.inFruit(t)).toBe(false);
    // A young orchard tree bears nothing.
    w.climate.temp[t] = 18;
    land.amount[t] = 2;
    expect(eco.inFruit(t)).toBe(false);
  });
});

describe("Canopy Deeps", () => {
  it("treehouses go up giants on your land and count as homes", () => {
    const w = new World("deep-green-7", { size: "small" });
    const land = w.land;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const giant = land.ring(keep.tile, 12).find((t) => land.feature[t] === Feature.Giant)!;
    expect(giant).toBeGreaterThanOrEqual(0);
    land.claim(giant, 3, 0);
    for (const m of w.planet.grid.neighborsOf(giant)) land.territory[m] = 1;
    const def = { id: "treehouse", name: "Treehouse", description: "", category: "storage" as const, cost: {}, terrain: "giant" as const, home: true };
    const flag = land.bestFlagTile(giant, 0);
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(land.canBuildDef(giant, flag, def, 0)).toBe(true);
    // An ordinary house can't stand on the giant.
    expect(land.canBuild(giant, flag, false, 0)).toBe(false);
    expect(eco.apply({ t: "build", type: "treehouse", tile: giant, flagTile: flag }).ok).toBe(true);
    expect(land.feature[giant]).toBe(Feature.Giant);
  });

  it("marking an ancient giant, then felling it, empties the forest and grieves the people", () => {
    const w = new World("deep-green-7", { size: "small" });
    const land = w.land;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const giant = land.ring(keep.tile, 12).find((t) => land.feature[t] === Feature.Giant)!;
    land.territory[giant] = 1;
    expect(eco.apply({ t: "demolish", tile: giant }).ok).toBe(true);
    expect(land.variety[giant]).toBe(1);
    const game = eco.ecology.game;
    for (const m of land.ring(giant, 3)) game[m] = 100;
    (eco as unknown as { ancientFelled(t: number, o: number): void }).ancientFelled(giant, 0);
    expect(game[land.ring(giant, 1)[0]!]).toBeLessThan(50);
    expect(eco.griefUntil[0]).toBeGreaterThan(w.tick);
  });
});
