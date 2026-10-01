import { describe, expect, it } from "vitest";
import { DISCOVERY_IDS, FESTIVALS } from "../src/sim/econ/culture";
import { BUILDINGS, goodId } from "../src/sim/econ/defs";
import { Feature, RUIN_DIGS } from "../src/sim/econ/landuse";
import { placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

function build(w: World, type: string, near: number, player = 0): number {
  const def = BUILDINGS.find((b) => b.id === type)!;
  for (let r = 1; r < 8; r++)
    for (const t of w.land.ring(near, r)) {
      const f = w.land.bestFlagTile(t, player);
      if (f < 0 || !w.land.canBuildDef(t, f, def, player)) continue;
      if (!w.command({ t: "build", type, tile: t, flagTile: f, player }).ok) continue;
      const b = w.economy.buildings[w.economy.buildings.length - 1]!;
      b.built = true;
      return b.id;
    }
  throw new Error(`no site for ${type}`);
}

/** Step the economy straight to its next daily tick (where culture looks around). */
function nextDay(w: World): void {
  const eco = w.economy;
  const day = Math.ceil((w.tick + 1) / eco.dayTicks) * eco.dayTicks;
  w.tick = day;
  w.climate.step(day);
  eco.step(day);
}

describe("knowledge and culture", () => {
  it("every Star Well on land has a Precursor ruin beside it, placed without touching the world's random stream", () => {
    const w = new World(SEED, { size: "small" });
    const grid = w.planet.grid;
    let wells = 0;
    for (let t = 0; t < grid.count; t++) {
      if (grid.degree(t) !== 5 || !w.land.isLand(t)) continue;
      if (!grid.neighborsOf(t).some((n) => w.land.isLand(n) && grid.degree(n) === 6)) continue;
      wells++;
      const ruins = grid.neighborsOf(t).filter((n) => w.land.feature[n] === Feature.Ruin);
      expect(ruins.length).toBeGreaterThanOrEqual(1);
      for (const r of ruins) expect(w.land.amount[r]).toBe(RUIN_DIGS);
    }
    expect(wells).toBeGreaterThan(3);
    // Same seed, same world.
    expect(new World(SEED, { size: "small" }).checksum()).toBe(w.checksum());
  });

  it("the Almanac fills by watching the world, and its pages unlock blueprints", () => {
    const w = new World(SEED, { size: "tiny" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    expect(eco.culture.has(0, "weather")).toBe(false);
    for (let d = 0; d < 3; d++) nextDay(w);
    expect(eco.culture.has(0, "weather")).toBe(true);
    expect(eco.culture.unlocked(0, "forecast")).toBe(true);
    // The maypole waits for the turning year.
    expect(() => build(w, "maypole", keep.tile)).toThrow();
    eco.culture.discover(0, "seasons");
    expect(build(w, "maypole", keep.tile)).toBeGreaterThanOrEqual(0);
    expect(eco.notices.some((n) => n.text.includes("Almanac"))).toBe(true);
    // Every discovery has a page.
    for (const id of DISCOVERY_IDS) expect(eco.culture.discover(1, id)).toBe(false);
  });

  it("an excavation digs relics out of a ruin; the first one adds the Precursors to the Almanac", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const land = w.land;
    // This seed's start has a Star Well, and its ruin, inside the border.
    const keep = eco.buildings[eco.keeps[0]!]!;
    const ruin = land.ring(keep.tile, 7).find((t) => land.feature[t] === Feature.Ruin && land.territory[t] === 1)!;
    expect(ruin).toBeDefined();
    eco.culture.discover(0, "stars");
    const at = placeOn(w, "digsite", land.ring(ruin, 2), 0);
    expect(at).toBeGreaterThanOrEqual(0);
    const site = eco.buildings.find((b) => b.def.id === "digsite")!;
    site.built = true;
    for (let i = 0; i < 20000 && !eco.culture.has(0, "precursors"); i++) w.step();
    expect(land.amount[ruin]).toBeLessThan(RUIN_DIGS);
    expect(eco.culture.relics[0]).toBeGreaterThan(0);
    expect(eco.culture.has(0, "precursors")).toBe(true);
    expect(eco.culture.unlocked(0, "statue")).toBe(true);
  });

  it("festivals come on the world's calendar: with a maypole and food to share, everyone feasts and Glow's joy rises", () => {
    const w = new World(SEED, { size: "tiny" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    eco.culture.discover(0, "seasons");
    build(w, "maypole", keep.tile);
    const food = () => ["bread", "fish"].reduce((s, g) => s + (eco.storageTotals(0)[goodId(g)] as number), 0);
    keep.stock[goodId("bread")] = 40;
    // Days until the next festival phase.
    let held = -1;
    for (let d = 0; d < 30 && held < 0; d++) {
      // Keep the table full (nobody farms in this test).
      keep.stock[goodId("bread")] = 60;
      const before = food();
      nextDay(w);
      if ((eco.culture.festivalAt[0] ?? -1) >= 0) held = before - food();
    }
    expect(held).toBeGreaterThan(0);
    // A locked world has no seasons: its feast comes with the fixed sun.
    expect([...FESTIVALS.map((f) => f.name), "the Sun Feast"]).toContain(eco.culture.festivalName[0]);
    expect(eco.culture.joy(0)).toBeGreaterThan(0.5);
    expect(eco.culture.has(0, "festival")).toBe(true);
    // Glow counts joy, variety and wonder now.
    const parts = eco.glowParts[0]!;
    expect(parts.joy).toBeGreaterThan(0.7);
    expect(parts.wonder).toBeGreaterThan(0.4);
    expect(parts.variety).toBeGreaterThan(0);
  });
});
