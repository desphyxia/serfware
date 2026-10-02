import { describe, expect, it } from "vitest";
import { widestCrossing } from "../src/sim/planet/reach";
import { World } from "../src/sim/world";

const SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55"];

describe("map option: seas", () => {
  it("is off by default and leaves the world unchanged", () => {
    const a = new World("amber-fern-212", { size: "small" });
    const b = new World("amber-fern-212", { size: "small", map: { ore: { coal: 25, iron: 25, gold: 25, granite: 25 } } });
    expect(Array.from(a.planet.terrain.elevation)).toEqual(Array.from(b.planet.terrain.elevation));
  });

  it("close seas leave no crossing wider than a quay's ferry can span; mixed seas, a harbour's", () => {
    for (const [seas, limit] of [["close", 8], ["mixed", 14]] as const) {
      for (const seed of SEEDS) {
        for (const size of ["medium", "large"] as const) {
          const w = new World(seed, { size, map: { seas } });
          expect(widestCrossing(w.planet.grid, w.planet.terrain.elevation), `${seed} ${size} ${seas}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  }, 300000);

  it("changes the same seed's world only by adding shoals", () => {
    const a = new World("russet-heron-417", { size: "large" });
    const b = new World("russet-heron-417", { size: "large", map: { seas: "close" } });
    const ea = a.planet.terrain.elevation;
    const eb = b.planet.terrain.elevation;
    let raised = 0;
    for (let t = 0; t < ea.length; t++) {
      if (ea[t] !== eb[t]) {
        raised++;
        expect(ea[t]).toBeLessThan(0);
        expect(eb[t]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(raised).toBeGreaterThan(0);
    expect(widestCrossing(b.planet.grid, eb)).toBeLessThan(widestCrossing(a.planet.grid, ea));
  }, 300000);
});
