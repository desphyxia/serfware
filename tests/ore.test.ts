import { describe, expect, it } from "vitest";
import { Deposit } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808", "ember-sky-31", "chain-geo", "smoke-test-1", "ore-a", "ore-b", "ore-c", "ore-d"];

describe("ore for every start", () => {
  it("coal, iron and granite within 10 steps of each Hearthship and gold within 14, wherever there are hills", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      for (const opts of [{ size: "small" as const }, { size: "tiny" as const, rivals: 3 }]) {
        const w = new World(seed, opts);
        const land = w.land;
        for (let p = 0; p < w.players; p++) {
          const keep = w.economy.buildings[w.economy.keeps[p]!]!;
          const far = new Set(land.ring(keep.tile, 3));
          for (const [kind, reach] of [[Deposit.Coal, 10], [Deposit.Iron, 10], [Deposit.Granite, 10], [Deposit.Gold, 14]] as const) {
            const within = land.ring(keep.tile, reach);
            checked++;
            if (within.some((t) => land.deposit[t] === kind)) continue;
            // A kind can only be missing where there is no free hill left to put it on.
            expect(within.filter((t) => !far.has(t) && land.isMountain(t) && land.isLand(t) && land.deposit[t] === Deposit.None && land.use[t] === 0)).toEqual([]);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 240000);

  it("most starts get all four kinds", () => {
    let full = 0;
    let all = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const keep = w.economy.buildings[w.economy.keep]!;
      const kinds = new Set(w.land.ring(keep.tile, 14).map((t) => w.land.deposit[t]));
      all++;
      if ([Deposit.Coal, Deposit.Iron, Deposit.Gold, Deposit.Granite].every((k) => kinds.has(k))) full++;
    }
    expect(full).toBeGreaterThanOrEqual(all - 2);
  });
});
