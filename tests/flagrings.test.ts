import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { FLAG_CAPACITY, transportOptions, type Economy } from "../src/sim/econ/economy";
import { World } from "../src/sim/world";

/** What the game plays with when nothing sets it; each test starts with the rule off and turns it on where it needs it. */
const DEFAULT_BREAK_RINGS = transportOptions.breakRings;
beforeEach(() => {
  transportOptions.breakRings = false;
});
afterEach(() => {
  transportOptions.breakRings = DEFAULT_BREAK_RINGS;
});

const SEED = "flag-rings-9";
const PLANK = goodId("plank");
const SIDES = 6;

/** Private parts of the economy the test reaches into. */
const inside = (eco: Economy) => eco as unknown as { spawnGood(type: number, flag: number): { id: number; type: number; dest: number } };

/** The 12 tiles two steps from `c`, in the order a road would walk them round it, or null if they do not make a ring. */
function walkRound(w: World, c: number): number[] | null {
  const grid = w.land.planet.grid;
  const near = new Set(grid.neighborsOf(c));
  const outer = w.land.ring(c, 2).filter((t) => t !== c && !near.has(t));
  if (outer.length !== 12) return null;
  const order: number[] = [outer[0] as number];
  while (order.length < 12) {
    const next = grid.neighborsOf(order[order.length - 1] as number).find((n) => outer.includes(n) && !order.includes(n));
    if (next === undefined) return null;
    order.push(next);
  }
  return grid.neighborsOf(order[11] as number).includes(order[0] as number) ? order : null;
}

/** Where a ring of six flags round some tile near the keep would fit: the walk round it and a house spot beside each flag. */
function fitting(w: World): { order: number[]; spots: number[] } | null {
  const land = w.land;
  const grid = land.planet.grid;
  const keep = w.economy.buildings[w.economy.keeps[0] as number] as { tile: number };
  for (const c of land.ring(keep.tile, 16)) {
    if (land.territory[c] !== 1) continue;
    const order = walkRound(w, c);
    if (!order || !order.every((t) => land.roadable(t, 0))) continue;
    const flags = [0, 1, 2, 3, 4, 5].map((i) => order[2 * i] as number);
    if (!flags.every((t) => land.canPlaceFlag(t, 0))) continue;
    const near = new Set(grid.neighborsOf(c));
    const used = new Set<number>();
    const spots: number[] = [];
    for (const f of flags) {
      const spot = grid.neighborsOf(f).find((n) => near.has(n) && !used.has(n) && land.canBuild(n, f, false, 0));
      if (spot === undefined) break;
      used.add(spot);
      spots.push(spot);
    }
    if (spots.length === SIDES) return { order, spots };
  }
  return null;
}

/**
 * A ring of six flags joined by roads, a woodcutter beside each flag, and eight planks on every flag bound for the woodcutter two
 * flags on: every flag is full and all its goods go the same way round.
 */
function ring(perFlag = FLAG_CAPACITY) {
  const w = new World(SEED, { size: "tiny", players: 1 });
  const where = fitting(w);
  if (!where) return null;
  const { order, spots } = where;
  const eco = w.economy;
  const flagTiles = [0, 1, 2, 3, 4, 5].map((i) => order[2 * i] as number);
  for (const t of flagTiles) expect(w.command({ t: "flag", tile: t, player: 0 }), "flag").toMatchObject({ ok: true });
  for (let i = 0; i < SIDES; i++) {
    const tiles = [order[2 * i], order[2 * i + 1], order[(2 * i + 2) % 12]] as number[];
    expect(w.command({ t: "road", tiles, player: 0 }), "road").toMatchObject({ ok: true });
  }
  // A road from the keep, so that carriers can walk out to the ring.
  const keepFlag = eco.flags[(eco.buildings[eco.keeps[0] as number] as { flag: number }).flag] as { tile: number };
  const link = w.land.findPath(keepFlag.tile, flagTiles[0] as number, (x) => w.land.roadable(x, 0), 1500);
  expect(link, "link").not.toBeNull();
  expect(w.command({ t: "road", tiles: link as number[], player: 0 }), "link road").toMatchObject({ ok: true });
  const homes: number[] = [];
  for (let i = 0; i < SIDES; i++) {
    expect(w.command({ t: "build", type: "woodcutter", tile: spots[i] as number, flagTile: flagTiles[i] as number, player: 0 }), "build").toMatchObject({ ok: true });
    homes.push((eco.buildings.find((b) => b.alive && b.tile === spots[i]) as { id: number }).id);
  }
  const flagIds = flagTiles.map((t) => (eco.flagAt(t) as { id: number }).id);
  for (let i = 0; i < SIDES; i++) {
    const target = eco.buildings[homes[(i + 2) % SIDES] as number] as { pending: number[] };
    for (let k = 0; k < perFlag; k++) {
      inside(eco).spawnGood(PLANK, flagIds[i] as number).dest = homes[(i + 2) % SIDES] as number;
      target.pending[PLANK] = (target.pending[PLANK] ?? 0) + 1;
    }
  }
  return { w, flagIds };
}

