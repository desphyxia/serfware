import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import type { Personality } from "../src/sim/ai/personality";
import { World } from "../src/sim/world";

/**
 * How well do the AI rivals play? Three rivals (a Builder, a Trader and a Warden) grow on tiny
 * worlds for SOAK_DAYS (default 20); we record what each has built, how many people it has and
 * how content they are. A second run puts three Wardens against each other and records captures
 * and whether anyone wins. Run with `npm run soak -- ai`; writes soak-ai.json.
 */
const DAYS = Number(process.env.SOAK_DAYS ?? 20);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212,glade-iris-904,lantern-moss-55,tidal-oak-808,ember-sky-31").split(",");
const MIX: Personality[] = ["builder", "trader", "warden"];
const WARDENS: Personality[] = ["warden", "warden", "warden"];

describe("ai soak", () => {
  it("measures growth and war", () => {
    const rows: Record<string, unknown>[] = [];
    for (const seed of SEEDS) {
      // Growth.
      const g = new World(seed, { size: "tiny", rivals: 3, personalities: MIX, aiLevel: "normal", peaceDays: 99 });
      g.command({ t: "steward", of: 0, on: true });
      const eco = g.economy;
      const end = g.tick + DAYS * eco.dayTicks;
      while (g.tick < end) g.step();
      const grown = [1, 2, 3].map((p) => ({
        built: eco.buildings.filter((b) => b.alive && b.built && b.owner === p).length,
        people: eco.people.filter((x) => x.alive && x.owner === p).length,
        glow: Math.round(eco.glow[p] ?? 0),
      }));
      // War.
      const w = new World(seed, { size: "tiny", rivals: 3, personalities: WARDENS, aiLevel: "normal", peaceDays: 2 });
      w.command({ t: "steward", of: 0, on: true });
      const we = w.economy;
      let captures = 0;
      const hooked = we as unknown as { capture: (b: unknown, owner: number) => void };
      const capture = hooked.capture.bind(we);
      hooked.capture = (b, owner) => {
        captures++;
        capture(b, owner);
      };
      let endDay = -1;
      for (let d = 0; d < DAYS + 10 && endDay < 0; d++) {
        const stop = w.tick + we.dayTicks;
        while (w.tick < stop) w.step();
        if (we.winner >= 0) endDay = d + 1;
      }
      const row = { seed, built: grown.reduce((a, x) => a + x.built, 0), people: grown.reduce((a, x) => a + x.people, 0), glow: grown.reduce((a, x) => a + x.glow, 0), grown, captures, winner: we.winner, endDay };
      console.log(JSON.stringify(row));
      rows.push(row);
    }
    writeFileSync("soak-ai.json", JSON.stringify(rows, null, 1));
  }, 3_600_000);
});
