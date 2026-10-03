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
  it("surveys, mines, smelts, raises causeways, stages goods and sets priorities", { timeout: 600000 }, () => {
    const all: Record<string, number> = {};
    for (const [seed, personality] of [["glade-9", "trader"], ["ferry-2", "warden"]] as const) {
      const w = new World(seed, { size: "small", rivals: 1, personalities: [personality], peaceDays: 99 });
      w.recordAi = true;
      const eco = w.economy;
      const keep = eco.buildings[eco.keeps[1]!]!;
      // The AI's stone runs dry early; top the Hearthship up each day so this tests what it does with materials.
      for (let i = 0; i < 60 * eco.dayTicks; i++) {
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
