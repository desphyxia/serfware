import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** Number of bends in a tile path: places where the next step is not the opposite neighbour of the last. */
function bends(w: World, path: number[]): number {
  const grid = w.land.planet.grid;
  let n = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ring = grid.neighborsOf(path[i] as number);
    const k = ring.indexOf(path[i - 1] as number);
    if (ring[(k + (ring.length >> 1)) % ring.length] !== path[i + 1]) n++;
  }
  return n;
}

describe("straight road routing", () => {
  it("bends less than plain A* and still reaches the goal", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const ok = (x: number) => land.isLand(x) && land.walkable(x);
    const open: number[] = [];
    for (let t = 0; t < land.territory.length; t += 7) if (ok(t)) open.push(t);
    let plain = 0;
    let straight = 0;
    let pairs = 0; let len = 0;
    for (let i = 0; i < 80; i++) {
      const from = open[(i * 37) % open.length] as number;
      const to = land.ring(from, 25)[(i * 13) % 1200] as number;
      if (!to || !ok(to)) continue;
      const a = land.findPath(from, to, ok, 3000);
      const b = land.findStraightPath(from, to, ok, 9000);
      if (!a || !b) continue;
      expect(b[0]).toBe(from);
      expect(b[b.length - 1]).toBe(to);
      expect(new Set(b).size).toBe(b.length);
      plain += bends(w, a); len += a.length;
      straight += bends(w, b);
      pairs++;
    }
    expect(pairs).toBeGreaterThan(10);
    console.log(`bends over ${pairs} routes: len ${len} plain ${plain}, straight ${straight}`);
    expect(straight).toBeLessThan(plain);
  });
});
