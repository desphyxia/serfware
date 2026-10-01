import { describe, expect, it } from "vitest";
import { GRACE_DAYS, METEORITE, type Difficulty } from "../src/sim/econ/adversity";
import { BUILDINGS } from "../src/sim/econ/defs";
import { Feature, Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

function world(difficulty: Difficulty = "honest") {
  const w = new World(SEED, { size: "small", difficulty });
  return { w, eco: w.economy, land: w.land, adv: w.economy.adversity, keep: w.economy.buildings[w.economy.keeps[0]!]! };
}

/** Run the adversity clock alone from `from` to `to` (ticks), as the economy would. */
function run(w: World, from: number, to: number) {
  // Steps of 25 ticks, as the economy checks; run a step past `to` so a strike due then lands.
  for (let t = from - (from % 25); t < to + 25; t += 25) {
    w.economy.tick = t;
    w.economy.adversity.step(t);
  }
}

function build(w: World, type: string, near: number): number {
  const def = BUILDINGS.find((b) => b.id === type)!;
  for (let r = 1; r < 9; r++)
    for (const t of w.land.ring(near, r)) {
      const f = w.land.bestFlagTile(t, 0);
      if (f < 0 || !w.land.canBuildDef(t, f, def, 0)) continue;
      if (!w.command({ t: "build", type, tile: t, flagTile: f }).ok) continue;
      const b = w.economy.buildings[w.economy.buildings.length - 1]!;
      b.built = true;
      return b.tile;
    }
  throw new Error(`no site for ${type}`);
}

describe("adversity", () => {
  it("nothing in the first days; then trouble is foretold before it strikes, more often the harder the setting", () => {
    const count = (d: Difficulty) => {
      const { w, eco, adv } = world(d);
      run(w, 0, GRACE_DAYS * eco.dayTicks - 1);
      expect(adv.events.length).toBe(0);
      run(w, GRACE_DAYS * eco.dayTicks, 60 * eco.dayTicks);
      for (const e of adv.events) expect(e.at).toBeGreaterThan(e.warned);
      return adv.events.length;
    };
    const gentle = count("gentle");
    const hard = count("hard");
    expect(hard).toBeGreaterThan(gentle);
    expect(hard).toBeGreaterThan(3);
  });

  it("a flood drowns the low ground by the river, sets crops back, and leaves silt behind", () => {
    const { w, eco, land, adv, keep } = world();
    const river = land.ring(keep.tile, 10).find((t) => land.territory[t] === 1 && land.isRiver(t))!;
    expect(river).toBeDefined();
    const field = [river, ...land.ring(river, 1)].find((t) => land.isLand(t) && land.use[t] === Use.Free && land.feature[t] !== Feature.Rock)!;
    land.feature[field] = Feature.Field;
    land.amount[field] = 3;
    const soil = land.soil[field]!;
    const e = adv.foretell("flood", 0, river, w.tick);
    expect(eco.notices.some((n) => n.text.includes("river is rising"))).toBe(true);
    run(w, w.tick, e.at);
    expect(e.started).toBe(true);
    expect(e.tiles).toContain(river);
    expect(land.flooded[river]).toBe(1);
    if (e.tiles.includes(field)) expect(land.amount[field]).toBe(0);
    run(w, e.at, e.until + 25);
    expect(e.done).toBe(true);
    expect(land.flooded[river]).toBe(0);
    if (e.tiles.includes(field)) expect(land.soil[field]).toBeGreaterThan(soil);
  });

  it("blight spreads from field to field, spoils the harvest, and leaves hardier seed", () => {
    const { w, eco, land, adv, keep } = world("hard");
    const fields = land.ring(keep.tile, 6).filter((t) => land.isLand(t) && land.use[t] === Use.Free && land.feature[t] === Feature.None).slice(0, 12);
    for (const t of fields) {
      land.feature[t] = Feature.Field;
      land.amount[t] = 1;
    }
    const e = adv.foretell("blight", 0, fields[0]!, w.tick);
    run(w, w.tick, e.at + 20 * Math.round(eco.dayTicks / 24));
    expect(fields.filter((t) => adv.blight[t]).length).toBeGreaterThan(1);
    const before = eco.fieldGrowthTicks(fields[0]!);
    run(w, eco.tick, e.until + 25);
    expect(fields.every((t) => !adv.blight[t])).toBe(true);
    expect(eco.fieldGrowthTicks(fields[0]!)).toBeLessThan(before);
  });

  it("a cold snap chills the world for two days and the frost clears the rats from the stores", () => {
    const { w, adv, keep, eco } = world();
    const rats = adv.foretell("pests", 0, keep.tile, w.tick);
    const snap = adv.foretell("coldsnap", 0, -1, w.tick);
    run(w, w.tick, snap.at);
    expect(adv.cold).toBeLessThan(-5);
    const t0 = w.climate.temp[keep.tile]!;
    eco.step(snap.at + 25);
    w.climate.step(snap.at + 25);
    expect(w.climate.temp[keep.tile]!).toBeLessThan(t0 - 5);
    run(w, snap.at, snap.until + 25);
    expect(adv.cold).toBe(0);
    run(w, snap.until, snap.until + 100);
    expect(rats.done).toBe(true);
  });

  it("falling stars leave meteorites (iron and gold for a quarry); on Hard they flatten what they hit, on Gentle they miss", () => {
    const { w, land, adv, keep } = world();
    const e = adv.foretell("meteors", 0, keep.tile, w.tick);
    run(w, w.tick, e.until + 25);
    expect(e.done).toBe(true);
    const rocks = e.tiles.filter((t) => land.feature[t] === Feature.Rock && land.variety[t] === METEORITE);
    expect(rocks.length).toBeGreaterThan(0);
    for (const d of ["gentle", "hard"] as const) {
      const x = world(d);
      const at = build(x.w, "woodcutter", x.keep.tile);
      const hit = x.adv.foretell("meteors", 0, x.keep.tile, x.w.tick);
      run(x.w, x.w.tick, hit.at + 25);
      hit.tiles[0] = at;
      hit.times[0] = hit.at + 50;
      run(x.w, hit.at + 25, hit.at + 75);
      const b = x.eco.buildingAt(at);
      if (d === "gentle") expect(b?.alive && b.wear < 0.5).toBe(true);
      else expect(b?.alive ?? false).toBe(false);
    }
  });

  it("difficulty decides whether fire takes a building", () => {
    for (const [d, survives] of [["gentle", true], ["honest", false], ["hard", false]] as const) {
      const { w, eco, keep } = world(d);
      const at = build(w, "woodcutter", keep.tile);
      for (let i = 0; i < 4; i++) (eco as unknown as { scorchBuilding(t: number): void }).scorchBuilding(at);
      expect(!!eco.buildingAt(at)?.alive).toBe(survives);
    }
  });
});
