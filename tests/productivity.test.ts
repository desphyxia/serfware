import { describe, expect, it } from "vitest";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

describe("productivity (Settlers 2's working share)", () => {
  it("workers and carriers report the share of the day they spent at work", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const eco = w.economy;
    expect(placeConnected(w, "woodcutter", { minDist: 4, maxDist: 8 })).toBe(true);
    const cutter = eco.buildings.find((b) => b.alive && b.def.id === "woodcutter")!;
    // Not built yet: no figure.
    expect(eco.productivity(cutter)).toBeNull();
    for (let i = 0; i < 20000 && !cutter.built; i++) w.step();
    expect(cutter.built).toBe(true);
    // Over the next days, the share is a percentage and the worker does work on at least one of them
    // (a woodcutter that has felled what is near rests, which shows as a falling share).
    let best = 0;
    let bestRoad = 0;
    for (let i = 0; i < 3 * eco.dayTicks; i++) {
      w.step();
      if (w.tick % eco.dayTicks === 1) {
        const work = eco.productivity(cutter);
        expect(work).not.toBeNull();
        expect(work!).toBeLessThanOrEqual(100);
        best = Math.max(best, work!);
        for (const r of eco.roads) if (r.alive) bestRoad = Math.max(bestRoad, eco.roadProductivity(r) ?? 0);
      }
    }
    expect(best).toBeGreaterThan(0);
    expect(bestRoad).toBeGreaterThan(0);
    // A road that has carried goods shows a share too; it can't exceed the whole day.
    const roads = eco.roads.filter((r) => r.alive && r.carrier >= 0);
    expect(roads.length).toBeGreaterThan(0);
    const shares = roads.map((r) => eco.roadProductivity(r));
    expect(shares.every((x) => x === null || (x >= 0 && x <= 100))).toBe(true);
    // The Hearthship is not a workshop.
    expect(eco.productivity(eco.buildings[eco.keep]!)).toBeNull();
  }, 240000);

  it("the counters are part of the state hash, so peers agree", () => {
    const a = new World("russet-heron-417", { size: "tiny" });
    const b = new World("russet-heron-417", { size: "tiny" });
    for (let i = 0; i < 3 * a.economy.dayTicks; i++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
  }, 120000);
});
