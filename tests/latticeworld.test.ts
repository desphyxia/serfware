import { describe, expect, it } from "vitest";
import { Use } from "../src/sim/econ/landuse";
import { BUILDINGS, buildingType } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

/** Lay a road of flags and roads along the lattice route between two flags. */
function connect(w: World, from: number, to: number, gap = 3): boolean {
  const land = w.land;
  const route = land.lattice!.findPath(from, to, (n) => land.roadable(n, 0) || land.use[n] === Use.Flag, 4000);
  if (!route) return false;
  let last = 0;
  for (let i = 1; i < route.length; i++) {
    const end = i === route.length - 1;
    const isFlag = land.use[route[i]!] === Use.Flag;
    if (!end && !isFlag && (i - last < gap || !land.canPlaceFlag(route[i]!, 0))) continue;
    if (land.use[route[i]!] !== Use.Flag && !w.command({ t: "flag", tile: route[i]! }).ok && !end) continue;
    const r = w.command({ t: "road", tiles: route.slice(last, i + 1) });
    if (!r.ok) {
      console.log("road failed", (r as { reason?: string }).reason, last, i, route.length);
      return false;
    }
    last = i;
  }
  return true;
}

function site(w: World, id: string, near: number, minR = 2): { tile: number; flag: number } | null {
  const land = w.land;
  const def = BUILDINGS[buildingType(id)]!;
  for (const t of land.ring(near, 7)) {
    if (land.ring(near, minR).includes(t)) continue;
    const flag = land.bestFlagTile(t, 0);
    if (flag >= 0 && land.canBuildDef(t, flag, def, 0)) return { tile: t, flag };
  }
  return null;
}

describe("lattice roads world", () => {
  it("starts a world with the Hearthship's flag on a tile corner", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const flag = eco.flags[keep.flag]!;
    expect(flag.tile).toBeGreaterThanOrEqual(w.land.tileCount);
    expect(w.land.nbrs(keep.tile).includes(flag.tile)).toBe(true);
  });

  it("builds, connects and runs a small settlement", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const keepFlag = eco.flags[keep.flag]!;
    const placed: string[] = [];
    for (const id of ["woodcutter", "sawmill", "house"]) {
      const s = site(w, id, keep.tile);
      if (!s) { console.log("no site for", id); continue; }
      const r = w.command({ t: "build", type: id, tile: s.tile, flagTile: s.flag });
      console.log("build", id, JSON.stringify(r));
      if (!r.ok) continue;
      const ok = connect(w, s.flag, keepFlag.tile);
      console.log("connect", id, ok);
      placed.push(id);
    }
    expect(placed.length).toBeGreaterThan(0);
    for (let i = 0; i < 6000; i++) w.step();
    console.log("carriers", eco.settlers.filter((s) => s.alive && s.role === "carrier").length, "roads", eco.roads.filter((r) => r.alive).length, "flags", eco.flags.filter((f) => f.alive).length);
    console.log("buildings built", eco.buildings.filter((b) => b.built).length, "of", eco.buildings.length);
    for (const s of eco.settlers) if (s.alive) for (const p of s.path) expect(Number.isFinite(p) && p >= 0 && p < land.nodes).toBe(true);
  });
});

describe("lattice flags on tile centres", () => {
  it("allows a flag on a free tile centre, but not beside another flag", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const land = w.land;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const centre = land.ring(keep.tile, 5).find((t) => land.canPlaceFlag(t, 0));
    expect(centre).toBeDefined();
    expect(w.command({ t: "flag", tile: centre! }).ok).toBe(true);
    const next = land.nbrs(centre!)[0]!;
    expect(land.canPlaceFlag(next, 0)).toBe(false);
  });
});

describe("lattice flags beside the Hearthship", () => {
  it("allows a flag on reserved (Blocked) tile centres, as it does on corners", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const land = w.land;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const blocked = land.ring(keep.tile, 4).find((t) => land.use[t] === Use.Blocked && land.isLand(t) && !land.nbrs(t).some((n) => land.use[n] === Use.Flag));
    expect(blocked).toBeDefined();
    expect(land.canPlaceFlag(blocked!, 0)).toBe(true);
  });
});

describe("lattice buildings on tile corners", () => {
  /** A free lattice node near `near`, at least `minSteps` away, where `id` can stand. */
  function cornerSite(w: World, id: string, near: number, minSteps: number): { tile: number; flag: number } | null {
    const land = w.land;
    const def = BUILDINGS[buildingType(id)]!;
    const seen = new Set<number>([near]);
    const queue = [near];
    const depth = new Map<number, number>([[near, 0]]);
    for (let i = 0; i < queue.length && i < 600; i++) {
      const n = queue[i]!;
      for (const m of land.nbrs(n)) if (!seen.has(m)) {
        seen.add(m);
        depth.set(m, depth.get(n)! + 1);
        queue.push(m);
      }
    }
    for (const n of queue) {
      if (n < land.tileCount || (depth.get(n) as number) < minSteps) continue;
      const flag = land.bestFlagTile(n, 0);
      if (flag >= 0 && land.canBuildDef(n, flag, def, 0)) return { tile: n, flag };
    }
    return null;
  }

  it("builds, connects and runs buildings that stand on corners", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const keepFlag = eco.flags[keep.flag]!;
    const placed: number[] = [];
    for (const id of ["woodcutter", "sawmill", "house", "quarry", "forester"]) {
      const s = cornerSite(w, id, keep.tile, 4);
      if (!s) continue;
      const r = w.command({ t: "build", type: id, tile: s.tile, flagTile: s.flag });
      if (!r.ok) continue;
      expect(connect(w, s.flag, keepFlag.tile)).toBe(true);
      placed.push(s.tile);
    }
    expect(placed.length).toBeGreaterThanOrEqual(3);
    expect(placed.every((t) => t >= land.tileCount)).toBe(true);
    for (let i = 0; i < 8000; i++) w.step();
    const mine = eco.buildings.filter((b) => b.alive && b.tile >= land.tileCount);
    expect(mine.filter((b) => b.built).length).toBeGreaterThanOrEqual(3);
    for (const b of mine) for (const v of [...b.stock, ...b.cost, b.wear, b.soot, b.moss]) expect(Number.isFinite(v)).toBe(true);
    for (const s of eco.settlers) if (s.alive) for (const p of s.path) expect(Number.isFinite(p) && p >= 0 && p < land.nodes).toBe(true);
    expect(eco.buildings.some((b) => b.alive && b.built && b.def.id === "woodcutter" && b.tile >= land.tileCount)).toBe(true);
  });

  it("keeps a corner building away from the large Hearthship", () => {
    const w = new World(SEED, { size: "small", latticeRoads: true });
    const land = w.land;
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    const def = BUILDINGS[buildingType("house")]!;
    for (const n of land.nbrs(keep.tile)) for (const m of land.nbrs(n)) {
      if (m === keep.tile || m >= land.nodes) continue;
      const flag = land.bestFlagTile(m, 0);
      if (flag >= 0) expect(land.canBuildDef(m, flag, def, 0)).toBe(false);
    }
  });
});
