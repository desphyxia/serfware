import { afterEach, describe, expect, it } from "vitest";
import { BUILDINGS, COMBAT, GOODS, goodId } from "../src/sim/econ/defs";
import { Deposit, Feature } from "../src/sim/econ/landuse";
import { placeConnected } from "../src/sim/econ/planner";
import { applyMods, EXAMPLE_MOD, validateMod, type ModPack } from "../src/sim/mods";
import { stroke, nearestTile, PAINT_REGIONS, type WorldPaint } from "../src/sim/planet/paint";
import { Biome } from "../src/sim/planet/terrain";
import { creativeOf, makeSave, replaySave, SoloSession } from "../src/net/session";
import type { ScenarioDef } from "../src/sim/scenario/scenario";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";
const BASE_GOODS = GOODS.length;
const BASE_BUILDINGS = BUILDINGS.length;

afterEach(() => applyMods([]));

describe("mods", () => {
  it("checks a pack before it is used", () => {
    expect(validateMod(EXAMPLE_MOD)).toEqual([]);
    expect(validateMod({ id: "X", name: "", version: 1 }).length).toBeGreaterThanOrEqual(3);
    const bad: ModPack = { id: "bad-mod", name: "Bad", version: "1", buildings: [{ id: "house", name: "H", description: "", category: "storage", cost: { gems: 2 } }], changes: { buildings: { keep: { terrain: "coast" } as never } } };
    const errors = validateMod(bad).join(" ");
    expect(errors).toMatch(/house already exists/);
    expect(errors).toMatch(/unknown good gems/);
    expect(errors).toMatch(/keep.terrain can't be changed/);
  });

  it("add goods, buildings and ranks to a world, and come off again", () => {
    const w = new World(SEED, { size: "small", mods: [EXAMPLE_MOD] });
    expect(GOODS.length).toBe(BASE_GOODS + 2);
    expect(BUILDINGS.find((b) => b.id === "ciderpress")?.produces).toBe("cider");
    expect(BUILDINGS.find((b) => b.id === "house")?.cost).toEqual({ plank: 2, stone: 1 });
    expect(COMBAT.ranks.length).toBe(6);
    // The new goods have room everywhere goods are counted.
    expect(w.economy.storageTotals(0).length).toBe(GOODS.length);
    expect(placeConnected(w, "ciderpress", { minDist: 3 })).toBe(true);
    for (let i = 0; i < 3000; i++) w.step();
    expect(w.economy.buildings.some((b) => b.alive && b.built && b.def.id === "ciderpress")).toBe(true);
    // A world without mods is the base game again (same objects, base values).
    new World(SEED, { size: "tiny" });
    expect(GOODS.length).toBe(BASE_GOODS);
    expect(BUILDINGS.length).toBe(BASE_BUILDINGS);
    expect(BUILDINGS.find((b) => b.id === "house")?.cost).not.toEqual({ plank: 2, stone: 1 });
    expect(COMBAT.ranks.length).toBe(5);
  }, 60000);

  it("a modded craft building turns its inputs into the new good", () => {
    const w = new World(SEED, { size: "small", mods: [EXAMPLE_MOD] });
    expect(placeConnected(w, "ciderpress", { minDist: 3 })).toBe(true);
    const press = w.economy.buildings.find((b) => b.def.id === "ciderpress")!;
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    keep.stock[goodId("fruit")] = 20;
    for (let i = 0; i < 9000 && !(press.built && press.output > 0); i++) w.step();
    expect(press.built).toBe(true);
    expect(press.output).toBeGreaterThan(0);
  }, 120000);

  it("are part of the world's state, saved and replayed", () => {
    const a = new World(SEED, { size: "tiny", mods: [EXAMPLE_MOD] });
    const plain = new World(SEED, { size: "tiny" });
    const b = new World(SEED, { size: "tiny", mods: [EXAMPLE_MOD] });
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(plain.checksum());
    const s = new SoloSession(new World(SEED, { size: "tiny", mods: [EXAMPLE_MOD] }));
    for (let i = 0; i < 20; i++) s.advance(100);
    const save = JSON.parse(JSON.stringify(makeSave(s, "modded", "dev")));
    expect(save.creative.mods[0].id).toBe("cider-press");
    applyMods([]);
    const { matches } = replaySave(save, { size: "tiny" });
    expect(matches).toBe(true);
    expect(BUILDINGS.some((x) => x.id === "ciderpress")).toBe(true);
  }, 60000);
});

describe("world painter", () => {
  const plain = () => new World(SEED, { size: "small" });
  const dirOf = (w: World, t: number): [number, number, number] => [w.planet.grid.center[t * 3]!, w.planet.grid.center[t * 3 + 1]!, w.planet.grid.center[t * 3 + 2]!];

  it("raises land, sinks sea and lays down regions where it is painted", () => {
    const base = plain();
    const keep = base.economy.buildings[base.economy.keeps[0]!]!.tile;
    const far = base.land.ring(keep, 12).find((t) => base.land.isLand(t) && base.planet.grid.degree(t) === 6)!;
    const sea = Array.from({ length: base.planet.grid.count }, (_, t) => t).find((t) => base.planet.terrain.elevation[t]! < -1)!;
    const paint: WorldPaint = {
      strokes: [stroke("raise", dirOf(base, far), 2, 1), stroke("raise", dirOf(base, sea), 2, 1), stroke("raise", dirOf(base, sea), 2, 1), stroke("raise", dirOf(base, sea), 2, 1), stroke("region", dirOf(base, keep), 3, 5)],
    };
    const w = new World(SEED, { size: "small", paint });
    expect(w.planet.terrain.elevation[far]!).toBeGreaterThan(base.planet.terrain.elevation[far]!);
    expect(w.planet.terrain.elevation[sea]!).toBeGreaterThan(base.planet.terrain.elevation[sea]!);
    const t = nearestTile(w.planet.grid, dirOf(base, keep));
    expect(w.planet.terrain.biome[t]).toBe(PAINT_REGIONS[5].biome);
    expect(w.planet.terrain.biome[t]).toBe(Biome.Desert);
  });

  it("plants woods, clears land and places ore", () => {
    const base = plain();
    const keep = base.economy.buildings[base.economy.keeps[0]!]!.tile;
    const spot = base.land.ring(keep, 9).find((t) => base.land.isLand(t) && base.land.ring(t, 2).every((n) => base.land.isLand(n)))!;
    const clearing = base.land.ring(keep, 14).find((t) => base.land.feature[t] === Feature.Tree)!;
    const w = new World(SEED, { size: "small", paint: { strokes: [stroke("forest", dirOf(base, spot), 2), stroke("clear", dirOf(base, clearing), 1), stroke("ore", dirOf(base, spot), 0, Deposit.Gold)] } });
    const trees = (x: World) => [spot, ...x.land.ring(spot, 2)].filter((t) => x.land.feature[t] === Feature.Tree).length;
    expect(trees(w)).toBeGreaterThan(trees(base));
    expect(w.land.feature[clearing]).not.toBe(Feature.Tree);
    expect(w.land.deposit[spot]).toBe(Deposit.Gold);
  });

  it("moves the Star Wells where they are placed", () => {
    const base = plain();
    // Spin the twelve wells a little about the y axis (the grid relaxes toward the places it is
    // given, so small moves land almost exactly and large ones part of the way).
    const a = 0.1;
    const wells = base.planet.grid.pentagons.map((p): [number, number, number] => {
      const [x, y, z] = dirOf(base, p);
      return [x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)];
    });
    const w = new World(SEED, { size: "small", paint: { wells, strokes: [] } });
    for (const target of wells) {
      const p = w.planet.grid.pentagons.reduce((best, q) => (dot(dirOf(w, q), target) > dot(dirOf(w, best), target) ? q : best));
      expect(dot(dirOf(w, p), target)).toBeGreaterThan(0.995);
    }
  });

  it("a painted world is deterministic and travels in saves", () => {
    const base = plain();
    const paint: WorldPaint = { strokes: [stroke("raise", dirOf(base, 100), 3, 0.8), stroke("forest", dirOf(base, 300), 2)] };
    const a = new World(SEED, { size: "small", paint });
    const b = new World(SEED, { size: "small", paint: JSON.parse(JSON.stringify(paint)) });
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(base.checksum());
    const s = new SoloSession(new World(SEED, { size: "tiny", paint }));
    for (let i = 0; i < 20; i++) s.advance(100);
    const { matches } = replaySave(JSON.parse(JSON.stringify(makeSave(s, "painted", "dev"))), { size: "tiny" });
    expect(matches).toBe(true);
  });
});

