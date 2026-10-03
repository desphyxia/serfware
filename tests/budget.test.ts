import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

/**
 * Performance budgets for the simulation: a tiny world with three AI rivals must not cost much more
 * per tick than it does today. The limits are several times today's cost on a developer machine so a
 * slow CI runner does not trip them; a real regression (an accidental O(n²)) will.
 */
describe("simulation budget", () => {
  it("keeps the cost of a tick down in a busy tiny world", () => {
    const w = new World("budget-1", { size: "tiny", rivals: 3, peaceDays: 99 });
    w.command({ t: "steward", of: 0, on: true });
    const eco = w.economy;
    // Warm up through the first days, when everything is being built.
    const warm = w.tick + 3 * eco.dayTicks;
    while (w.tick < warm) w.step();
    const t0 = performance.now();
    const n = 2 * eco.dayTicks;
    for (let i = 0; i < n; i++) w.step();
    const msPerTick = (performance.now() - t0) / n;
    // Ticks come ten a second: even ×64 needs the cost under 100 / 64 ms.
    expect(msPerTick, `${msPerTick.toFixed(2)} ms per tick`).toBeLessThan(1.5);
    expect(eco.settlers.filter((s) => s.alive).length).toBeGreaterThan(20);
  }, 300000);

  it("builds a huge world in reasonable time", () => {
    const t0 = performance.now();
    const w = new World("budget-2", { size: "huge" });
    const ms = performance.now() - t0;
    expect(w.planet.grid.count).toBeGreaterThan(40000);
    expect(ms, `${Math.round(ms)} ms`).toBeLessThan(10000);
  }, 120000);
});
