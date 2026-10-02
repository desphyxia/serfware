import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import type { Building } from "../src/sim/econ/economy";
import { placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808", "ember-sky-31", "ferry-1", "ferry-2", "ferry-3", "ferry-4"];

/** A finished quay by the keep and a free shore tile across the water within its ferry reach, or null. */
function setup(w: World): { quay: Building; shore: number; flag: number } | null {
  const eco = w.economy;
  const land = w.land;
  const grid = w.planet.grid;
  const keep = eco.buildings[eco.keep]!;
  const own = Array.from({ length: grid.count }, (_, t) => t).filter((t) => land.territory[t] === 1 && land.isLand(t) && land.isCoast(t) && land.ring(keep.tile, 9).includes(t));
  const first = placeOn(w, "quay", own, 0, true, 80);
  if (first < 0) return null;
  const quay = eco.buildings.find((b) => b.alive && b.tile === first)!;
  for (let i = 0; i < 12000 && !quay.built; i++) w.step();
  if (!quay.built) return null;
  const fq = eco.flags[quay.flag]!.tile;
  for (let t = 0; t < grid.count; t++) {
    if (land.territory[t] !== 0 || !land.isLand(t) || !land.isCoast(t)) continue;
    const f = land.bestFlagTile(t, 0, true);
    if (f < 0) continue;
    const r = eco.ferryRoute(fq, f, 8);
    if (r && r.steps >= 2 && land.canBuildDef(t, f, quay.def, 0)) return { quay, shore: t, flag: f };
  }
  return null;
}

describe("footholds", () => {
  it("a quay on free shore across the water brings its own ferry and claims a little land", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const s = setup(w);
      if (!s) continue;
      const planks = () => eco.storageTotals(0)[goodId("plank")]!;
      const before = planks();
      const r = w.command({ t: "build", type: "quay", tile: s.shore, flagTile: s.flag });
      expect(r.ok).toBe(true);
      expect(planks()).toBe(before - 3);
      const site = eco.buildings.find((b) => b.alive && b.tile === s.shore)!;
      expect(eco.ferryBetween(s.quay, site)).toBeDefined();
      expect(w.land.territory[s.shore]).toBe(0);
      for (let i = 0; i < 20000 && !site.built; i++) w.step();
      expect(site.built).toBe(true);
      expect(w.land.territory[s.shore]).toBe(1);
      return;
    }
    throw new Error("no world with a foothold shore");
  }, 900000);

  it("a foothold out of ferry reach is refused", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const s = setup(w);
      if (!s) continue;
      const fq = eco.flags[s.quay.flag]!.tile;
      const grid = w.planet.grid;
      for (let t = 0; t < grid.count; t++) {
        if (w.land.territory[t] !== 0 || !w.land.isLand(t) || !w.land.isCoast(t)) continue;
        const f = w.land.bestFlagTile(t, 0, true);
        if (f < 0 || eco.ferryRoute(fq, f, 8)) continue;
        expect(w.command({ t: "build", type: "quay", tile: t, flagTile: f }).ok).toBe(false);
        return;
      }
    }
    throw new Error("no far shore");
  }, 900000);
});
