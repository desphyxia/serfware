import { describe, expect, it } from "vitest";
import { BUILDINGS, goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

describe("fair starts", () => {
  it("every start site scores within 5 % of the first (water, ore, soil, Star Well distance)", () => {
    for (const seed of [SEED, "amber-fern-212", "glade-iris-904"]) {
      const w = new World(seed, { size: "small", players: 4 });
      const s = w.economy.startScores;
      expect(s.length).toBe(4);
      const lo = Math.min(...s);
      const hi = Math.max(...s);
      expect(lo / hi).toBeGreaterThanOrEqual(0.95);
    }
  }, 60000);

  it("can be turned off", () => {
    const w = new World(SEED, { size: "small", players: 2, fairStarts: false });
    expect(w.economy.startScores.length).toBe(2);
  });
});

describe("teams", () => {
  const world = () => new World(SEED, { size: "small", players: 2, rivals: 2, teams: [0, 1, 0, 1], peaceDays: 0 });

  it("allies can't attack each other, share their sight, and may lay roads on each other's land", () => {
    const w = world();
    const eco = w.economy;
    w.step();
    expect(eco.allied(0, 2)).toBe(true);
    expect(eco.allied(0, 1)).toBe(false);
    expect(eco.attackBlocked(0, eco.buildings[eco.keeps[2]!]!)).toMatch(/ally/);
    for (let i = 0; i < 60; i++) w.step();
    const ally = eco.buildings[eco.keeps[2]!]!.tile;
    expect(eco.visible[0]![ally]).toBe(1);
    expect(eco.visible[0]![eco.buildings[eco.keeps[1]!]!.tile]).toBe(0);
    const land = w.land;
    const t = land.ring(ally, 3).find((x) => land.territory[x] === 3 && land.roadable(x, 2))!;
    expect(land.roadable(t, 0)).toBe(true);
    expect(land.roadable(t, 1)).toBe(false);
    expect(w.command({ t: "propose", to: 2, kind: "truce", player: 0 }).ok).toBe(false);
  });

  it("allies can send each other goods", () => {
    const w = world();
    const eco = w.economy;
    const plank = goodId("plank");
    const k0 = eco.buildings[eco.keeps[0]!]!;
    const k2 = eco.buildings[eco.keeps[2]!]!;
    const before = k2.stock[plank]!;
    expect(w.command({ t: "send", to: 2, good: "plank", count: 5, player: 0 }).ok).toBe(true);
    expect(k2.stock[plank]).toBe(before + 5);
    expect(k0.stock[plank]).toBeGreaterThanOrEqual(0);
    expect(w.command({ t: "send", to: 1, good: "plank", count: 5, player: 0 }).ok).toBe(false);
  });

  it("the last team standing wins together", () => {
    const w = world();
    const eco = w.economy;
    eco.defeated[1] = true;
    expect(eco.winner).toBe(-1);
    eco.defeated[3] = true;
    while (w.tick % 100 !== 99) w.step();
    w.step();
    expect(eco.winner === 0 || eco.winner === 2).toBe(true);
    expect(eco.notices.some((n) => n.owner === 2 && /Victory/.test(n.text))).toBe(true);
  });
});

describe("stewards", () => {
  it("keep an absent player's settlement running, and hand it back", () => {
    const w = new World(SEED, { size: "small", players: 2 });
    expect(w.command({ t: "steward", of: 1, on: true }).ok).toBe(true);
    expect(w.stewards.has(1)).toBe(true);
    expect(w.economy.aiPlayers.has(1)).toBe(true);
    const sum = w.checksum();
    const before = w.economy.buildings.filter((b) => b.alive && b.owner === 1).length;
    for (let i = 0; i < 2400; i++) w.step();
    expect(w.economy.buildings.filter((b) => b.alive && b.owner === 1).length).toBeGreaterThan(before);
    expect(w.command({ t: "steward", of: 1, on: false }).ok).toBe(true);
    expect(w.stewards.has(1)).toBe(false);
    expect(w.economy.notices.some((n) => n.owner === 0 && /back/.test(n.text))).toBe(true);
    expect(sum).not.toBe(0);
    // Only human players can be handed to a steward.
    expect(w.command({ t: "steward", of: 5, on: true }).ok).toBe(false);
  }, 30000);
});

describe("Bloom race", () => {
  it("the first colony to bloom wins it, for whoever built the most terraforming works there", () => {
    const w = new World(SEED, { size: "small", players: 2, goal: "bloom" });
    const planet = w.system.planets.findIndex((p, i) => i !== w.system.home && p.kind !== "gas");
    const eco = w.colonize(planet);
    const colony = w.colonies[planet]!;
    const terra = BUILDINGS.find((b) => b.terra)!;
    eco.buildings.push({ ...structuredClone(eco.buildings[0] ?? ({} as never)), id: eco.buildings.length, def: terra, owner: 1, alive: true, built: true } as never);
    colony.onBloom?.();
    expect(w.economy.winner).toBe(1);
    expect(w.economy.winReason).toBe("bloom");
  });
});
