import { describe, expect, it } from "vitest";
import { BUILDINGS, buildingType, goodId } from "../src/sim/econ/defs";
import { LANTERN_GAP, LEVEL_SLOPE, MAX_LEVEL_SLOPE } from "../src/sim/econ/landuse";
import { placeConnected, placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";
import { Tools } from "../src/tools";

const SEED = "russet-heron-417";
const def = (id: string) => BUILDINGS[buildingType(id)]!;
const run = (w: World, n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    w.step();
    if (until && i % 25 === 0 && until()) return;
  }
};

describe("flags", () => {
  /** A long road off the keep's flag with a plain flag put on its middle tile. */
  function withMiddleFlag(w: World) {
    const eco = w.economy;
    expect(placeConnected(w, "woodcutter", { minDist: 6, maxDist: 9 })).toBe(true);
    const keep = eco.buildings[eco.keeps[0]!]!;
    const road = eco.roads.filter((r) => r.alive && (r.a === keep.flag || r.b === keep.flag)).sort((a, b) => b.tiles.length - a.tiles.length)[0]!;
    const original = road.a === keep.flag ? [...road.tiles] : [...road.tiles].reverse();
    const mid = original[Math.floor(original.length / 2)]!;
    expect(w.command({ t: "flag", tile: mid }).ok).toBe(true);
    return { original, mid, far: road.a === keep.flag ? road.b : road.a, keep };
  }

  it("taking away a flag that two roads pass through joins them into one road", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const { original, mid, far, keep } = withMiddleFlag(w);
    const before = eco.roads.filter((r) => r.alive).length;
    expect(w.command({ t: "demolish", tile: mid }).ok).toBe(true);
    const roads = eco.roads.filter((r) => r.alive);
    expect(roads.length).toBe(before - 1);
    const joined = roads.find((r) => (r.a === keep.flag && r.b === far) || (r.b === keep.flag && r.a === far))!;
    expect(joined).toBeTruthy();
    expect(joined.carrier).toBe(-1);
    const tiles = joined.a === keep.flag ? joined.tiles : [...joined.tiles].reverse();
    expect(tiles).toEqual(original);
    // The old flag tile is road now, and the network still carries goods.
    expect(w.land.use[mid]).toBe(2);
    run(w, 600);
    expect(eco.roads.find((r) => r.id === joined.id)!.carrier).toBeGreaterThanOrEqual(0);
  });

  it("a junction cannot be taken away while three roads meet there", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const { mid } = withMiddleFlag(w);
    // A third road off the middle flag makes it a junction.
    let third = false;
    for (const t of w.land.ring(mid, 4)) {
      if (t === mid || !w.land.canPlaceFlag(t, 0)) continue;
      const path = w.land.findPath(mid, t, (x) => w.land.roadable(x, 0) || x === mid || x === t, 200);
      if (!path || path.length < 3) continue;
      if (w.command({ t: "flag", tile: t }).ok && w.command({ t: "road", tiles: path }).ok) {
        third = true;
        break;
      }
    }
    expect(third).toBe(true);
    const junction = eco.flags.find((f) => f.alive && f.tile === mid);
    expect(junction!.roads.filter((r) => eco.roads[r]!.alive).length).toBeGreaterThanOrEqual(3);
    const roads = eco.roads.filter((r) => r.alive).length;
    const r = w.command({ t: "demolish", tile: junction!.tile });
    expect(r.ok).toBe(false);
    expect((r as { reason?: string }).reason).toMatch(/joins \d+ roads/);
    expect(junction!.alive).toBe(true);
    expect(eco.roads.filter((x) => x.alive).length).toBe(roads);
  }, 60000);
});

