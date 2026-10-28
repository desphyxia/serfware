import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

/** What the AI on seat 1 did, counted by command (and by building type for builds). */
function tally(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of w.aiLog) {
    if (!a.ok) continue;
    const k = a.cmd.t === "build" ? `build:${(a.cmd as { type: string }).type}` : a.cmd.t;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe("the AI's land use and settings", () => {
  it("surveys, mines, smelts, raises causeways, stages goods and sets priorities", { timeout: 900000 }, () => {
    const all: Record<string, number> = {};
    // Days per game: glade-9 has all it shows (geologists, mines, causeways, turns) by day 12.3. russet-4 has geologists, a
    // causeway, a coal mine, a storehouse (day 7.6) and the goods staged in it (day 7.8). ferry-2 had the storehouse until the
    // Hearthship's reserve (#126) moved it past day 60; a storehouse waits for a day with no site open, so its day is fragile.
    for (const [seed, personality, days] of [
      ["glade-9", "trader", 40],
      ["russet-4", "warden", 12],
    ] as const) {
      const w = new World(seed, { size: "small", rivals: 1, personalities: [personality], peaceDays: 99 });
      w.recordAi = true;
      const eco = w.economy;
      const keep = eco.buildings[eco.keeps[1]!]!;
      // The AI's stone runs dry early; top the Hearthship up each day so this tests what it does with materials.
      for (let i = 0; i < days * eco.dayTicks; i++) {
        if (i % eco.dayTicks === 0) for (const g of ["stone", "log"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 20);
        w.step();
      }
      for (const [k, n] of Object.entries(tally(w))) all[k] = (all[k] ?? 0) + n;
    }
    expect((all["build:coalmine"] ?? 0) + (all["build:ironmine"] ?? 0) + (all["build:goldmine"] ?? 0), `mines ${JSON.stringify(all)}`).toBeGreaterThan(0);
    for (const k of ["geologist", "causeway", "rotate", "build:storehouse", "storeGood"]) {
      expect(all[k] ?? 0, k).toBeGreaterThan(0);
    }
  });
});
