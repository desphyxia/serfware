import { describe, expect, it } from "vitest";
import { creativeOf, creativeOptions } from "../src/net/session";
import { DEFAULT_ORE, Deposit, ORE_PRESETS } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55"];

const count = (w: World, d: Deposit) => {
  let n = 0;
  for (let t = 0; t < w.land.deposit.length; t++) if (w.land.deposit[t] === d) n++;
  return n;
};

/** Steps from the first Hearthship to the nearest mountain. */
function hillSteps(w: World): number {
  const keep = w.economy.buildings[w.economy.keep]!;
  for (let k = 1; k <= 40; k++) if (w.land.ring(keep.tile, k).some((t) => w.land.isLand(t) && w.land.isMountain(t))) return k;
  return 41;
}

describe("map options (Settlers 2's ore mix and hills)", () => {
  it("the default mix changes nothing", () => {
    const a = new World(SEEDS[0]!, { size: "small" });
    const b = new World(SEEDS[0]!, { size: "small", map: { ore: { ...DEFAULT_ORE } } });
    expect(Array.from(b.land.deposit)).toEqual(Array.from(a.land.deposit));
    expect(Array.from(b.land.depositAmount)).toEqual(Array.from(a.land.depositAmount));
  });

  it("an ore mix shifts what is under the hills, and zero leaves a kind out", () => {
    const seed = SEEDS[1]!;
    const base = new World(seed, { size: "small" });
    const rich = new World(seed, { size: "small", map: { ore: ORE_PRESETS.gold!.mix } });
    const poor = new World(seed, { size: "small", map: { ore: ORE_PRESETS.poor!.mix } });
    const stone = new World(seed, { size: "small", map: { ore: ORE_PRESETS.stone!.mix } });
    expect(count(rich, Deposit.Gold)).toBeGreaterThan(count(base, Deposit.Gold));
    expect(count(poor, Deposit.Gold)).toBeLessThan(count(base, Deposit.Gold));
    expect(count(stone, Deposit.Granite)).toBeGreaterThan(count(base, Deposit.Granite));
    const none = new World(seed, { size: "small", map: { ore: { gold: 0 } } });
    expect(count(none, Deposit.Gold)).toBe(0);
  });

  it("hills can be asked for close to the start or far from it", () => {
    let nearer = 0;
    for (const seed of SEEDS) {
      const close = hillSteps(new World(seed, { size: "small", map: { hills: "close" } }));
      const far = hillSteps(new World(seed, { size: "small", map: { hills: "veryfar" } }));
      expect(close).toBeLessThanOrEqual(far);
      if (close < far) nearer++;
    }
    expect(nearer).toBeGreaterThanOrEqual(2);
  }, 120000);

  it("map settings travel with saves and multiplayer starts", () => {
    const w = new World(SEEDS[2]!, { size: "tiny", map: { ore: ORE_PRESETS.fuel!.mix, hills: "far" } });
    const c = creativeOf(w);
    expect(c?.map).toEqual(w.map);
    const again = new World(SEEDS[2]!, { size: "tiny", ...creativeOptions(c) });
    expect(again.checksum()).toBe(w.checksum());
    // Settings that were never asked for leave no trace.
    expect(creativeOf(new World(SEEDS[2]!, { size: "tiny" }))).toBeUndefined();
  });
});
