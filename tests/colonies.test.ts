import { describe, expect, it } from "vitest";
import { BUILDINGS, goodId, goodsArray } from "../src/sim/econ/defs";
import { ROOTED_BUILDINGS } from "../src/sim/econ/economy";
import { HEARTHSHIP_FRAME, PROBE_COST, SKYSHIP_FRAME, strideFor } from "../src/sim/system/voyages";
import { ticksPerDay } from "../src/sim/clock";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** Build a launch rail near the keep and finish it at once. */
function rail(w: World, planet = w.system.home, player = 0) {
  const eco = w.economyAt(planet)!;
  const land = eco.land;
  const def = BUILDINGS.find((b) => b.id === "launchrail")!;
  const keep = eco.buildings[eco.keeps[player]!]!;
  for (let r = 2; r < 9; r++) {
    for (const t of land.ring(keep.tile, r)) {
      const flag = land.bestFlagTile(t, player);
      if (flag < 0 || !land.canBuildDef(t, flag, def, player)) continue;
      if (!w.command({ t: "build", type: "launchrail", tile: t, flagTile: flag, player, planet }).ok) continue;
      const b = eco.buildings[eco.buildings.length - 1]!;
      b.built = true;
      return b;
    }
  }
  throw new Error("no rail site");
}

/** Put goods straight into a rail (as if the carriers had brought them). */
function stock(b: { stock: number[] }, rec: Record<string, number>) {
  goodsArray(rec).forEach((n, g) => (b.stock[g] = (b.stock[g] as number) + n));
}

/** Run the voyages alone (fast) until `done` or the tick budget runs out. */
function fly(w: World, done: () => boolean, budget = 400_000) {
  const end = w.tick + budget;
  while (!done() && w.tick < end) {
    w.tick += 25;
    w.economy.tick = w.tick;
    w.voyages!.step(w.tick);
  }
  expect(done()).toBe(true);
}

function target(w: World) {
  return w.system.planets.find((p) => p.surface && !p.home)!;
}

