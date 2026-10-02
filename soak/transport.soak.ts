import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

/**
 * Transport: how well goods move. A settlement played by a steward (the AI) grows for some days
 * in peace; twice an hour we look at the flags. Run with `npm run soak -- transport`;
 * SOAK_DAYS (default 12) and SOAK_SEEDS as for the world soak. Writes soak-transport.json.
 */
const DAYS = Number(process.env.SOAK_DAYS ?? 12);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212,glade-iris-904").split(",");

describe("transport soak", () => {
  it("measures goods waiting on flags, full flags, deliveries and growth", () => {
    const rows: Record<string, number | string>[] = [];
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small", peaceDays: DAYS + 1 });
      w.command({ t: "steward", of: 0, on: true });
      const eco = w.economy;
      // Count goods handed to a building that uses them (construction and production, not storage).
      let delivered = 0;
      const hooked = eco as unknown as { receive: (b: unknown, t: number) => void };
      const receive = hooked.receive.bind(eco);
      hooked.receive = (b, t) => {
        if (!(b as { def: { storage?: boolean } }).def.storage) delivered++;
        receive(b, t);
      };
      // How long each good has lain on a flag (ticks), sampled.
      const firstSeen = new Map<number, number>();
      let samples = 0;
      let waiting = 0;
      let full = 0;
      let stale = 0;
      let carriers = 0;
      const end = w.tick + DAYS * eco.dayTicks;
      const every = Math.round(eco.dayTicks / 48);
      while (w.tick < end) {
        w.step();
        if (w.tick % every) continue;
        samples++;
        const now = new Set<number>();
        for (const f of eco.flags) {
          if (!f.alive || f.owner !== 0) continue;
          waiting += f.goods.length;
          if (f.goods.length >= 8) full++;
          for (const g of f.goods) {
            now.add(g);
            if (!firstSeen.has(g)) firstSeen.set(g, w.tick);
            else if (w.tick - (firstSeen.get(g) as number) > eco.dayTicks / 2) stale++;
          }
        }
        for (const g of [...firstSeen.keys()]) if (!now.has(g)) firstSeen.delete(g);
        carriers += eco.settlers.filter((s) => s.alive && s.owner === 0 && s.role === "carrier").length;
      }
      const mine = eco.buildings.filter((b) => b.alive && b.owner === 0);
      rows.push({
        seed,
        days: DAYS,
        buildings: mine.filter((b) => b.built).length,
        sites: mine.filter((b) => !b.built).length,
        delivered,
        avgWaiting: +(waiting / samples).toFixed(1),
        fullFlagSamples: full,
        staleGoodSamples: stale,
        avgCarriers: +(carriers / samples).toFixed(1),
        people: eco.people.filter((p) => p.alive && p.owner === 0).length,
      });
    }
    console.table(rows);
    writeFileSync(process.env.SOAK_OUT ?? "soak-transport.json", JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(SEEDS.length);
  });
});
