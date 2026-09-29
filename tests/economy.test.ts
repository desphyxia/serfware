import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import type { Building, Economy } from "../src/sim/econ/economy";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

/** Find a spot for a building of `type` a few tiles from the keep, with a road back to the keep flag. */
function placeConnected(w: World, type: string, minDist = 3, avoid: number[] = []): Building {
  const eco = w.economy;
  const land = w.land;
  const keep = eco.buildings[eco.keep]!;
  const keepFlag = eco.flags[keep.flag]!;
  for (const t of land.ring(keep.tile, 7)) {
    if (land.ring(keep.tile, minDist - 1).includes(t) || avoid.includes(t)) continue;
    const flagTile = land.bestFlagTile(t);
    if (flagTile < 0 || !land.canBuild(t, flagTile)) continue;
    const path = land.findPath(keepFlag.tile, flagTile, (x) => land.roadable(x) && x !== t, 4000);
    if (!path || path.length < 3) continue;
    if (eco.checkRoad(path)) continue;
    const r1 = w.command({ t: "build", type, tile: t, flagTile });
    if (!r1.ok) continue;
    const r2 = w.command({ t: "road", tiles: path });
    if (!r2.ok) continue;
    return eco.buildings[eco.buildings.length - 1]!;
  }
  throw new Error(`No spot for ${type}`);
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.step();
}

function totalOnMap(eco: Economy, type: number): number {
  return eco.storageTotals()[type]!;
}

import { starterChain } from "../src/sim/econ/planner";

describe("planner", () => {
  it("places a connected starter chain that gets built", () => {
    const w = new World("planner-1", { size: "tiny" });
    expect(starterChain(w)).toBeGreaterThanOrEqual(3);
    run(w, 6000);
    const built = w.economy.buildings.filter((b) => b.alive && b.built && b.def.id !== "keep").length;
    expect(built).toBeGreaterThanOrEqual(3);
  });
});

describe("economy", () => {
  it("starts with a keep, flag, territory and settlers", () => {
    const w = new World("eco-start", { size: "tiny" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keep]!;
    expect(keep.def.id).toBe("keep");
    expect(w.land.use[keep.tile]).toBe(Use.Building);
    expect(eco.population().idle).toBeGreaterThan(20);
    expect(Array.from(w.land.territory).filter((x) => x).length).toBeGreaterThan(100);
  });

  it("builds a woodcutter over a road and brings logs home", () => {
    const w = new World("eco-wood", { size: "tiny" });
    const eco = w.economy;
    const log = goodId("log");
    const logsBefore = totalOnMap(eco, log);
    const wc = placeConnected(w, "woodcutter");
    run(w, 400);
    expect(eco.roads.some((r) => r.alive && r.carrier >= 0)).toBe(true);
    run(w, 3000);
    expect(wc.built).toBe(true);
    run(w, 3000);
    expect(totalOnMap(eco, log)).toBeGreaterThan(logsBefore);
  });

  it("is deterministic with the same commands", () => {
    const a = new World("eco-det", { size: "tiny" });
    const b = new World("eco-det", { size: "tiny" });
    placeConnected(a, "quarry");
    placeConnected(b, "quarry");
    run(a, 1500);
    run(b, 1500);
    expect(a.checksum()).toBe(b.checksum());
  });

  it("rejects invalid commands with a reason", () => {
    const w = new World("eco-bad", { size: "tiny" });
    const keep = w.economy.buildings[w.economy.keep]!;
    expect(w.command({ t: "build", type: "woodcutter", tile: keep.tile, flagTile: keep.flag }).ok).toBe(false);
    const r = w.command({ t: "demolish", tile: keep.tile });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Hearthship/);
  });

  it("splits a road with a flag and keeps goods flowing", () => {
    const w = new World("eco-split", { size: "tiny" });
    const eco = w.economy;
    placeConnected(w, "woodcutter", 5);
    const road = eco.roads.find((r) => r.alive && r.tiles.length >= 5)!;
    if (road) {
      const mid = road.tiles[Math.floor(road.tiles.length / 2)]!;
      const res = w.command({ t: "flag", tile: mid });
      if (res.ok) expect(eco.roads.filter((r) => r.alive).length).toBeGreaterThanOrEqual(2);
    }
    run(w, 2000);
    expect(eco.flags.filter((f) => f.alive).every((f) => f.goods.length <= 8)).toBe(true);
  });
});