describe("buildings", () => {
  it("lantern buildings keep their distance from each other", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const own = w.land.ring(keep.tile, 9).filter((t) => w.land.territory[t] === 1);
    const at = placeOn(w, "lamphouse", own, 0, true, 80);
    expect(at).toBeGreaterThanOrEqual(0);
    // Near it, no other lantern building may go; further off, one still can.
    let blocked = 0;
    let free = 0;
    for (const t of w.land.ring(at, LANTERN_GAP + 3)) {
      if (w.land.use[t] !== 0) continue;
      const flag = w.land.bestFlagTile(t, 0);
      if (flag < 0) continue;
      const ok = w.land.canBuildDef(t, flag, def("lantern"), 0);
      const dist = w.land.ring(at, LANTERN_GAP - 1).includes(t);
      if (dist) {
        expect(ok).toBe(false);
        blocked++;
      } else if (ok) free++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
    // Other buildings are not held back by the lantern.
    const houseOk = w.land.ring(at, LANTERN_GAP - 1).some((t) => {
      const flag = w.land.bestFlagTile(t, 0);
      return w.land.use[t] === 0 && flag >= 0 && w.land.canBuildDef(t, flag, def("house"), 0);
    });
    expect(houseOk).toBe(true);
  });

  it("small buildings may touch each other, but never a large one", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const land = w.land;
    const keep = eco.buildings[eco.keeps[0]!]!;
    const house = def("house");
    const farm = def("farm");
    const spots = land.ring(keep.tile, 8).filter((t) => land.territory[t] === 1);
    const first = placeOn(w, "house", spots, 0, true, 80);
    expect(first).toBeGreaterThanOrEqual(0);
    let smallTouching = 0;
    for (const n of w.planet.grid.neighborsOf(first)) {
      if (land.use[n] !== 0) continue;
      for (const f of w.planet.grid.neighborsOf(n)) {
        if (f === first || !(land.use[f] === 1 || land.canPlaceFlag(f, 0))) continue;
        if (land.canBuildDef(n, f, house, 0)) {
          smallTouching++;
          break;
        }
      }
      // A large building never goes beside any building.
      for (const f of w.planet.grid.neighborsOf(n)) expect(land.canBuildDef(n, f, farm, 0)).toBe(false);
    }
    expect(smallTouching).toBeGreaterThan(0);
    // And a small one may not touch the Hearthship (large).
    for (const n of w.planet.grid.neighborsOf(keep.tile)) for (const f of w.planet.grid.neighborsOf(n)) expect(land.canBuildDef(n, f, house, 0)).toBe(false);
  });

  it("large buildings may go on a slope: the builder digs the ground level first", { timeout: 120000 }, () => {
    for (const seed of [SEED, "amber-fern-212", "glade-iris-904", "lantern-moss-55"]) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const land = w.land;
      const keep = eco.buildings[eco.keeps[0]!]!;
      const farm = def("farm");
      let site = -1;
      let flag = -1;
      for (const t of land.ring(keep.tile, 9)) {
        const s = land.slope(t);
        if (land.territory[t] !== 1 || !(s > LEVEL_SLOPE && s < MAX_LEVEL_SLOPE) || land.use[t] !== 0) continue;
        const f = land.bestFlagTile(t, 0);
        if (f >= 0 && land.canBuildDef(t, f, farm, 0)) {
          site = t;
          flag = f;
          break;
        }
      }
      if (site < 0) continue;
      expect(w.command({ t: "build", type: "farm", tile: site, flagTile: flag }).ok).toBe(true);
      const b = eco.buildings.find((x) => x.alive && x.tile === site)!;
      expect(b.dig).toBeGreaterThan(0);
      const dug = b.dig;
      // No materials are sent while the ground is rough.
      expect(eco.need(b, goodId("plank"))).toBe(0);
      // Connect it and let the builder come.
      expect(placeConnectedTo(w, flag)).toBe(true);
      run(w, 6000, () => b.dig === 0);
      expect(b.dig).toBe(0);
      expect(dug).toBeGreaterThan(0);
      run(w, 9000, () => b.built);
      expect(b.built).toBe(true);
      return;
    }
    throw new Error("No seed with a sloping site for a large building");
  });

  it("a gentle slope needs no digging, and a flat site is built at once", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    let seen = 0;
    for (const t of land.ring(keep.tile, 9)) if (land.slope(t) <= LEVEL_SLOPE) {
      expect(land.levelWork(t, true)).toBe(0);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(land.levelWork(keep.tile, false)).toBe(0);
  });
});

/** Connect a flag to the keep with a road along the planner's own route, so a builder can come. */
function placeConnectedTo(w: World, flagTile: number): boolean {
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[0]!]!;
  const from = (eco.flags[keep.flag] as { tile: number }).tile;
  const path = w.land.findPath(from, flagTile, (t) => w.land.roadable(t, 0) || t === from || t === flagTile, 4000);
  if (!path) return false;
  // Split long paths with flags every few tiles.
  let start = 0;
  for (let i = 3; i < path.length; i += 3) {
    const seg = path.slice(start, i + 1);
    const last = seg[seg.length - 1]!;
    const isEnd = i + 3 >= path.length;
    const to = isEnd ? flagTile : last;
    const tiles = isEnd ? path.slice(start) : seg;
    if (!isEnd && !w.land.canPlaceFlag(to, 0) && w.land.use[to] !== 1) continue;
    if (w.land.use[tiles[0]!] !== 1) w.command({ t: "flag", tile: tiles[0]! });
    const r = w.command({ t: "road", tiles });
    if (!r.ok && isEnd) return false;
    start = path.indexOf(to);
    if (isEnd) return true;
  }
  return w.command({ t: "road", tiles: path.slice(start) }).ok;
}

