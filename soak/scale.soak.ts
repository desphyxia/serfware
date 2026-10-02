import { appendFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { World } from "../src/sim/world";

/**
 * How far does the simulation scale? A huge world with eight AI settlements grows for SOAK_DAYS
 * (default 40); each day we record settlers, buildings and the wall-clock cost of a tick.
 * Run with `npm run soak -- scale`; writes soak-scale.json.
 */
const DAYS = Number(process.env.SOAK_DAYS ?? 40);
const SIZE = (process.env.SOAK_SIZE ?? "huge") as "large" | "huge";

describe("scale soak", () => {
  it("measures settlers and tick cost", () => {
    const w = new World("scale-test-1", { size: SIZE, rivals: 7, aiLevel: "normal", peaceDays: 99 });
    w.command({ t: "steward", of: 0, on: true });
    const eco = w.economy;
    const rows: Record<string, number>[] = [];
    for (let d = 1; d <= DAYS; d++) {
      const t0 = performance.now();
      const stop = w.tick + eco.dayTicks;
      let n = 0;
      while (w.tick < stop) {
        w.step();
        n++;
      }
      const ms = performance.now() - t0;
      const people = eco.people.filter((p) => p.alive).length;
      const settlers = eco.settlers.filter((x) => x.alive).length;
      const row = { day: d, people, settlers, buildings: eco.buildings.filter((b) => b.alive).length, msPerTick: Math.round((ms / n) * 1000) / 1000, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) };
      rows.push(row);
      appendFileSync("soak-scale.log", JSON.stringify(row) + "\n");
    }
    writeFileSync("soak-scale.json", JSON.stringify(rows, null, 1));
  }, 7_200_000);
});
