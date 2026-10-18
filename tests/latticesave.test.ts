import { describe, expect, it } from "vitest";
import { BUILDINGS, buildingType } from "../src/sim/econ/defs";
import { creativeOf, makeSave, replaySave, ReplaySession, SoloSession, worldOptionsFor } from "../src/net/session";
import { World } from "../src/sim/world";

const SEED = "quiet-cairn-171";

describe("lattice worlds in saves, replays and multiplayer", () => {
  it("a saved lattice game replays to the same checksum", () => {
    const session = new SoloSession(new World(SEED, { rivals: 1, latticeRoads: true }));
    const keep = session.world.economy.buildings[session.world.economy.keeps[0] as number]!;
    for (let i = 0; i < 3000; i++) {
      if (i === 300) {
        const land = session.world.land;
        const t = land.ring(keep.tile, 6).find((n) => land.bestFlagTile(n, 0) >= 0 && land.canBuildDef(n, land.bestFlagTile(n, 0), BUILDINGS[buildingType("woodcutter")]!, 0));
        if (t !== undefined) expect(session.submit({ t: "build", type: "woodcutter", tile: t, flagTile: land.bestFlagTile(t, 0) }).ok).toBe(true);
      }
      session.world.step();
    }
    expect(creativeOf(session.world)?.lattice).toBe(true);
    const save = makeSave(session, "lattice", "test");
    const back = JSON.parse(JSON.stringify(save));
    const { world, matches } = replaySave(back);
    expect(world.land.lattice).not.toBeNull();
    expect(matches).toBe(true);
    // The time-lapse rebuilds the same lattice world.
    expect(new ReplaySession(back).world.land.lattice).not.toBeNull();
  }, 120000);

  it("a default game is saved without any lattice", () => {
    const session = new SoloSession(new World(SEED, { size: "small" }));
    expect(creativeOf(session.world)?.lattice).toBeUndefined();
  });

  it("every peer of a lattice match builds the same lattice world", () => {
    const players = [{ id: 0, name: "A" }, { id: 1, name: "B" }];
    const a = new World(SEED, { size: "small", ...worldOptionsFor("neighbours", players, undefined, { lattice: true }) });
    const b = new World(SEED, { size: "small", ...worldOptionsFor("neighbours", players, undefined, { lattice: true }) });
    expect(a.land.lattice).not.toBeNull();
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.humans).toBe(2);
  }, 120000);
});
