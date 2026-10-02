import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import type { Building } from "../src/sim/econ/economy";
import { placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808", "ember-sky-31", "ferry-1", "ferry-2", "ferry-3", "ferry-4"];

/** Two quays of the first player across a stretch of water (3 to 8 steps), road-connected so they get built; null on a world with none. */
function twoQuays(w: World): [Building, Building] | null {
  const eco = w.economy;
  const land = w.land;
  const grid = w.planet.grid;
  const keep = eco.buildings[eco.keep]!;
  const own = Array.from({ length: grid.count }, (_, t) => t).filter((t) => land.territory[t] === 1 && land.isLand(t) && land.isCoast(t));
  const near = (t: number) => land.ring(keep.tile, 9).includes(t);
  const first = placeOn(w, "quay", own.filter(near), 0, true, 80);
  if (first < 0) return null;
  const a = eco.buildings.find((b) => b.alive && b.tile === first)!;
  const fa = eco.flags[a.flag]!.tile;
  const across = own.filter((t) => {
    if (t === first) return false;
    const f = land.bestFlagTile(t, 0);
    if (f < 0 || f === fa) return false;
    const r = eco.ferryRoute(fa, f, 8);
    return !!r && r.steps >= 3;
  });
  const second = placeOn(w, "quay", across, 0, true, 80);
  if (second < 0) return null;
  return [a, eco.buildings.find((b) => b.alive && b.tile === second)!];
}

describe("ferries between quays", () => {
  it("two quays across the water can be linked by a ferry that carries goods", () => {
    let done = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const pair = twoQuays(w);
      if (!pair) continue;
      const [a, b] = pair;
      // Not before the quay is finished.
      expect(w.command({ t: "ferry", from: a.id, to: b.id }).ok).toBe(false);
      // Roads from the quays to the Hearthship would let them be built; give the sites a road if they have none.
      for (let i = 0; i < 12000 && !(a.built && b.built); i++) w.step();
      if (!(a.built && b.built)) continue;
      const planks = () => eco.storageTotals(0)[goodId("plank")]!;
      const before = planks();
      const r = w.command({ t: "ferry", from: a.id, to: b.id });
      expect(r.ok).toBe(true);
      expect(planks()).toBe(before - 3);
      const link = eco.ferryBetween(a, b)!;
      expect(link.ferry).toBe(true);
      expect(w.command({ t: "ferry", from: a.id, to: b.id }).ok).toBe(false);
      // A boatman takes the oars, and a good put on one quay's flag for the other crosses.
      for (let i = 0; i < 3000 && link.carrier < 0; i++) w.step();
      expect(link.carrier).toBeGreaterThanOrEqual(0);
      // A pile of goods on one quay's flag, bound for the other, goes over the water.
      const spawn = (eco as unknown as { spawnGood(type: number, flag: number): { dest: number } }).spawnGood.bind(eco);
      const log = goodId("log");
      for (let i = 0; i < 4; i++) {
        spawn(log, a.flag).dest = b.id;
        b.pending[log]! += 1;
      }
      let ferried = 0;
      for (let i = 0; i < 6000; i++) {
        w.step();
        ferried = Math.max(ferried, link.busy);
        if (b.stock[log]! >= 4) break;
      }
      expect(b.stock[log]).toBeGreaterThanOrEqual(1);
      expect(ferried).toBeGreaterThan(0);
      done++;
      break;
    }
    expect(done).toBeGreaterThan(0);
  }, 600000);

  it("a quay can be upgraded to a harbour with planks and stone", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const pair = twoQuays(w);
      if (!pair) continue;
      const [a, b] = pair;
      w.command({ t: "demolish", tile: b.tile });
      expect(w.command({ t: "upgrade", building: a.id }).ok).toBe(false);
      for (let i = 0; i < 12000 && !a.built; i++) w.step();
      if (!a.built) continue;
      const stone = () => eco.storageTotals(0)[goodId("stone")]!;
      const s0 = stone();
      expect(w.command({ t: "upgrade", building: a.id }).ok).toBe(true);
      expect(a.def.id).toBe("harbour");
      expect(a.def.ferry).toBe(14);
      expect(stone()).toBe(s0 - 3);
      expect(w.command({ t: "upgrade", building: a.id }).ok).toBe(false);
      return;
    }
    throw new Error("no world with a quay site");
  }, 600000);

  it("a ferry too far is refused, and ends with its quay", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const pair = twoQuays(w);
      if (!pair) continue;
      const [a, b] = pair;
      for (let i = 0; i < 12000 && !(a.built && b.built); i++) w.step();
      if (!(a.built && b.built)) continue;
      expect(w.command({ t: "ferry", from: a.id, to: b.id }).ok).toBe(true);
      const link = eco.ferryBetween(a, b)!;
      expect(w.command({ t: "unferry", from: a.id, to: b.id }).ok).toBe(true);
      expect(link.alive).toBe(false);
      expect(w.command({ t: "ferry", from: a.id, to: b.id }).ok).toBe(true);
      const again = eco.ferryBetween(a, b)!;
      w.command({ t: "demolish", tile: b.tile });
      expect(again.alive).toBe(false);
      return;
    }
    throw new Error("no world with two quays");
  }, 600000);
});