const goodsOn = (g: { w: World; flagIds: number[] }) => g.flagIds.reduce((n, id) => n + (g.w.economy.flags[id]?.goods.length ?? 0), 0);

describe("a ring of full flags (#149)", () => {
  it("is on by default (#169)", () => {
    expect(DEFAULT_BREAK_RINGS).toBe(true);
  });

  it("moves goods round a ring that has room (the carriers get there)", () => {
    const loose = ring(2);
    expect(loose).not.toBeNull();
    for (let i = 0; i < 3 * loose!.w.economy.dayTicks; i++) loose!.w.step();
    expect(goodsOn(loose!)).toBeLessThan(SIDES * 2);
  }, 120000);

  it("stays stuck for good when every good on it goes the same way round", () => {
    const stuck = ring();
    expect(stuck).not.toBeNull();
    expect(goodsOn(stuck!)).toBe(SIDES * FLAG_CAPACITY);
    for (let i = 0; i < 3 * stuck!.w.economy.dayTicks; i++) stuck!.w.step();
    expect(goodsOn(stuck!)).toBe(SIDES * FLAG_CAPACITY);
    expect(stuck!.w.economy.ringBreaks).toBe(0);
  }, 120000);

  it("turns with breakRings on, one step at a time, and delivers", () => {
    transportOptions.breakRings = true;
    const turning = ring();
    expect(turning).not.toBeNull();
    for (let i = 0; i < 3 * turning!.w.economy.dayTicks; i++) turning!.w.step();
    expect(turning!.w.economy.ringBreaks).toBeGreaterThan(0);
    expect(goodsOn(turning!)).toBeLessThan(SIDES * FLAG_CAPACITY);
    // No flag ever holds more than one over its capacity.
    for (const id of turning!.flagIds) expect(turning!.w.economy.flags[id]!.goods.length).toBeLessThanOrEqual(FLAG_CAPACITY + 1);
  }, 120000);
});

