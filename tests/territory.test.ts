import { describe, expect, it } from "vitest";
import { placeOn } from "../src/sim/econ/planner";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step();
};
const owned = (w: World, p: number) => Array.from(w.land.territory).filter((o) => o === p + 1).length;

/** Own tiles near the border, best first. */
function borderTiles(w: World, p = 0): number[] {
  const land = w.land;
  const out: [number, number][] = [];
  for (let t = 0; t < land.territory.length; t++) {
    if (land.territory[t] !== p + 1 || !land.isLand(t)) continue;
    const free = land.ring(t, 4).filter((n) => land.territory[n] === 0).length;
    if (free > 4) out.push([-free, t]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, t]) => t);
}

describe("territory from light", () => {
  it("a lantern lights up once a warden arrives and the border grows", () => {
    const w = new World("lantern-grow", { size: "tiny" });
    const before = owned(w, 0);
    const tile = placeOn(w, "lamphouse", borderTiles(w), 0);
    expect(tile).toBeGreaterThanOrEqual(0);
    const b = w.economy.buildings.find((x) => x.alive && x.def.id === "lamphouse")!;
    expect(b.lit).toBe(false);
    run(w, 9000);
    expect(b.built).toBe(true);
    expect(b.lit).toBe(true);
    expect(b.garrison.length).toBeGreaterThanOrEqual(1);
    expect(owned(w, 0)).toBeGreaterThan(before);
    // Explored land covers at least the territory.
    const exp = w.economy.explored[0]!;
    for (let t = 0; t < exp.length; t++) if (w.land.territory[t] === 1) expect(exp[t]).toBe(1);
  });

  it("demolishing a lantern gives the land back and burns what stood on it", () => {
    const w = new World("lantern-shrink", { size: "tiny" });
    const base = owned(w, 0);
    placeOn(w, "lamphouse", borderTiles(w), 0);
    const b = w.economy.buildings.find((x) => x.alive && x.def.id === "lamphouse")!;
    run(w, 9000);
    expect(b.lit).toBe(true);
    // A flag out in the newly lit land.
    const land = w.land;
    const outer = land.ring(b.tile, 6).find((t) => land.territory[t] === 1 && land.canPlaceFlag(t, 0) && land.ring(w.economy.buildings[w.economy.keep]!.tile, 10).indexOf(t) < 0);
    if (outer !== undefined) expect(w.command({ t: "flag", tile: outer }).ok).toBe(true);
    expect(w.command({ t: "demolish", tile: b.tile }).ok).toBe(true);
    expect(owned(w, 0)).toBe(base);
    if (outer !== undefined) expect(land.use[outer]).not.toBe(Use.Flag);
  });

  it("garrison policy decides how many wardens stay", () => {
    const w = new World("lantern-policy", { size: "tiny" });
    placeOn(w, "beacon", borderTiles(w), 0);
    const b = w.economy.buildings.find((x) => x.alive && x.def.id === "beacon")!;
    expect(w.command({ t: "garrison", zone: "inland", value: 1 }).ok).toBe(true);
    run(w, 14000);
    expect(b.built).toBe(true);
    expect(b.garrison.length).toBe(5);
    w.command({ t: "garrison", zone: "inland", value: 0 });
    run(w, 400);
    expect(b.garrison.length).toBe(1);
  });
});

describe("AI rival", () => {
  it("builds an economy and expands with lanterns", () => {
    const w = new World("rival-grows", { size: "small", rivals: 1 });
    expect(w.players).toBe(2);
    const before = owned(w, 1);
    run(w, 40000);
    const mine = w.economy.buildings.filter((b) => b.alive && b.owner === 1);
    expect(mine.filter((b) => b.built).length).toBeGreaterThan(6);
    expect(mine.some((b) => b.def.slots && b.lit)).toBe(true);
    expect(owned(w, 1)).toBeGreaterThan(before);
    // Never builds on someone else's land.
    for (const b of mine) expect(w.land.territory[b.tile]).toBe(2);
  });

  it("is deterministic", () => {
    const a = new World("rival-det", { size: "tiny", rivals: 1 });
    const b = new World("rival-det", { size: "tiny", rivals: 1 });
    run(a, 6000);
    run(b, 6000);
    expect(a.checksum()).toBe(b.checksum());
  });
});
