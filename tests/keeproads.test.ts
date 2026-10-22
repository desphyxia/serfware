import { afterEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/builder";
import { connectKeepFlag } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

afterEach(() => {
  aiOptions.keepRoads = false;
});

const SEED = "quiet-cairn-171";
const keepRoads = (w: World, p: number): number => {
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[p] as number];
  return keep ? (eco.flags[keep.flag]?.roads.length ?? 0) : 0;
};

describe("a keep flag with few roads (keepRoads, #169)", () => {
  it("is off by default", () => {
    expect(aiOptions.keepRoads).toBe(false);
  });

  it("connectKeepFlag adds one road to a flag it does not join yet, and none once the wanted number is there", () => {
    const w = new World(SEED, { rivals: 1, latticeRoads: true });
    for (let i = 0; i < 800; i++) w.step();
    const before = keepRoads(w, 1);
    const roads = w.economy.roads.filter((r) => r.alive).length;
    expect(connectKeepFlag(w, 1, before, 12)).toBe(false);
    expect(connectKeepFlag(w, 1, before + 1, 12)).toBe(true);
    expect(keepRoads(w, 1)).toBe(before + 1);
    expect(w.economy.roads.filter((r) => r.alive).length).toBe(roads + 1);
    expect(connectKeepFlag(w, 1, before + 1, 12)).toBe(false);
  }, 120000);

  it("a seat with the switch on ends with 3 roads at its keep flag, on the lattice and off it", () => {
    aiOptions.keepRoads = true;
    for (const latticeRoads of [true, false]) {
      const w = new World(SEED, { rivals: 1, latticeRoads });
      for (let i = 0; i < 6000; i++) w.step();
      expect(keepRoads(w, 1), latticeRoads ? "lattice" : "tile centres").toBeGreaterThanOrEqual(3);
    }
  }, 240000);
});
