import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/options";
import { placeConnected, starterChain } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

// On by default since #184; the tests start with it off and turn it on where they need it.
const DEFAULT = aiOptions.widePlacement;
beforeEach(() => {
  aiOptions.widePlacement = false;
});
afterEach(() => {
  aiOptions.widePlacement = DEFAULT;
});

function settled() {
  const w = new World("wide-placement", { size: "tiny", players: 1 });
  starterChain(w, 0);
  const keep = w.economy.buildings[w.economy.keeps[0]!]!;
  return { w, keep };
}

/** The tile of the newest building of a type, or -1. */
function lastOf(w: World, id: string): number {
  const all = w.economy.buildings.filter((b) => b.alive && b.def.id === id);
  return all.length ? all[all.length - 1]!.tile : -1;
}

describe("wide placement (the AI looks past a full ring)", () => {
  it("is on by default (#184)", () => {
    expect(DEFAULT).toBe(true);
  });

  it("places a building exactly where it was when the first ring has room", () => {
    const a = settled();
    expect(placeConnected(a.w, "farm", { minDist: 2, maxDist: 9, splitRoads: true })).toBe(true);
    const tileOff = lastOf(a.w, "farm");
    const b = settled();
    aiOptions.widePlacement = true;
    expect(placeConnected(b.w, "farm", { minDist: 2, maxDist: 9, splitRoads: true })).toBe(true);
    expect(lastOf(b.w, "farm")).toBe(tileOff);
  });

  it("goes on past a ring that holds no spot, only with the switch on", () => {
    const { w } = settled();
    // A centre in the wilds, outside the border: nothing can be built round it.
    let wild = -1;
    for (let t = 0; t < w.land.territory.length && wild < 0; t++) if (w.land.isLand(t) && w.land.territory[t] === 0 && w.land.ring(t, 9).every((n) => w.land.territory[n] !== 1)) wild = t;
    expect(wild).toBeGreaterThanOrEqual(0);
    expect(placeConnected(w, "farm", { minDist: 2, maxDist: 9, center: wild, splitRoads: true })).toBe(false);
    aiOptions.widePlacement = true;
    expect(placeConnected(w, "farm", { minDist: 2, maxDist: 9, center: wild, splitRoads: true })).toBe(true);
    const tile = lastOf(w, "farm");
    expect(w.land.territory[tile]).toBe(1);
  });
});
