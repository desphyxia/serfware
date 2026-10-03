import { describe, expect, it } from "vitest";
import { Region } from "../src/sim/biomes/regions";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

/** Builds the AI on seat 1 gave, by type, after `days` on a world whose land is all one region. */
function built(region: Region, days: number): Record<string, number> {
  const w = new World("russet-heron-417", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
  w.recordAi = true;
  const eco = w.economy;
  // The land is taken to be one region throughout (the AI looks at its own territory).
  w.land.region.fill(region);
  const keep = eco.buildings[eco.keeps[1]!]!;
  for (let i = 0; i < days * eco.dayTicks; i++) {
    if (i % eco.dayTicks === 0) for (const g of ["stone", "plank", "log", "iron"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 30);
    w.step();
  }
  const out: Record<string, number> = {};
  for (const a of w.aiLog) if (a.ok && a.cmd.t === "build") out[(a.cmd as { type: string }).type] = (out[(a.cmd as { type: string }).type] ?? 0) + 1;
  return out;
}

describe("the AI and the land it holds", () => {
  it("builds what a region calls for", { timeout: 900000 }, () => {
    const cold = built(Region.RimefallTundra, 25);
    expect(cold.waystation ?? 0, JSON.stringify(cold)).toBeGreaterThan(0);
    const mire = built(Region.LumenMire, 25);
    expect(mire.glowcapfarm ?? 0, JSON.stringify(mire)).toBeGreaterThan(0);
    const salt = built(Region.SaltglassFlats, 25);
    expect(salt.saltworks ?? 0, JSON.stringify(salt)).toBeGreaterThan(0);
  });

  it("builds a lighthouse on a shore once it has a boatyard", { timeout: 900000 }, () => {
    const t = built(Region.None, 45);
    expect(t.boatyard ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
    expect(t.lighthouse ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
  });
});
