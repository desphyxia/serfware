import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

describe("an AI boxed in by forest", () => {
  it("clears its way out and keeps building (issue #84)", () => {
    const w = new World("russet-heron-417", { size: "tiny", rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", peaceDays: 99 });
    w.command({ t: "steward", of: 0, on: true });
    const eco = w.economy;
    const end = w.tick + 12 * eco.dayTicks;
    while (w.tick < end) w.step();
    // This rival used to stop at 10 buildings from day 5.
    expect(eco.buildings.filter((b) => b.alive && b.built && b.owner === 2).length).toBeGreaterThan(14);
  }, 300000);
});
