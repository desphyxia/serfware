import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS, scenarioWorld, TUTORIAL, VOYAGE } from "../src/sim/scenario/campaign";
import { goodId } from "../src/sim/econ/defs";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const make = (id: string, size: "tiny" | "small" = "small") => {
  const sw = scenarioWorld(id)!;
  return new World(sw.seed, { ...sw.opts, size });
};

describe("scenarios", () => {
  it("there is a tutorial, twelve chapters of The Long Voyage on Lanterne and some handmade scenarios", () => {
    expect(TUTORIAL.sequential).toBe(true);
    expect(VOYAGE.map((c) => c.chapter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(VOYAGE.map((c) => c.seed))).toEqual(new Set(["lanterne"]));
    expect(ALL_SCENARIOS.filter((s) => s.kind === "scenario").length).toBeGreaterThanOrEqual(3);
    expect(new Set(ALL_SCENARIOS.map((s) => s.id)).size).toBe(ALL_SCENARIOS.length);
  });

  it("every scenario builds its world and starts with no goal reached", () => {
    for (const s of ALL_SCENARIOS) {
      const w = make(s.id, "tiny");
      expect(w.scenario?.def.id).toBe(s.id);
      for (let i = 0; i < 60; i++) w.step();
      expect(w.scenario!.done).toBe(false);
      expect(w.scenario!.failed).toBe(false);
    }
  }, 60000);

  it("the tutorial's goals come one at a time and are met by playing", () => {
    const w = make("tutorial");
    const run = w.scenario!;
    expect(run.current).toBe(0);
    // A flag: the first goal.
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    const spot = w.land.ring(keep.tile, 3).find((t) => w.land.canPlaceFlag(t, 0))!;
    expect(w.command({ t: "flag", tile: spot }).ok).toBe(true);
    for (let i = 0; i < 60; i++) w.step();
    expect(run.reached[0]).toBeGreaterThan(0);
    expect(run.current).toBe(1);
    // The woodcutter goal waits for a built woodcutter (not just a site).
    expect(placeConnected(w, "woodcutter", { minDist: 2, maxDist: 8, player: 0 })).toBe(true);
    for (let i = 0; i < 60; i++) w.step();
    expect(run.current).toBe(1);
    const site = w.economy.buildings.find((b) => b.alive && b.def.id === "woodcutter")!;
    site.built = true;
    for (let i = 0; i < 60; i++) w.step();
    expect(run.current).toBe(2);
    expect(w.economy.notices.some((n) => n.text.startsWith("✓"))).toBe(true);
  });

  it("chapter goals complete the chapter, and triggers fire scripted events", () => {
    const w = make("voyage-1");
    const run = w.scenario!;
    const eco = w.economy;
    // Fake the yard: built woodcutters, quarry, sawmill, forester; planks in store.
    for (const type of ["woodcutter", "woodcutter", "quarry", "sawmill", "forester"]) {
      expect(placeConnected(w, type, { minDist: 2, maxDist: 10, player: 0 })).toBe(true);
      eco.buildings[eco.buildings.length - 1]!.built = true;
    }
    eco.buildings[eco.keeps[0]!]!.stock[goodId("plank")] = 30;
    for (let i = 0; i < 60; i++) w.step();
    expect(run.done).toBe(true);
    expect(eco.notices.some((n) => n.text.includes("Chapter 1 complete"))).toBe(true);

    const w8 = make("voyage-8");
    const adv = w8.economy.adversity;
    while (w8.tick < w8.scenario!.start + 2 * w8.economy.dayTicks) w8.step();
    expect(adv.events.some((e) => e.kind === "coldsnap")).toBe(true);
  }, 60000);

  it("is part of the checksum, and a save of a scenario replays to the same world", () => {
    const a = make("rival-valley", "tiny");
    const b = make("rival-valley", "tiny");
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.economy.keeps.length).toBe(2);
  });
});
