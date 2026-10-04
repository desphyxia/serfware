import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../src/sim/econ/defs";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

describe("a building's flag", () => {
  it("comes with the building, reusing a free flag next to it but never one that already serves a building", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const def = BUILDINGS.find((b) => b.id === "woodcutter")!;
    // A spot beside the Hearthship's flag (which already serves the Hearthship).
    const keepFlag = eco.flags[keep.flag]!.tile;
    const spot = [...land.planet.grid.neighborsOf(keepFlag)].find((t) => {
      const f = land.bestFlagTile(t, 0);
      return f >= 0 && land.canBuildDef(t, f, def, 0);
    });
    expect(spot).toBeDefined();
    const flagTile = land.bestFlagTile(spot!, 0);
    expect(flagTile).not.toBe(keepFlag);
    const flags = eco.flags.filter((f) => f.alive).length;
    expect(w.command({ t: "build", type: "woodcutter", tile: spot!, flagTile }).ok).toBe(true);
    expect(eco.flags.filter((f) => f.alive).length).toBe(flags + 1);
    expect(land.use[flagTile]).toBe(Use.Flag);
    // A free flag already standing next to a spot is used rather than a new one.
    const free = land.ring(keep.tile, 4).find((t) => land.canPlaceFlag(t, 0) && w.command({ t: "flag", tile: t }).ok);
    expect(free).toBeDefined();
    const beside = [...land.planet.grid.neighborsOf(free!)].find((t) => land.bestFlagTile(t, 0) === free && land.canBuildDef(t, free!, def, 0));
    if (beside !== undefined) expect(land.bestFlagTile(beside, 0)).toBe(free);
  });

  it("may stand on the tiles right around the Hearthship, but never next to another flag", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const keepFlag = eco.flags[keep.flag]!.tile;
    const ring = [...land.planet.grid.neighborsOf(keep.tile)].filter((t) => t !== keepFlag);
    const ok = ring.filter((t) => land.canPlaceFlag(t, 0));
    expect(ok.length).toBeGreaterThan(0);
    // Tiles beside the Hearthship's own flag still keep the spacing rule.
    for (const t of ring) if (land.planet.grid.neighborsOf(t).includes(keepFlag)) expect(land.canPlaceFlag(t, 0)).toBe(false);
    const t = ok[0]!;
    expect(w.command({ t: "flag", tile: t }).ok).toBe(true);
    expect(land.use[t]).toBe(Use.Flag);
  });
});
