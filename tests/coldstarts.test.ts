import { afterEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/builder";
import { startOptions } from "../src/sim/econ/economy";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const DEFAULT_COLD = startOptions.avoidCold;
const DEFAULT_WARM = aiOptions.warmFarms;
afterEach(() => {
  startOptions.avoidCold = DEFAULT_COLD;
  aiOptions.warmFarms = DEFAULT_WARM;
});

/** The assess game's map, nobody thinking. */
const assess = (seed: string, size: "tiny" | "small"): World =>
  new World(seed, { size, rivals: 3, personalities: ["builder", "trader", "warden"], aiLevel: "normal", difficulty: "honest", peaceDays: 999, brain: () => ({ think: () => {} }) } as never);

/** The guessed growing season over the land within `radius` of a tile. */
const warmthAt = (w: World, tile: number, radius: number): number => {
  const near = [w.land.pt(tile), ...w.land.ring(tile, radius)].filter((t) => w.land.isLand(t));
  return near.reduce((s, t) => s + w.climate.growingGuess(t), 0) / near.length;
};
const keepTile = (w: World, p: number): number => (w.economy.buildings[w.economy.keeps[p] as number] as { tile: number }).tile;

describe("the guessed growing season (Climate.growingGuess)", () => {
  it("is a share of the year, warmer where the ground is warmer, and draws nothing from the weather's random stream", () => {
    const a = new World("guess-1", { size: "tiny" });
    const b = new World("guess-1", { size: "tiny" });
    const temp = a.planet.terrain.temperature;
    let cold = 0;
    let warm = 0;
    for (let t = 0; t < temp.length; t++) {
      const g = a.climate.growingGuess(t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if ((temp[t] as number) < (temp[cold] as number)) cold = t;
      if ((temp[t] as number) > (temp[warm] as number)) warm = t;
    }
    expect(a.climate.growingGuess(cold)).toBeLessThan(a.climate.growingGuess(warm));
    for (let i = 0; i < 200; i++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
  });
});

describe("starts stay out of the cold (startOptions.avoidCold)", () => {
  it("is on by default (#179)", () => {
    expect(DEFAULT_COLD).toBe(true);
  });

  it("moves a start off land that hardly ever grows, and leaves maps with no cold start as they were", () => {
    startOptions.avoidCold = false;
    const off = assess("bal-001", "small");
    startOptions.avoidCold = true;
    const on = assess("bal-001", "small");
    // Seat 1 starts in the tundra without the switch.
    expect(warmthAt(off, keepTile(off, 1), 7)).toBeLessThan(0.2);
    expect(warmthAt(on, keepTile(on, 1), 7)).toBeGreaterThan(0.35);
    // Every start of this map grows a third of the year or more, so the switch changes nothing.
    startOptions.avoidCold = false;
    const tinyOff = assess("bal-003", "tiny");
    startOptions.avoidCold = true;
    const tinyOn = assess("bal-003", "tiny");
    for (let p = 0; p <= 3; p++) expect(keepTile(tinyOn, p)).toBe(keepTile(tinyOff, p));
  }, 120000);
});

describe("farms and orchards on the warm land (aiOptions.warmFarms)", () => {
  it("is on by default (#179)", () => {
    expect(DEFAULT_WARM).toBe(true);
  });

  it("places farms and orchards where the growing season is at least as long, and longer somewhere", () => {
    let longer = 0;
    for (const type of ["farm", "orchard"])
      for (let p = 1; p <= 3; p++) {
        const site = (warm: boolean): number => {
          aiOptions.warmFarms = warm;
          const w = assess("bal-001", "small");
          const before = w.economy.buildings.length;
          expect(placeConnected(w, type, { minDist: 2, maxDist: 9, player: p, splitRoads: true })).toBe(true);
          const b = w.economy.buildings.slice(before).find((x) => x.def.id === type) as { tile: number };
          return warmthAt(w, b.tile, 3);
        };
        const off = site(false);
        const on = site(true);
        expect(on).toBeGreaterThanOrEqual(off - 1e-6);
        if (on > off + 0.05) longer++;
      }
    expect(longer).toBeGreaterThan(0);
  }, 240000);
});
