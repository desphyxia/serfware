import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

/** Tiles reachable over land from a tile. */
function landFrom(w: World, start: number): Set<number> {
  const grid = w.planet.grid;
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const t = stack.pop() as number;
    for (const n of grid.neighborsOf(t)) {
      if (seen.has(n) || !w.land.isLand(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen;
}

describe("the AI and the sea", () => {
  it("charts the sea, ferries to a free island and lights it", { timeout: 600000 }, () => {
    let landed = 0;
    const notes: string[] = [];
    for (const seed of ["russet-heron-417", "ferry-2"]) {
      const w = new World(seed, { size: "small", rivals: 1, personalities: ["trader"], peaceDays: 99 });
      w.recordAi = true;
      const eco = w.economy;
      // Stone is what the AI's economy lacks most: give it some so the test is about the sea.
      (eco.buildings[eco.keeps[1]!]!.stock as number[])[goodId("stone")] = 60;
      for (let i = 0; i < 45 * eco.dayTicks; i++) w.step();
      const ok = (type: string) => w.aiLog.filter((a) => a.ok && a.cmd.t === "build" && (a.cmd as { type: string }).type === type).length;
      const keep = eco.buildings[eco.keeps[1]!]!;
      const home = landFrom(w, keep.tile);
      const island = eco.buildings.filter((b) => b.alive && b.built && b.owner === 1 && !home.has(b.tile));
      notes.push(`${seed}: yard ${ok("boatyard")} quay ${ok("quay")} explore ${w.aiLog.filter((a) => a.ok && a.cmd.t === "explore").length} island ${island.length} ferries ${eco.roads.filter((r) => r.alive && r.ferry).length}`);
      if (ok("boatyard") === 0) continue;
      if (island.length && eco.roads.some((r) => r.alive && r.ferry)) landed++;
      if (island.some((b) => b.def.slots && b.lit)) landed += 10;
    }
    expect(landed, notes.join(" | ")).toBeGreaterThanOrEqual(10);
  });
});
