import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

describe("nearestTile", () => {
  it("lands within a tile's width of the target from any hint, even a far-side one", () => {
    const grid = new World("quiet-cairn-171", { size: "medium" }).planet.grid;
    for (let t = 0; t < grid.count; t += 97) {
      const d = grid.centerOf(t);
      for (const hint of [0, 5000, grid.count - 1]) {
        const got = grid.nearestTile(d, hint);
        const c = grid.centerOf(got);
        expect(d[0] * c[0] + d[1] * c[1] + d[2] * c[2]).toBeGreaterThan(Math.cos(Math.sqrt((4 * Math.PI) / grid.count)));
      }
    }
  });
});
