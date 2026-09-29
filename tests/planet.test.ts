import { describe, expect, it } from "vitest";
import { buildGeodesic, buildRings, vertexCountFor } from "../src/sim/planet/geodesic";
import { buildPlanetGrid } from "../src/sim/planet/grid";
import { countFolds } from "../src/sim/planet/relax";
import { WELL_STYLES, dot, type Vec3 } from "../src/sim/planet/wells";
import { Rng } from "../src/sim/rng";
import { World } from "../src/sim/world";

describe("geodesic", () => {
  it("has the expected vertex count and degrees", () => {
    const g = buildGeodesic(8);
    expect(g.vertexCount).toBe(vertexCountFor(8));
    const rings = buildRings(g);
    const degrees = new Map<number, number>();
    for (let v = 0; v < g.vertexCount; v++) {
      const d = (rings.start[v + 1] as number) - (rings.start[v] as number);
      degrees.set(d, (degrees.get(d) ?? 0) + 1);
    }
    expect(degrees.get(5)).toBe(12);
    expect(degrees.get(6)).toBe(g.vertexCount - 12);
    expect(countFolds(g.pos, g.tris)).toBe(0);
  });
});

describe("planet grid", () => {
  for (const style of WELL_STYLES) {
    it(`relaxes without folds and keeps 12 pentagons (${style})`, () => {
      const grid = buildPlanetGrid(16, new Rng(`grid-${style}`), style);
      let pent = 0;
      for (let t = 0; t < grid.count; t++) if (grid.degree(t) === 5) pent++;
      expect(pent).toBe(12);
      expect(grid.count).toBe(2562);
      let minA = Infinity;
      let maxA = 0;
      for (const a of grid.area) {
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
      }
      expect(minA).toBeGreaterThan(0.2);
      expect(maxA).toBeLessThan(4);
    });
  }

  it("does not use the regular icosahedral pattern", () => {
    const grid = buildPlanetGrid(16, new Rng("irregular"));
    const pts = grid.pentagons.map((p) => grid.centerOf(p));
    // In the regular pattern every pentagon's nearest neighbour is exactly 63.43° away.
    const nearest = pts.map((p, i) =>
      Math.max(...pts.filter((_, j) => j !== i).map((q) => dot(p as Vec3, q as Vec3))),
    );
    const spread = Math.max(...nearest) - Math.min(...nearest);
    expect(spread).toBeGreaterThan(0.05);
  });

  it("finds the nearest tile by walking", () => {
    const grid = buildPlanetGrid(16, new Rng("walk"));
    const target = grid.centerOf(1234);
    expect(grid.nearestTile(target, 0)).toBe(1234);
  });
});

describe("world generation", () => {
  it("is deterministic per seed", () => {
    const a = new World("same-seed", { size: "tiny" });
    const b = new World("same-seed", { size: "tiny" });
    expect(a.checksum()).toBe(b.checksum());
    expect(Array.from(a.planet.terrain.elevation.slice(0, 50))).toEqual(Array.from(b.planet.terrain.elevation.slice(0, 50)));
  });

  it("differs between seeds and has land and sea", () => {
    const w = new World("other-seed", { size: "tiny" });
    expect(w.checksum()).not.toBe(new World("same-seed", { size: "tiny" }).checksum());
    const land = Array.from(w.planet.terrain.elevation).filter((e) => e > 0).length / w.planet.grid.count;
    expect(land).toBeGreaterThan(0.3);
    expect(land).toBeLessThan(0.65);
  });

  it("builds a medium planet in reasonable time", () => {
    const t0 = performance.now();
    const w = new World("perf", { size: "medium" });
    const ms = performance.now() - t0;
    expect(w.planet.grid.count).toBe(10242);
    expect(ms).toBeLessThan(4000);
  });
});
