import { describe, expect, it } from "vitest";
import { AiContext } from "../src/sim/ai/brain";
import { BiomePlanner } from "../src/sim/ai/biome";
import { Region } from "../src/sim/biomes/regions";
import { goodId } from "../src/sim/econ/defs";
import { Feature, Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

/** Builds the AI on seat 1 gave after `days`, on a world whose land is all `region`, with `prepare` run first. */
function run(region: Region, days: number, prepare?: (w: World) => void): Record<string, number> {
  const w = new World("russet-heron-417", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
  w.recordAi = true;
  const eco = w.economy;
  w.land.region.fill(region);
  prepare?.(w);
  const keep = eco.buildings[eco.keeps[1]!]!;
  for (let i = 0; i < days * eco.dayTicks; i++) {
    if (i % eco.dayTicks === 0) for (const g of ["stone", "plank", "log", "iron"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 30);
    w.step();
  }
  const out: Record<string, number> = {};
  for (const a of w.aiLog) if (a.ok && a.cmd.t === "build") out[(a.cmd as { type: string }).type] = (out[(a.cmd as { type: string }).type] ?? 0) + 1;
  return out;
}

/** Put `feature` on every nth free tile of seat 1's land, near its Hearthship. */
function sprinkle(w: World, feature: Feature, every: number): void {
  const land = w.land;
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[1]!]!;
  let n = 0;
  for (const t of land.ring(keep.tile, 12)) {
    if (land.territory[t] !== 2 || !land.isLand(t) || land.use[t] !== Use.Free || land.planet.grid.degree(t) === 5) continue;
    if (n++ % every === 0) {
      land.feature[t] = feature;
      land.amount[t] = 0;
      land.variety[t] = 0;
    }
  }
}

describe("the AI in the regions with special ground", () => {
  it("builds tree houses in the Canopy Deeps, on ancient giants", { timeout: 900000 }, () => {
    const t = run(Region.CanopyDeeps, 35, (w) => sprinkle(w, Feature.Giant, 5));
    expect(t.treehouse ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
  });

  it("builds a greenhouse on a vent in the Emberglass Steppe once there are farms", { timeout: 900000 }, () => {
    const t = run(Region.EmberglassSteppe, 35, (w) => sprinkle(w, Feature.Vent, 7));
    expect(t.greenhouse ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
  });

  it("builds a tide mill and shellfishers in the Tidewater Reach", { timeout: 900000 }, () => {
    const t = run(Region.TidewaterReach, 35);
    expect(t.shellfisher ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
    expect(t.tidemill ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
  });

  it("builds ropeways on the Skyreef", { timeout: 900000 }, () => {
    const t = run(Region.Skyreef, 35);
    expect(t.ropeway ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
  });

  it("builds saltworks on the Saltglass Flats, and a solar kiln and dew condensers once the planner is asked again", { timeout: 900000 }, () => {
    const t = run(Region.SaltglassFlats, 30);
    expect(t.saltworks ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
    // The scripted seat is usually out of free hands by then and does not reach the planner; ask it directly.
    const w = new World("russet-heron-417", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
    const eco = w.economy;
    w.land.region.fill(Region.SaltglassFlats);
    const keep = eco.buildings[eco.keeps[1]!]!;
    for (let i = 0; i < 25 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["stone", "plank", "log", "iron"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 30);
      w.step();
    }
    const planner = new BiomePlanner(1);
    const ctx = new AiContext(w, 1);
    const has = (id: string) => eco.buildings.some((b) => b.alive && b.owner === 1 && b.def.id === id);
    for (let i = 0; i < 60 && !(has("solarkiln") && has("dewcondenser")); i++) {
      planner.step(ctx, 10_000 + i * 40);
      // Let a site rise before asking again.
      for (let k = 0; k < 600; k++) w.step();
      for (const g of ["stone", "plank", "log"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 30);
    }
    expect(has("solarkiln"), "a solar kiln").toBe(true);
    expect(has("dewcondenser"), "a dew condenser").toBe(true);
  });
});
