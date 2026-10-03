import { afterEach, describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { VoyagePlanner } from "../src/sim/ai/voyage";
import { Rng } from "../src/sim/rng";
import { World } from "../src/sim/world";

function tally(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of w.aiLog) {
    if (!a.ok) continue;
    const k = a.cmd.t === "build" ? `build:${(a.cmd as { type: string }).type}` : a.cmd.t;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const found = { ...VoyagePlanner.found };
afterEach(() => {
  VoyagePlanner.found = { ...found };
});

describe("the AI in space", () => {
  it("a steward builds a launch rail, surveys the system, and sends a Hearthship down", { timeout: 900000 }, () => {
    VoyagePlanner.found = { population: 20, idle: 0 };
    const w = new World("amber-fern-212", { size: "small" });
    w.command({ t: "steward", of: 0, on: true });
    w.recordAi = true;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    for (let i = 0; i < 90 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["iron", "plank", "stone", "log", "bread"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40);
      w.step();
    }
    const t = tally(w);
    expect(t["build:launchrail"] ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
    expect(t.probe ?? 0, JSON.stringify(t)).toBeGreaterThan(0);
    expect(w.voyages!.list.some((v) => v.owner === 0 && v.kind === "probe"), "a probe flew").toBe(true);
    expect(t.hearthship ?? 0, `${JSON.stringify(t)} voyages ${JSON.stringify(w.voyages!.list.map((v) => [v.kind, v.state]))}`).toBeGreaterThan(0);
  });

  it("a rival seat flies, lands, and its colony is managed by a brain of its own", { timeout: 900000 }, () => {
    VoyagePlanner.found = { population: 20, idle: 0 };
    const w = new World("amber-fern-212", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
    expect(w.humans).toBe(1);
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[1]!]!;
    const tools = ["hammer", "axe", "pick", "saw", "shovel", "scythe"];
    for (let i = 0; i < 25 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["iron", "plank", "stone", "log", "bread", ...tools]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40);
      w.step();
    }
    expect(w.voyages!.list.some((v) => v.owner === 1 && v.kind === "hearthship"), "the rival sent a Hearthship").toBe(true);
    const colony = w.colonies.find((c) => c && c.economy.keeps[1] !== undefined);
    expect(colony, "the rival holds a colony").toBeDefined();
    const built = colony!.economy.buildings.filter((b) => b.alive && b.built && b.owner === 1).length;
    expect(built, "the colony's brain builds").toBeGreaterThan(3);
  });

  it("a Warden never voyages, even when it could", { timeout: 300000 }, () => {
    VoyagePlanner.found = { population: 20, idle: 0 };
    const w = new World("amber-fern-212", { size: "small", rivals: 1, personalities: ["warden"], peaceDays: 99 });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[1]!]!;
    for (let i = 0; i < 10 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["iron", "plank", "stone", "log"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40);
      w.step();
    }
    expect(w.voyages!.list.filter((v) => v.owner === 1)).toEqual([]);
  });
});

describe("the AI and terraforming", () => {
  it("a steward keeps a colony and raises works where the world is not yet alive", { timeout: 900000 }, () => {
    const w = new World("amber-fern-212", { size: "small" });
    w.command({ t: "steward", of: 0, on: true });
    const planet = w.system.planets.find((p) => p.surface && p.index !== w.system.home)!;
    const eco = w.colonize(planet.index);
    const colony = w.colonies[planet.index]!;
    colony.recordAi = true;
    const grid = eco.land.planet.grid;
    let site = -1;
    for (let t = 0; t < grid.count && site < 0; t++) if (!eco.landingProblem(t)) site = t;
    expect(site).toBeGreaterThanOrEqual(0);
    eco.settleAt(site, new Rng("test-landing"), 0);
    const keep = eco.buildings[eco.keeps[0]!]!;
    for (let i = 0; i < 70 * eco.dayTicks; i++) {
      if (i % eco.dayTicks === 0) for (const g of ["iron", "plank", "stone", "log", "coal"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40);
      w.step();
    }
    const t = tally(colony);
    expect(t["build:house"] ?? 0, `the steward runs the colony: ${JSON.stringify(t)}`).toBeGreaterThan(0);
    const works = ["mirrorworks", "greenhouseworks", "cometcatcher", "lakebasin", "cloudseeder", "seedhouse", "genebank", "reserve"].filter((x) => (t[`build:${x}`] ?? 0) > 0);
    expect(works.length, JSON.stringify(t)).toBeGreaterThan(0);
  });
});
