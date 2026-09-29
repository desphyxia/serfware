import { describe, expect, it } from "vitest";
import { ticksPerDay } from "../src/sim/clock";
import { goodId } from "../src/sim/econ/defs";
import { MEMORIAL } from "../src/sim/econ/economy";
import { Feature } from "../src/sim/econ/landuse";
import { placeConnected, starterChain } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step();
};

describe("people", () => {
  it("founders have names, families and ages", () => {
    const w = new World("people-1", { size: "tiny" });
    const people = w.economy.peopleOf(0);
    expect(people.length).toBe(36);
    expect(new Set(people.map((p) => p.family)).size).toBeGreaterThan(3);
    expect(people.every((p) => p.stage === "adult" && p.first.length > 1)).toBe(true);
  });

  it("workers gain skill and write journals", () => {
    const w = new World("people-2", { size: "tiny" });
    starterChain(w);
    run(w, 15000);
    const skilled = w.economy.peopleOf(0).filter((p) => Object.values(p.skills).some((v) => v > 0.05));
    expect(skilled.length).toBeGreaterThan(0);
    expect(skilled.some((p) => p.journal.length > 0)).toBe(true);
  });

  it("households form in houses and children are born when fed", () => {
    const w = new World("people-3", { size: "tiny" });
    const keep = w.economy.buildings[w.economy.keep]!;
    keep.stock[goodId("bread")] = 200;
    expect(placeConnected(w, "house", { minDist: 2 })).toBe(true);
    expect(placeConnected(w, "house", { minDist: 2 })).toBe(true);
    const day = ticksPerDay(w.planet.params.dayLengthHours);
    run(w, day * 8);
    const people = w.economy.peopleOf(0);
    expect(people.filter((p) => p.house >= 0).length).toBeGreaterThan(3);
    expect(people.length).toBeGreaterThan(36);
    expect(w.economy.glow[0]).toBeGreaterThan(40);
  });

  it("the old retire, and are remembered with a tree", () => {
    const w = new World("people-4", { size: "tiny" });
    const p = w.economy.peopleOf(0)[0]!;
    const day = ticksPerDay(w.planet.params.dayLengthHours);
    p.born = w.tick - 45 * day;
    p.lifespan = w.tick + day * 1.5;
    run(w, day * 3);
    expect(p.alive).toBe(false);
    const memorials = Array.from(w.land.feature).filter((f, t) => f === Feature.Tree && w.land.variety[t] === MEMORIAL).length;
    expect(memorials).toBe(1);
  });

  it("hunger lowers Glow", () => {
    const w = new World("people-5", { size: "tiny" });
    const keep = w.economy.buildings[w.economy.keep]!;
    for (const id of ["bread", "fish", "meat"]) keep.stock[goodId(id)] = 0;
    const day = ticksPerDay(w.planet.params.dayLengthHours);
    run(w, day * 2);
    expect(w.economy.glowParts[0]!.nourishment).toBeLessThan(0.2);
  });
});