describe("a flag's last place (the old 9-good flags)", () => {
  /** A carrier standing at one end of a road of the ring, carrying a good from the other end, with `held` goods on the flag it is at and `reserved` places promised there. */
  function carrierAt(held: number, reserved: number) {
    const r = ring(0);
    expect(r).not.toBeNull();
    const eco = r!.w.economy;
    for (let i = 0; i < eco.dayTicks / 2; i++) r!.w.step();
    const road = eco.roads.find((x) => x.alive && r!.flagIds.includes(x.a) && r!.flagIds.includes(x.b) && (eco.settlers[x.carrier]?.alive ?? false));
    expect(road).toBeDefined();
    const at = road!.a;
    const away = road!.b;
    const flag = eco.flags[at]!;
    const own = eco.buildings.find((b) => b.alive && b.flag === at)!;
    for (let k = 0; k < held; k++) inside(eco).spawnGood(PLANK, at).dest = own.id;
    flag.reserved = reserved;
    // The good the carrier brings: off its flag, bound for the building at the other end.
    const carried = inside(eco).spawnGood(PLANK, away);
    eco.flags[away]!.goods.pop();
    carried.dest = own.id;
    const s = eco.settlers[road!.carrier]!;
    Object.assign(s, { carryGood: carried.id, carrying: carried.type, target: -1, back: -1, roadIdx: 0 });
    const drop = () => (eco as unknown as { dropAt(s: unknown, road: unknown, at: number): boolean }).dropAt(s, road, at);
    return { flag, drop, s, at, eco, road: road!, away, carried };
  }

  it("a carrier with no place promised to it does not take the last one that is promised to another", () => {
    const { flag, drop } = carrierAt(FLAG_CAPACITY - 1, 1);
    expect(drop()).toBe(false);
    expect(flag.goods.length).toBe(FLAG_CAPACITY - 1);
  }, 120000);

  it("but puts its good down when a place is free", () => {
    const { flag, drop } = carrierAt(FLAG_CAPACITY - 2, 1);
    expect(drop()).toBe(true);
    expect(flag.goods.length).toBe(FLAG_CAPACITY - 1);
  }, 120000);

  it("a carrier with a promised place uses it when the flag still has room (#163)", () => {
    const { flag, drop, s, at } = carrierAt(FLAG_CAPACITY - 1, 1);
    s.target = at;
    expect(drop()).toBe(true);
    expect(flag.goods.length).toBe(FLAG_CAPACITY);
    expect(flag.reserved).toBe(0);
  }, 120000);

  it("but gives the promise up and waits when goods put down since filled the flag (#163)", () => {
    const { flag, drop, s, at } = carrierAt(FLAG_CAPACITY, 1);
    s.target = at;
    expect(drop()).toBe(false);
    expect(flag.goods.length).toBe(FLAG_CAPACITY);
    expect(flag.reserved).toBe(0);
    expect(s.target).toBe(-1);
  }, 120000);

  it("a swap given up when the good goes into a building keeps no place and holds no good (#186)", () => {
    // The carrier walks its good into the woodcutter at `at`. A swap was begun on the way: a place kept at the flag behind and a
    // good on this flag promised to go back. Neither may outlast the trip.
    const { s, at, eco, road, away } = carrierAt(0, 0);
    const back = eco.buildings.find((b) => b.alive && b.flag === away)!;
    const promised = inside(eco).spawnGood(PLANK, at);
    promised.dest = back.id;
    (promised as unknown as { carrier: number }).carrier = s.id;
    const behind = eco.flags[away]!;
    const before = behind.reserved;
    behind.reserved++;
    const end = road.tiles.length - 1;
    // `carry` turns roadIdx round on arrival: start it at the far end so the carrier stands at `at`.
    Object.assign(s, { state: "carry", back: away, roadIdx: at === road.a ? end : 0, path: [road.tiles[at === road.a ? 0 : end]], pi: 0 });
    (eco as unknown as { stepCarrier(s: unknown): void }).stepCarrier(s);
    expect(s.state).toBe("enter");
    expect(s.back).toBe(-1);
    expect(behind.reserved).toBe(before);
    expect((promised as unknown as { carrier: number }).carrier).toBe(-1);
  }, 120000);

  it("a good promised for a swap but rerouted since is free when another goes back (#186)", () => {
    // Two goods on `at`: one promised to the carrier but now bound for the woodcutter here, one bound back over the road. The
    // carrier puts its good down and takes the second back; the first is no longer held for it.
    const { s, at, eco, away, drop } = carrierAt(0, 0);
    const own = eco.buildings.find((b) => b.alive && b.flag === at)!;
    const back = eco.buildings.find((b) => b.alive && b.flag === away)!;
    const stale = inside(eco).spawnGood(PLANK, at);
    stale.dest = own.id;
    (stale as unknown as { carrier: number }).carrier = s.id;
    const going = inside(eco).spawnGood(PLANK, at);
    going.dest = back.id;
    expect(drop()).toBe(true);
    expect(s.carryGood).toBe(going.id);
    expect((stale as unknown as { carrier: number }).carrier).toBe(-1);
  }, 120000);

  it("a good promised for a swap goes back as promised though its route turned another way since (#186)", () => {
    // The flag is full. The good promised to go back now routes through the flag's other road instead, and nothing else goes
    // back: the carrier still swaps it, into the place kept behind, instead of waiting at the full flag for good.
    const { s, at, eco, road, away, drop, flag } = carrierAt(FLAG_CAPACITY - 1, 0);
    const side = eco.roads.find((x) => x.alive && x.id !== road.id && (x.a === at || x.b === at) && eco.flags[x.a === at ? x.b : x.a]!.building >= 0)!;
    const third = side.a === at ? side.b : side.a;
    expect(third).not.toBe(away);
    const promised = inside(eco).spawnGood(PLANK, at);
    promised.dest = eco.flags[third]!.building;
    (promised as unknown as { carrier: number }).carrier = s.id;
    expect((eco as unknown as { nextHop(g: unknown): number }).nextHop(promised)).toBe(third);
    const behind = eco.flags[away]!;
    behind.reserved++;
    s.back = away;
    expect(flag.goods.length).toBe(FLAG_CAPACITY);
    expect(drop()).toBe(true);
    expect(s.carryGood).toBe(promised.id);
    expect(flag.goods.length).toBe(FLAG_CAPACITY);
  }, 120000);

  it("with breakRings on, a place promised over the capacity on purpose is still taken", () => {
    transportOptions.breakRings = true;
    const { flag, drop, s, at } = carrierAt(FLAG_CAPACITY, 1);
    s.target = at;
    expect(drop()).toBe(true);
    expect(flag.goods.length).toBe(FLAG_CAPACITY + 1);
  }, 120000);
});
