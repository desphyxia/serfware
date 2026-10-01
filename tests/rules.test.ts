import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { invariants } from "../soak/invariants";

/** A short taste of the soak run (npm run soak): an all-AI game, checked every few hours. */
describe("rules that always hold", () => {
  it("an all-AI game of two against two keeps every rule (no goods left on flags after a road changes under a carrier)", () => {
    const w = new World("amber-fern-212", { size: "small", rivals: 3, teams: [0, 0, 1, 1], personalities: ["trader", "warden", "warden"], peaceDays: 2 });
    w.command({ t: "steward", of: 0, on: true });
    for (let i = 0; i < 14000; i++) {
      w.step();
      if (i % 200 === 0) expect(invariants(w), `tick ${w.tick}`).toEqual([]);
    }
  }, 60000);
});
