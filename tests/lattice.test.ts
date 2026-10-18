import { describe, expect, it } from "vitest";
import { HexLattice } from "../src/sim/planet/lattice";
import { World } from "../src/sim/world";

const w = new World("russet-heron-417", { size: "small" });
const grid = w.planet.grid;
const lat = new HexLattice(grid);

describe("hex lattice spike", () => {
  it("has a node per tile centre and per corner, and symmetric links", () => {
    expect(lat.count).toBe(grid.count + grid.corners.length / 3);
    for (let n = 0; n < lat.count; n++) for (const m of lat.neighborsOf(n)) expect(lat.neighborsOf(m).includes(n)).toBe(true);
  });

  it("joins every corner to 6 nodes and every tile centre to one per corner", () => {
    for (let c = 0; c < grid.corners.length / 3; c++) expect(lat.degree(lat.cornerNode(c))).toBe(6);
    for (let t = 0; t < grid.count; t++) expect(lat.degree(t)).toBe(grid.degree(t));
  });

  it("is a triangulation: three nodes and nine links per tile on average", () => {
    let links = 0;
    for (let n = 0; n < lat.count; n++) links += lat.degree(n);
    links /= 2;
    // Euler on the sphere: V - E + F = 2 with F = 2 * (V - 2) triangles -> E = 3 * (V - 2).
    expect(links).toBe(3 * (lat.count - 2));
  });

  it("keeps edge lengths even enough to treat steps alike", () => {
    const ds: number[] = [];
    for (let n = 0; n < lat.count; n++) for (const m of lat.neighborsOf(n)) if (m > n) ds.push(lat.dist(n, m) / lat.unit);
    ds.sort((a, b) => a - b);
    const at = (q: number) => ds[Math.floor(ds.length * q)] as number;
    console.log(`edge length / mean: min ${ds[0]!.toFixed(2)}, 1% ${at(0.01).toFixed(2)}, 99% ${at(0.99).toFixed(2)}, max ${ds[ds.length - 1]!.toFixed(2)}`);
    // A few spokes in skinny triangles run short, but nearly every edge is within 30% of the mean.
    expect(at(0.01)).toBeGreaterThan(0.6);
    expect(at(0.99)).toBeLessThan(1.3);
  });

  it("finds paths between corners that keep to few bends", () => {
    let bends = 0;
    let steps = 0;
    for (let i = 0; i < 20; i++) {
      const a = lat.cornerNode((i * 211) % (grid.corners.length / 3));
      const b = lat.cornerNode((i * 211 + 97) % (grid.corners.length / 3));
      const p = lat.findPath(a, b);
      expect(p).not.toBeNull();
      expect(p![0]).toBe(a);
      expect(p![p!.length - 1]).toBe(b);
      steps += p!.length;
      for (let k = 1; k < p!.length - 1; k++) {
        const x = lat.pos, [u, v, q] = [p![k - 1]!, p![k]!, p![k + 1]!];
        const d1 = [0, 1, 2].map((j) => x[v * 3 + j]! - x[u * 3 + j]!);
        const d2 = [0, 1, 2].map((j) => x[q * 3 + j]! - x[v * 3 + j]!);
        const cos = (d1[0]! * d2[0]! + d1[1]! * d2[1]! + d1[2]! * d2[2]!) / Math.hypot(...d1) / Math.hypot(...d2);
        if (cos < 0.85) bends++;
      }
    }
    console.log(`lattice routes: ${steps} steps, ${bends} bends`);
    expect(bends).toBeLessThan(steps / 3);
  });
});
