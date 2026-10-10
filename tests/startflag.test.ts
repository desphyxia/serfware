import { describe, expect, it } from "vitest";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

/** Every keep's flag stands on a tile of the land (what soak/invariants.ts checks of every flag). */
const flagsOnTheirTiles = (w: World): string[] => {
  const eco = w.economy;
  const land = w.land;
  const off: string[] = [];
  for (const k of eco.keeps) {
    const keep = eco.buildings[k];
    const flag = keep ? eco.flags[keep.flag] : undefined;
    if (!keep || !flag) continue;
    if (!flag.alive || flag.tile < 0 || land.use[flag.tile] !== Use.Flag || land.ref[flag.tile] !== flag.id) off.push(`player ${keep.owner}: keep on tile ${keep.tile}, flag ${flag.id} on tile ${flag.tile}`);
  }
  return off;
};

describe("start sites", () => {
  it("never put a keep where its flag has no tile (an islet in a lake)", () => {
    // tiny bal-004 with three rivals used to give the steward seat a keep ringed by lake tiles: its flag got tile -1.
    const w = new World("bal-004", { size: "tiny", rivals: 3, personalities: ["warden", "warden", "warden"], aiLevel: "easy", difficulty: "honest", peaceDays: 5 } as never);
    expect(flagsOnTheirTiles(w)).toEqual([]);
  });

  it("give every keep a flag on a tile, across sizes and seeds", () => {
    for (const size of ["tiny", "small"]) {
      for (const seed of ["bal-001", "bal-002", "bal-003", "bal-005"]) {
        const w = new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "honest", peaceDays: 5 } as never);
        expect(flagsOnTheirTiles(w), `${size} ${seed}`).toEqual([]);
      }
    }
  });
});
