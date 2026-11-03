import { describe, expect, it } from "vitest";
import { Use } from "../src/sim/econ/landuse";
import { placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "quiet-cairn-171";
const P = 1;

describe("a new site joins the Hearthship's roads", () => {
  it("is not joined to a scrap of road that does not reach the Hearthship", () => {
    const w = new World(SEED, { rivals: 1, latticeRoads: true });
    for (let i = 0; i < 6000; i++) w.step();
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[P] as number]!;
    const keepFlag = keep.flag;
    const mine = () => eco.flags.filter((f) => f.alive && f.owner === P);
    // Steps between two nodes on the road graph, up to `max`.
    const steps = (from: number, max: number): Map<number, number> => {
      const d = new Map([[from, 0]]);
      let front = [from];
      for (let k = 1; k <= max; k++) {
        const next: number[] = [];
        for (const n of front) {
          for (const m of land.nbrs(n)) {
            if (d.has(m)) continue;
            d.set(m, k);
            next.push(m);
          }
        }
        front = next;
      }
      return d;
    };
    // Free ground only: a flag put on a road splits it and joins the network.
    const free = (n: number) => land.use[n] === Use.Free && land.canPlaceFlag(n, P);
    const flagAt = (n: number) => w.command({ t: "flag", tile: n, player: P }).ok;
    // A road of two flags of our own, a few steps from every other flag and joined to none of them.
    let scrap: { a: number; b: number } | null = null;
    for (const [a] of [...steps(eco.flags[keepFlag]!.tile, 24)].sort((x, y) => x[1] - y[1] || x[0] - y[0])) {
      if (!free(a)) continue;
      const near = steps(a, 4);
      if (mine().some((f) => near.has(f.tile))) continue;
      const b = [...steps(a, 3)].find(([n, k]) => k === 3 && free(n))?.[0];
      if (b === undefined || !flagAt(a)) continue;
      if (!flagAt(b)) continue;
      const path = land.findPath(a, b, (x) => land.roadable(x, P) && (x === a || x === b || land.use[x] === Use.Free), 200);
      if (path && w.command({ t: "road", tiles: path, player: P }).ok) {
        scrap = { a, b };
        break;
      }
    }
    expect(scrap, "a scrap of road was laid").not.toBeNull();
    const { a, b } = scrap!;
    const fa = eco.flagAt(a)!;
    expect(eco.route(keepFlag, fa.id).dist).toBe(Infinity);
    // Woodcutters tried on the tiles round the scrap: each that is placed reaches the Hearthship.
    const tiles = [...new Set([...land.ring(land.pt(a), 3), ...land.ring(land.pt(b), 3)])].sort((x, y) => x - y);
    let placed = 0;
    for (let i = 0; i < 4; i++) {
      const before = eco.buildings.length;
      if (placeOn(w, "woodcutter", tiles, P) < 0) break;
      const site = eco.buildings.slice(before).find((x) => x.alive && x.def.id === "woodcutter")!;
      expect(eco.route(keepFlag, site.flag).dist, `site ${site.id}`).toBeLessThan(Infinity);
      placed++;
    }
    expect(placed).toBeGreaterThan(0);
  }, 120000);
});