describe("placement reasons", () => {
  it("names a reason for every spot a building can't go, and none for spots it can", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const d = def("woodcutter");
    let ok = 0;
    let blocked = 0;
    for (let t = 0; t < land.territory.length; t++) {
      const flag = land.bestFlagTile(t, 0);
      const can = flag >= 0 && land.canBuildDef(t, flag, d, 0);
      const why = land.buildBlocker(t, d, 0);
      if (can) {
        expect(why).toBeNull();
        ok++;
      } else if (land.territory[t] === 1) {
        expect(why).toBeTruthy();
        blocked++;
      }
    }
    expect(ok).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("flag direction", () => {
  it("each compass sector picks a neighbour, and the six sectors reach distinct sides on a hex tile", () => {
    const w = new World(SEED, { size: "small" });
    const grid = w.planet.grid;
    const t = [...Array(grid.count).keys()].find((i) => grid.degree(i) === 6 && w.land.isLand(i))!;
    const picks = [0, 1, 2, 3, 4, 5].map((d) => w.land.neighborInDirection(t, d));
    for (const p of picks) expect(grid.neighborsOf(t)).toContain(p);
    expect(new Set(picks).size).toBe(6);
  });

  it("a blocked chosen side is explained", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const grid = land.planet.grid;
    const hut = def("woodcutter");
    const t = [...Array(grid.count).keys()].find((i) => land.territory[i] === 1 && land.buildBlocker(i, hut, 0) === null)!;
    const sides = [0, 1, 2, 3, 4, 5].map((d) => land.neighborInDirection(t, d));
    // Any side the building can't take is explained as a flag problem; the others come back clear.
    for (const side of sides) {
      const why = land.buildBlocker(t, hut, 0, false, side);
      expect(why === null || /flag can't go that way/.test(why)).toBe(true);
    }
  });
});

describe("rotating the flag", () => {
  it("only stops on sides where the building works", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const hut = def("woodcutter");
    const ov = { setPreview() {}, setGhost() {}, setMarkers() {}, setAnchor() {} };
    const dirs: (string | null)[] = [];
    const tools = new Tools({
      world: () => w,
      player: () => 0,
      overlays: () => ov as never,
      command: () => false,
      notify: () => {},
      select: () => {},
      toolChanged: () => {},
      flagDirChanged: (l) => dirs.push(l),
    });
    // A spot where some, but not all, sides take the flag.
    const t = [...Array(land.territory.length).keys()].find((i) => {
      if (land.territory[i] !== 1) return false;
      const ok = [0, 1, 2, 3, 4, 5].filter((d) => land.canBuildDef(i, land.neighborInDirection(i, d), hut, 0)).length;
      return ok > 1 && ok < 6;
    });
    if (t === undefined) return;
    tools.set("woodcutter");
    tools.hoverTile(t);
    for (let i = 0; i < 12; i++) {
      tools.rotateFlag(1);
      expect(land.buildBlocker(t, hut, 0, false, dirs.at(-1) === null ? -1 : land.neighborInDirection(t, ["north", "north-east", "south-east", "south", "south-west", "north-west"].indexOf(dirs.at(-1)!)))).toBeNull();
    }
  });
});

describe("touch placement", () => {
  it("the first tap shows the ghost, the second on the same spot places the building", () => {
    const w = new World(SEED, { size: "small" });
    const land = w.land;
    const hut = def("woodcutter");
    const ghosts: number[] = [];
    const ov = { setPreview() {}, setMarkers() {}, setAnchor() {}, setGhost: (_id: string | null, tile: number) => ghosts.push(tile) };
    const built: unknown[] = [];
    const tools = new Tools({
      world: () => w,
      player: () => 0,
      overlays: () => ov as never,
      command: (cmd) => {
        built.push(cmd);
        return true;
      },
      notify: () => {},
      select: () => {},
      toolChanged: () => {},
      flagDirChanged: () => {},
    });
    const t = [...Array(land.territory.length).keys()].find((i) => land.territory[i] === 1 && land.buildBlocker(i, hut, 0) === null)!;
    tools.set("woodcutter");
    tools.click(t, true);
    expect(built).toHaveLength(0);
    expect(ghosts.at(-1)).toBe(t);
    // Lifting the finger clears the hover, but the ghost stays for the second tap.
    tools.hoverTile(-1);
    expect(ghosts.at(-1)).toBe(t);
    tools.click(t, true);
    expect(built).toHaveLength(1);
  });
});