describe("custom scenarios", () => {
  const def: ScenarioDef = {
    id: "custom-test-1",
    kind: "custom",
    author: "Tester",
    title: "Three Houses",
    blurb: "Build three houses.",
    seed: SEED,
    opts: { size: "tiny", rivals: 1, mods: [EXAMPLE_MOD] },
    intro: "Shelter first.",
    goals: [{ text: "Build a woodcutter", when: { k: "build", type: "woodcutter" } }],
    triggers: [{ when: { k: "day", n: 0 }, do: [{ a: "give", good: "plank", n: 7 }] }],
    outro: "Done.",
  };

  it("are plain data: saved with the world and played again from the save", () => {
    const json = JSON.parse(JSON.stringify(def)) as ScenarioDef;
    const s = new SoloSession(new World(json.seed, { ...json.opts, scenario: json.id }));
    expect(s.world.scenario).toBeNull(); // not known on this machine until registered
    const made = creativeOf(s.world);
    expect(made?.mods?.[0]?.id).toBe("cider-press");
  });

  it("run their goals and triggers like built-in ones, and replay exactly", async () => {
    const { registerScenario } = await import("../src/sim/scenario/campaign");
    registerScenario(JSON.parse(JSON.stringify(def)));
    const s = new SoloSession(new World(def.seed, { ...def.opts, scenario: def.id }));
    const keep = s.world.economy.buildings[s.world.economy.keeps[0]!]!;
    const planks = keep.stock[goodId("plank")]!;
    // Goals and triggers are checked every 50 ticks.
    for (let i = 0; i < 50; i++) s.world.step();
    expect(s.world.scenario!.fired[0]).toBe(true);
    expect(keep.stock[goodId("plank")]).toBe(planks + 7);
    for (let i = 0; i < 10; i++) s.advance(100);
    const save = JSON.parse(JSON.stringify(makeSave(s, "custom", "dev")));
    expect(save.creative.custom.title).toBe("Three Houses");
    const { world, matches } = replaySave(save, { size: "tiny" });
    expect(matches).toBe(true);
    expect(world.scenario?.def.title).toBe("Three Houses");
  });
});

function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
