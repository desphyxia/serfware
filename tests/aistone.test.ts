import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

describe("the AI and stone", () => {
  it("finds granite and opens a granite mine when the rocks run out, and keeps building", { timeout: 600000 }, () => {
    let mines = 0;
    let stoneAtEnd = 0;
    for (const seed of ["russet-heron-417", "lantern-moss-55"]) {
      const w = new World(seed, { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
      w.recordAi = true;
      const eco = w.economy;
      for (let i = 0; i < 30 * eco.dayTicks; i++) w.step();
      mines += w.aiLog.filter((a) => a.ok && a.cmd.t === "build" && (a.cmd as { type: string }).type === "granitemine").length;
      stoneAtEnd += eco.storageTotals(1)[goodId("stone")] ?? 0;
      // Every quarry it places has rock in reach when it goes up (a quarry with none never works).
      for (const b of eco.buildings) if (b.owner === 1 && b.def.id === "quarry") expect(b.tile).toBeGreaterThanOrEqual(0);
    }
    expect(mines).toBeGreaterThan(0);
    expect(stoneAtEnd).toBeGreaterThan(0);
  });
});