describe("colonisation", () => {
  it("a probe loads at the launch rail, flies any time and charts its planet", () => {
    const w = new World(SEED, { size: "tiny" });
    const to = target(w);
    expect(w.command({ t: "probe", from: w.system.home, to: to.index }).ok).toBe(false);
    const b = rail(w);
    expect(w.voyages!.isSurveyed(0, to.index)).toBe(false);
    expect(w.command({ t: "probe", from: w.system.home, to: to.index }).ok).toBe(true);
    // The rail asks carriers for the probe's parts.
    w.voyages!.step(w.tick - (w.tick % 25) + 25);
    expect(b.want?.[goodId("iron")]).toBe(PROBE_COST.iron);
    expect(w.economy.need(b, goodId("iron"))).toBeGreaterThan(0);
    stock(b, PROBE_COST);
    fly(w, () => w.voyages!.isSurveyed(0, to.index));
    expect(w.voyages!.notices.some((n) => n.text.includes("probe has reached"))).toBe(true);
    // No landing blind: a Hearthship needs a surveyed planet.
    const other = w.system.planets.find((p) => p.surface && !p.home && p.index !== to.index);
    if (other) expect(w.command({ t: "hearthship", from: w.system.home, to: other.index, settlers: 8, cargo: {} }).reason).toMatch(/probe/);
  });

  it("a Hearthship packs within its mass, waits for the window, lands where chosen and becomes a colony", () => {
    const w = new World(SEED, { size: "tiny" });
    const home = w.system.home;
    const to = target(w);
    const b = rail(w);
    w.voyages!.surveyed[0] = (w.voyages!.surveyed[0] ?? 0) | (1 << to.index);
    expect(w.command({ t: "hearthship", from: home, to: to.index, settlers: 40, cargo: {} }).reason).toMatch(/heavy/);
    expect(w.command({ t: "hearthship", from: home, to: to.index, settlers: 3, cargo: {} }).reason).toMatch(/founders/);
    const cargo = { plank: 16, stone: 12, bread: 10, axe: 2, hammer: 2, pick: 1 };
    expect(w.command({ t: "hearthship", from: home, to: to.index, settlers: 8, cargo }).ok).toBe(true);
    const people = w.economy.people.filter((p) => p.alive && p.owner === 0).length;
    stock(b, HEARTHSHIP_FRAME);
    stock(b, cargo);
    const v = w.voyages!.list[0]!;
    fly(w, () => v.state === "flying");
    // It left in the window, with its founders.
    expect(w.voyages!.windowAt(home, to.index, v.departs).open).toBe(true);
    expect(v.founders.length).toBe(8);
    expect(w.economy.people.filter((p) => p.alive && p.owner === 0).length).toBe(people - 8);
    fly(w, () => v.state === "orbit");
    // Landing: a bad site is refused, a good one founds the colony world.
    const eco = w.colonize(to.index);
    expect(w.command({ t: "land", voyage: v.id, tile: eco.land.region.findIndex((_, t) => !eco.land.isLand(t)) }).ok).toBe(false);
    const site = Array.from({ length: eco.land.region.length }, (_, t) => t).find((t) => eco.landingProblem(t) === null)!;
    expect(w.command({ t: "land", voyage: v.id, tile: site }).ok).toBe(true);
    const colony = w.colonies[to.index]!;
    expect(colony.tick).toBe(w.tick);
    const keep = colony.economy.buildings[colony.economy.keeps[0]!]!;
    expect(keep.tile).toBe(site);
    expect(keep.stock[goodId("bread")]).toBe(10);
    const settlers = colony.economy.people.filter((p) => p.alive);
    expect(settlers.length).toBe(8);
    // Traits by home world: their stride comes from the gravity they grew up with.
    for (const p of settlers) {
      expect(p.origin).toBe(home);
      expect(p.stride).toBeCloseTo(strideFor(w.planet.params.gravity, to.gravity));
      expect(p.journal.some((j) => j.includes("Hearthship"))).toBe(true);
    }
    // Both worlds run in lockstep from here, and the colony has not taken root yet.
    const t0 = w.tick;
    for (let i = 0; i < 200; i++) w.step();
    expect(colony.tick).toBe(t0 + 200);
    expect(colony.economy.rooted[0]).toBeFalsy();
    // A colony builds with what it brought, like a start: commands go to its planet.
    const r = w.command({ t: "flag", tile: colony.land.ring(site, 3).find((t) => colony.land.isLand(t))!, planet: to.index });
    expect(typeof r.ok).toBe("boolean");
  });

  it("colonies are deterministic: the same commands give the same checksum, colonies included", () => {
    const run = () => {
      const w = new World(SEED, { size: "tiny" });
      const to = target(w);
      const b = rail(w);
      w.voyages!.surveyed[0] = (w.voyages!.surveyed[0] ?? 0) | (1 << to.index);
      w.command({ t: "hearthship", from: w.system.home, to: to.index, settlers: 6, cargo: { plank: 8, bread: 6 } });
      stock(b, HEARTHSHIP_FRAME);
      stock(b, { plank: 8, bread: 6 });
      const v = w.voyages!.list[0]!;
      fly(w, () => v.state === "orbit");
      const eco = w.colonize(to.index);
      const site = Array.from({ length: eco.land.region.length }, (_, t) => t).find((t) => eco.landingProblem(t) === null)!;
      w.command({ t: "land", voyage: v.id, tile: site });
      for (let i = 0; i < 300; i++) w.step();
      return w.checksum();
    };
    expect(run()).toBe(run());
  });

  it("skyships run trade routes at each window; their calls slow the colony's drift from home", () => {
    const w = new World(SEED, { size: "tiny" });
    const home = w.system.home;
    const to = target(w);
    const b = rail(w);
    w.voyages!.surveyed[0] = (w.voyages!.surveyed[0] ?? 0) | (1 << to.index);
    expect(w.command({ t: "route", from: home, to: to.index, good: "bread", amount: 5 }).reason).toMatch(/no one/);
    w.command({ t: "hearthship", from: home, to: to.index, settlers: 6, cargo: {} });
    stock(b, HEARTHSHIP_FRAME);
    const v = w.voyages!.list[0]!;
    fly(w, () => v.state === "orbit");
    const eco = w.colonize(to.index);
    const site = Array.from({ length: eco.land.region.length }, (_, t) => t).find((t) => eco.landingProblem(t) === null)!;
    w.command({ t: "land", voyage: v.id, tile: site });
    eco.drift[0] = 0.5;
    expect(w.command({ t: "route", from: home, to: to.index, good: "bread", amount: 5 }).ok).toBe(true);
    const route = w.voyages!.routes[0]!;
    stock(b, SKYSHIP_FRAME);
    stock(b, { bread: 5 });
    fly(w, () => route.runs === 1);
    const keep = eco.buildings[eco.keeps[0]!]!;
    expect(keep.stock[goodId("bread")]).toBe(5);
    expect(eco.drift[0]).toBeLessThan(0.5);
    // The next run is already loading at the rail; stopping the route cancels it.
    expect(w.voyages!.list.some((x) => x.route === route.id && x.state === "loading")).toBe(true);
    expect(w.command({ t: "unroute", route: route.id }).ok).toBe(true);
    expect(w.voyages!.list.some((x) => x.route === route.id && (x.state === "loading" || x.state === "waiting"))).toBe(false);
  });

  it("a colony takes root once enough is built; only then do newcomers come and a launch rail go up", () => {
    const w = new World(SEED, { size: "tiny" });
    const home = w.system.home;
    const to = target(w);
    const b = rail(w);
    w.voyages!.surveyed[0] = (w.voyages!.surveyed[0] ?? 0) | (1 << to.index);
    w.command({ t: "hearthship", from: home, to: to.index, settlers: 6, cargo: { plank: 30, stone: 30 } });
    stock(b, HEARTHSHIP_FRAME);
    stock(b, { plank: 30, stone: 30 });
    const v = w.voyages!.list[0]!;
    fly(w, () => v.state === "orbit");
    const eco = w.colonize(to.index);
    const site = Array.from({ length: eco.land.region.length }, (_, t) => t).find((t) => eco.landingProblem(t) === null)!;
    w.command({ t: "land", voyage: v.id, tile: site });
    const colony = w.colonies[to.index]!;
    const land = colony.land;
    const railDef = BUILDINGS.find((d) => d.id === "launchrail")!;
    const railSite = land.ring(site, 3).find((t) => land.canBuildDef(t, land.bestFlagTile(t, 0), railDef, 0))!;
    expect(w.command({ t: "build", type: "launchrail", tile: railSite, flagTile: land.bestFlagTile(railSite, 0), planet: to.index }).reason).toMatch(/root/);
    // Put up enough houses (finished at once) and let a day pass.
    const house = BUILDINGS.find((d) => d.id === "house")!;
    for (let r = 2; r < 7 && eco.buildings.filter((x) => x.alive && x.def.id === "house").length < ROOTED_BUILDINGS; r++) {
      for (const t of land.ring(site, r)) {
        const f = land.bestFlagTile(t, 0);
        if (f >= 0 && land.canBuildDef(t, f, house, 0)) w.command({ t: "build", type: "house", tile: t, flagTile: f, planet: to.index });
      }
    }
    for (const x of eco.buildings) if (x.alive) x.built = true;
    expect(eco.buildings.filter((x) => x.alive && !x.def.storage).length).toBeGreaterThanOrEqual(ROOTED_BUILDINGS);
    const perDay = ticksPerDay(colony.planet.params.dayLengthHours);
    const day = Math.ceil((colony.tick + 1) / perDay) * perDay;
    eco.step(day);
    expect(eco.rooted[0]).toBe(true);
    expect(eco.drift[0]).toBeGreaterThan(0);
    expect(eco.notices.some((n) => n.text.includes("taken root"))).toBe(true);
  });
});
