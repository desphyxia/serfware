import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

describe("the AI and the forest", () => {
  it("does not keep taking its foresters down when it is boxed in", { timeout: 600000 }, () => {
    const w = new World("glade-9", { size: "small", rivals: 1, personalities: ["trader"], peaceDays: 99 });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[1]!]!;
    let taken = 0;
    const hooked = eco as unknown as { removeBuilding: (b: { owner: number; def: { id: string } }) => void };
    const orig = hooked.removeBuilding.bind(eco);
    hooked.removeBuilding = (b) => {
      if (b.owner === 1 && b.def.id === "forester") taken++;
      orig(b);
    };
    for (let i = 0; i < 40 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["stone", "log"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 20);
      w.step();
    }
    // Before the fix this seed took down more than twenty.
    expect(taken).toBeLessThanOrEqual(3);
    expect(eco.buildings.some((b) => b.alive && b.owner === 1 && b.def.id === "forester")).toBe(true);
  });
});
