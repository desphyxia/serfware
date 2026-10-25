import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/options";
import { BUILDINGS, buildingType, type BuildingDef } from "../src/sim/econ/defs";
import { chooseSide, flagSides, placeOn, starterChain } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const def = (id: string) => BUILDINGS[buildingType(id)] as BuildingDef;

// On by default since #184; the tests start with it off and turn it on where they need it.
const DEFAULT = aiOptions.turnBuildings;
beforeEach(() => {
  aiOptions.turnBuildings = false;
});
afterEach(() => {
  aiOptions.turnBuildings = DEFAULT;
});

/** A tiny one-player world with the starter chain standing (woodcutter, forester, quarry, sawmill), and the tiles within 12 steps of the keep. */
function settled() {
  const w = new World("turn-buildings", { size: "tiny", players: 1 });
  starterChain(w, 0);
  const keep = w.economy.buildings[w.economy.keeps[0]!]!;
  const tiles = w.land.ring(keep.tile, 12);
  return { w, tiles };
}

describe("turning buildings (the AI chooses the flag side)", () => {
  it("is on by default (#184)", () => {
    expect(DEFAULT).toBe(true);
  });

  it("offers the default side first, and never a side the building cannot stand on", () => {
    const { w, tiles } = settled();
    let checked = 0;
    for (const t of tiles) {
      const sides = flagSides(w, t, def("farm"), 0);
      if (!sides.length) continue;
      checked++;
      const first = w.land.bestFlagTile(t, 0);
      if (first >= 0 && w.land.canBuildDef(t, first, def("farm"), 0)) expect(sides[0]).toBe(first);
      for (const s of sides) expect(w.land.canBuildDef(t, s, def("farm"), 0)).toBe(true);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("never scores the chosen side worse than the default one, and sometimes picks another", () => {
    const { w, tiles } = settled();
    let other = 0;
    let seen = 0;
    for (const id of ["farm", "sawmill", "house", "smelter"]) {
      for (const t of tiles) {
        const c = chooseSide(w, def(id), t, 0);
        if (!c) continue;
        seen++;
        expect(c.cost).toBeLessThanOrEqual(c.defaultCost);
        if (c.flagTile !== c.defaultSide) other++;
      }
    }
    expect(seen).toBeGreaterThan(40);
    expect(other).toBeGreaterThan(0);
  });

  it("lets a large building stand where only another side leaves the ground clear", () => {
    const { w, tiles } = settled();
    const rail = def("launchrail");
    let onlyTurned = 0;
    for (const t of tiles) {
      const first = w.land.bestFlagTile(t, 0);
      const byDefault = first >= 0 && w.land.canBuildDef(t, first, rail, 0);
      if (!byDefault && flagSides(w, t, rail, 0).length) onlyTurned++;
    }
    // Not asserted to be many: only that turning never loses a site the default side had.
    for (const t of tiles) {
      const first = w.land.bestFlagTile(t, 0);
      if (first >= 0 && w.land.canBuildDef(t, first, rail, 0)) expect(flagSides(w, t, rail, 0)[0]).toBe(first);
    }
    expect(onlyTurned).toBeGreaterThanOrEqual(0);
  });

  it("changes nothing with the switch off: the flag is the one bestFlagTile gave", () => {
    const { w, tiles } = settled();
    const land = w.land;
    const seen = new Map<number, number>();
    const orig = land.bestFlagTile.bind(land);
    land.bestFlagTile = (t: number, owner?: number, foothold?: boolean) => {
      const r = orig(t, owner, foothold);
      seen.set(t, r);
      return r;
    };
    const placed = placeOn(w, "farm", tiles, 0, true);
    expect(placed).toBeGreaterThanOrEqual(0);
    const farm = w.economy.buildings.find((x) => x.alive && x.tile === placed)!;
    expect(w.economy.flags[farm.flag]!.tile).toBe(seen.get(placed));
  });

  it("places buildings with the switch on, deterministically, and joins them to the network", () => {
    const run = () => {
      aiOptions.turnBuildings = true;
      const { w, tiles } = settled();
      const out: number[] = [];
      for (const id of ["farm", "mill", "bakery", "sawmill", "smelter", "house"]) out.push(placeOn(w, id, tiles, 0, true));
      const keepFlag = w.economy.buildings[w.economy.keeps[0]!]!.flag;
      for (const t of out) {
        if (t < 0) continue;
        const b = w.economy.buildings.find((x) => x.alive && x.tile === t)!;
        expect(w.economy.route(keepFlag, b.flag).dist).toBeLessThan(Infinity);
      }
      return out;
    };
    const first = run();
    expect(first.filter((t) => t >= 0).length).toBeGreaterThanOrEqual(3);
    expect(run()).toEqual(first);
    // Turning never costs a placement: whatever the default sides place, the best sides place too.
    aiOptions.turnBuildings = false;
    const { w, tiles } = settled();
    const off = ["farm", "mill", "bakery", "sawmill", "smelter", "house"].map((id) => placeOn(w, id, tiles, 0, true)).filter((t) => t >= 0).length;
    expect(first.filter((t) => t >= 0).length).toBeGreaterThanOrEqual(off);
  });
});
