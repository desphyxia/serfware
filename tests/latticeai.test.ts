import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

describe("rivals and hamlets on the road lattice", () => {
  it("a rival settles, feeds itself and keeps its carriers in check", () => {
    const w = new World("quiet-cairn-171", { rivals: 1, latticeRoads: true });
    expect(w.rivals).toBe(1);
    for (let i = 0; i < 9000; i++) w.step();
    const eco = w.economy;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === 1);
    const kinds = new Set(mine.map((b) => b.def.id));
    expect(mine.filter((b) => b.built).length).toBeGreaterThanOrEqual(14);
    expect(kinds.has("farm") || kinds.has("fisher")).toBe(true);
    // Flags every few nodes, not every node: roads stay within about 1.5 per building.
    const roads = eco.roads.filter((r) => r.owner === 1).length;
    expect(roads).toBeLessThanOrEqual(mine.length * 1.5 + 5);
  }, 120000);
});
