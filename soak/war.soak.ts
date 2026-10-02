import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Personality } from "../src/sim/ai/personality";
import { World } from "../src/sim/world";

/**
 * Wars: do they end? Four AI settlements (Wardens, with a steward in the human seat) fight on
 * small worlds. For each seed: how many lanterns changed hands, how many wardens fell or were
 * wounded, and whether anyone won within the time. Run with `npm run soak -- war`; SOAK_DAYS
 * (default 40) and SOAK_SEEDS as for the world soak. Writes soak-war.json.
 */
const DAYS = Number(process.env.SOAK_DAYS ?? 40);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212,glade-iris-904,lantern-moss-55,tidal-oak-808,ember-sky-31").split(",");
const WARDENS: Personality[] = ["warden", "warden", "warden"];

describe("war soak", () => {
  it("measures captures, defeats and whether the war ends", () => {
    const rows: Record<string, number | string>[] = [];
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "tiny", rivals: 3, personalities: WARDENS, aiLevel: "normal", peaceDays: 2 });
      w.command({ t: "steward", of: 0, on: true });
      const eco = w.economy;
      let captures = 0;
      const hooked = eco as unknown as { capture: (b: unknown, owner: number) => void };
      const capture = hooked.capture.bind(eco);
      hooked.capture = (b, owner) => {
        captures++;
        capture(b, owner);
      };
      let endDay = -1;
      for (let d = 0; d < DAYS; d++) {
        const end = w.tick + eco.dayTicks;
        while (w.tick < end) w.step();
        if (eco.winner >= 0) {
          endDay = d + 1;
          break;
        }
      }
      rows.push({
        seed,
        captures,
        fallen: eco.defeated.filter(Boolean).length,
        winner: eco.winner,
        endDay,
        lanterns: eco.buildings.filter((b) => b.alive && b.built && b.def.light).length,
      });
    }
    console.table(rows);
    writeFileSync(process.env.SOAK_OUT ?? "soak-war.json", JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(SEEDS.length);
  });
});
