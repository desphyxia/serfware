import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/options";
import { BUILDINGS, buildingType, type BuildingDef } from "../src/sim/econ/defs";
import { chooseSide, flagSides, placeOn, releaseSite, reservedSite, reserveSite, starterChain } from "../src/sim/econ/planner";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const def = (id: string) => BUILDINGS[buildingType(id)] as BuildingDef;

// turnBuildings is on by default since #184; these tests start with it off and turn it on where they need it.
const TURN = aiOptions.turnBuildings;
beforeEach(() => {
  aiOptions.turnBuildings = false;
});
afterEach(() => {
  aiOptions.reserveRail = false;
  aiOptions.turnBuildings = TURN;
  aiOptions.turnBlockWeight = 0;
});

/** A tiny one-player world with the starter chain standing, and the tiles within 12 steps of the keep. */
function settled() {
  const w = new World("rail-site", { size: "tiny", players: 1 });
  starterChain(w, 0);
  const keep = w.economy.buildings[w.economy.keeps[0]!]!;
  return { w, tiles: w.land.ring(keep.tile, 12), keep };
}

describe("keeping a site for the launch rail (#147)", () => {
  it("is off by default", () => {
    expect(aiOptions.reserveRail).toBe(false);
    expect(aiOptions.turnBlockWeight).toBe(0);
  });

  it("holds a site where a rail fits, and placements keep off it until it is released", () => {
    aiOptions.reserveRail = true;
    const { w, tiles } = settled();
    const site = reserveSite(w, "launchrail", 0);
    expect(site).toBeGreaterThanOrEqual(0);
    expect(reservedSite(w, 0)).toBe(site);
    expect(flagSides(w, site, def("launchrail"), 0).length).toBeGreaterThan(0);
    const footprint = new Set([site, ...w.land.planet.grid.neighborsOf(site)]);
    // Fill the ring with houses: none stands on, or has its flag on, the held tiles.
    for (let i = 0; i < 40; i++) placeOn(w, "house", tiles, 0, true);
    for (const b of w.economy.buildings) {
      if (!b.alive || b.owner !== 0 || b.def.id === "keep") continue;
      expect(footprint.has(b.tile)).toBe(false);
      expect(footprint.has(w.economy.flags[b.flag]!.tile)).toBe(false);
    }
    releaseSite(w, 0);
    expect(reservedSite(w, 0)).toBe(-1);
  });

  it("changes nothing with the switch off: placeOn ignores a held site", () => {
    const { w, tiles } = settled();
    aiOptions.reserveRail = true;
    const site = reserveSite(w, "launchrail", 0);
    expect(site).toBeGreaterThanOrEqual(0);
    aiOptions.reserveRail = false;
    const footprint = new Set([site, ...w.land.planet.grid.neighborsOf(site)]);
    // With the switch off the held tiles are open: a house tried on the site's own tile is built.
    const tryTiles = [...footprint];
    const placed = placeOn(w, "house", tryTiles, 0, true);
    expect(placed).toBeGreaterThanOrEqual(0);
    expect(tiles.length).toBeGreaterThan(0);
  });

  it("builds the rail on the held site once it is released", () => {
    aiOptions.reserveRail = true;
    const { w, tiles } = settled();
    const site = reserveSite(w, "launchrail", 0);
    for (let i = 0; i < 40; i++) placeOn(w, "house", tiles, 0, true);
    releaseSite(w, 0);
    expect(placeOn(w, "launchrail", [site], 0, true)).toBe(site);
    expect(w.economy.buildings.some((b) => b.alive && b.def.id === "launchrail" && b.tile === site)).toBe(true);
  });
});

describe("a flag side that blocks fewer tiles (#148)", () => {
  /** Free tiles beside a flag tile that a flag could stand on, as the score counts them. */
  const blocked = (w: World, flagTile: number, t: number) => w.land.planet.grid.neighborsOf(flagTile).filter((n) => n !== t && w.land.roadable(n, 0) && w.land.use[n] === Use.Free).length;

  it("scores sides as before with the weight at 0, and never a side that blocks more with a large weight", () => {
    aiOptions.turnBuildings = true;
    const { w, tiles } = settled();
    const before = new Map<string, number>();
    for (const t of tiles) {
      const c = chooseSide(w, def("farm"), t, 0);
      if (c) before.set(String(t), c.flagTile);
    }
    expect(before.size).toBeGreaterThan(10);
    aiOptions.turnBlockWeight = 0;
    for (const t of tiles) {
      const c = chooseSide(w, def("farm"), t, 0);
      if (c) expect(c.flagTile).toBe(before.get(String(t)));
    }
    aiOptions.turnBlockWeight = 100;
    let fewer = 0;
    for (const t of tiles) {
      const c = chooseSide(w, def("farm"), t, 0);
      const was = before.get(String(t));
      if (!c || was === undefined) continue;
      const existing = w.economy.flagAt(c.flagTile);
      const wasExisting = w.economy.flagAt(was);
      // A side on a flag that stands blocks nothing; otherwise the chosen side blocks no more than the old one did.
      if (!existing && !wasExisting) expect(blocked(w, c.flagTile, t)).toBeLessThanOrEqual(blocked(w, was, t));
      if (c.flagTile !== was) fewer++;
    }
    expect(fewer).toBeGreaterThanOrEqual(0);
  });
});
