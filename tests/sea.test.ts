import { describe, expect, it } from "vitest";
import { EXPLORE_REACH } from "../src/sim/econ/economy";
import { placeConnected, placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";
const explored = (w: World) => w.economy.explored[0]!.reduce((a, n) => a + n, 0);
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) w.step();
};

/** Steps from a tile to every other tile. */
function distances(w: World, from: number): Int16Array {
  const grid = w.planet.grid;
  const d = new Int16Array(grid.count).fill(-1);
  d[from] = 0;
  let edge = [from];
  while (edge.length) {
    const next: number[] = [];
    for (const t of edge)
      for (const n of grid.neighborsOf(t))
        if (d[n]! < 0) {
          d[n] = d[t]! + 1;
          next.push(n);
        }
    edge = next;
  }
  return d;
}

/** Own tiles on the open sea's shore (not a pond), the farthest from the Hearthship first. */
function seaside(w: World): number[] {
  const { land, planet } = w;
  const grid = planet.grid;
  // The largest body of water.
  const comp = new Int32Array(grid.count).fill(-1);
  const sizes: number[] = [];
  for (let t = 0; t < grid.count; t++) {
    if (comp[t]! >= 0 || land.isLand(t)) continue;
    let c = 0;
    const st = [t];
    comp[t] = sizes.length;
    while (st.length) {
      const u = st.pop()!;
      c++;
      for (const v of grid.neighborsOf(u))
        if (comp[v]! < 0 && !land.isLand(v)) {
          comp[v] = sizes.length;
          st.push(v);
        }
    }
    sizes.push(c);
  }
  const sea = sizes.indexOf(Math.max(...sizes));
  const keep = w.economy.buildings[w.economy.keep]!;
  const d = distances(w, keep.tile);
  return Array.from({ length: grid.count }, (_, t) => t)
    .filter((t) => land.territory[t] === 1 && land.isLand(t) && land.isCoast(t) && grid.neighborsOf(t).some((n) => comp[n] === sea))
    .sort((a, b) => d[b]! - d[a]! || a - b);
}

describe("exploring the sea", () => {
  it("fishing boats chart the water where they work", () => {
    const w = new World(SEED, { size: "small" });
    expect(placeOn(w, "fisher", seaside(w), 0, true, 80)).toBeGreaterThanOrEqual(0);
    const before = explored(w);
    run(w, 8000);
    expect(explored(w)).toBeGreaterThan(before);
  }, 120000);

  it("a lighthouse sees far over land and sea, and holds no land", () => {
    const w = new World(SEED, { size: "small" });
    expect(placeOn(w, "lighthouse", seaside(w), 0, true, 80)).toBeGreaterThanOrEqual(0);
    const house = w.economy.buildings.find((b) => b.alive && b.def.id === "lighthouse")!;
    const before = explored(w);
    const owned = w.land.territory.reduce((a, n) => a + (n === 1 ? 1 : 0), 0);
    run(w, 6000);
    expect(house.built).toBe(true);
    expect(explored(w)).toBeGreaterThan(before + 100);
    // It sees every tile within its sight, but claims no land.
    const d = distances(w, house.tile);
    const vis = w.economy.visible[0]!;
    for (let t = 0; t < d.length; t++) if (d[t]! >= 0 && d[t]! <= 16) expect(vis[t]).toBe(1);
    expect(w.land.territory.reduce((a, n) => a + (n === 1 ? 1 : 0), 0)).toBe(owned);
  }, 120000);

  it("a boatyard crew charts the sea out to the reach it is set to, and no further", () => {
    const w = new World(SEED, { size: "small" });
    expect(placeOn(w, "boatyard", seaside(w), 0, true, 80)).toBeGreaterThanOrEqual(0);
    const yard = w.economy.buildings.find((b) => b.alive && b.def.id === "boatyard")!;
    expect(w.command({ t: "explore", building: yard.id, reach: 0 }).ok).toBe(true);
    expect(w.command({ t: "explore", building: yard.id, reach: 3 }).ok).toBe(false);
    expect(w.command({ t: "explore", building: w.economy.keep, reach: 1 }).ok).toBe(false);
    run(w, 6000);
    expect(yard.built).toBe(true);
    const base = Uint8Array.from(w.economy.explored[0]!);
    run(w, 10 * w.economy.dayTicks);
    const after = Uint8Array.from(w.economy.explored[0]!);
    const d = distances(w, yard.tile);
    let gained = 0;
    let farthest = 0;
    for (let t = 0; t < after.length; t++)
      if (after[t] && !base[t]) {
        gained++;
        farthest = Math.max(farthest, d[t]!);
      }
    expect(gained).toBeGreaterThan(50);
    // Near is 10 steps out, plus what the crew sees from the end of its track.
    expect(farthest).toBeLessThanOrEqual(EXPLORE_REACH[0] + 8);
    // Far goes further than Near.
    expect(w.command({ t: "explore", building: yard.id, reach: 2 }).ok).toBe(true);
    run(w, 10 * w.economy.dayTicks);
    let farthest2 = 0;
    for (let t = 0; t < after.length; t++) if (w.economy.explored[0]![t] && !after[t]) farthest2 = Math.max(farthest2, d[t]!);
    expect(farthest2).toBeGreaterThan(farthest);
  }, 600000);

  it("charting is part of the state: two runs agree", () => {
    const make = () => {
      const w = new World(SEED, { size: "tiny" });
      placeConnected(w, "fisher", { minDist: 3, maxDist: 11 });
      run(w, 4000);
      return w.checksum();
    };
    expect(make()).toBe(make());
  }, 120000);
});
