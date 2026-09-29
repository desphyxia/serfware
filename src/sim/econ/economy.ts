import type { StateHasher } from "../hash";
import type { Rng } from "../rng";
import { BUILDINGS, buildingType, GOODS, goodsArray, START, type BuildingDef } from "./defs";
import { MinHeap } from "./heap";
import { Feature, LandUse, TREE_GROWTH_TICKS, TREE_MATURE, Use } from "./landuse";

/**
 * The Serf City core: flags, roads with one carrier each, goods handed from flag to flag,
 * construction sites, and production buildings with workers. Everything is deterministic:
 * entities live in arrays indexed by id and are always processed in id order.
 */

export const FLAG_CAPACITY = 8;
const TICKS_PER_TILE_ROAD = 11;
const TICKS_PER_TILE_OFFROAD = 16;
const BUILD_TICKS_PER_MATERIAL = 45;
const SUPPLY_INTERVAL = 5;
const MAX_ROAD_TILES = 24;

export interface Flag {
  id: number;
  tile: number;
  goods: number[];
  /** Slots promised to goods on their way here. */
  reserved: number;
  roads: number[];
  building: number;
  alive: boolean;
}

export interface Road {
  id: number;
  a: number;
  b: number;
  tiles: number[];
  carrier: number;
  alive: boolean;
}

export interface Good {
  id: number;
  type: number;
  flag: number;
  /** Destination building, or -1 if none is reachable yet. */
  dest: number;
  /** Carrier that promised to move it, or -1. */
  carrier: number;
  alive: boolean;
}

export interface Building {
  id: number;
  type: number;
  def: BuildingDef;
  tile: number;
  flag: number;
  built: boolean;
  /** Construction: materials still to arrive / consumed so far. */
  cost: number[];
  delivered: number[];
  consumed: number;
  costTotal: number;
  /** Goods held: storage stock, or production inputs. */
  stock: number[];
  /** Goods on their way here. */
  pending: number[];
  worker: number;
  builder: number;
  /** Idle settlers housed here (storage buildings). */
  residents: number;
  /** Finished goods waiting to be carried out to the flag. */
  output: number;
  alive: boolean;
}

export type Role = "carrier" | "builder" | "worker";

export interface Settler {
  id: number;
  role: Role;
  building: number;
  road: number;
  /** Current walk: tiles, index of the tile we stand on, progress (0..1000) toward the next. */
  path: number[];
  pi: number;
  prog: number;
  /** Good type carried, or -1. */
  carrying: number;
  carryGood: number;
  state: string;
  timer: number;
  target: number;
  /** Index of the settler's tile within its road (carriers). */
  roadIdx: number;
  alive: boolean;
}

export type Command =
  | { t: "flag"; tile: number }
  | { t: "road"; tiles: number[] }
  | { t: "build"; type: string; tile: number; flagTile: number }
  | { t: "demolish"; tile: number };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export class Economy {
  readonly flags: Flag[] = [];
  readonly roads: Road[] = [];
  readonly goods: Good[] = [];
  readonly buildings: Building[] = [];
  readonly settlers: Settler[] = [];
  /** Bumped whenever flags, roads or buildings are added or removed. */
  structureVersion = 0;
  private graphVersion = 0;
  private readonly routeCache = new Map<number, { v: number; next: Int32Array; dist: Float64Array }>();
  private readonly growing: number[] = [];
  keep = -1;
  tick = 0;
  /** Messages for the player (the UI shows and clears them). */
  readonly notices: string[] = [];

  constructor(readonly land: LandUse) {}

  // ------------------------------------------------------------------ setup

  /** Choose a start site, place the keep, claim territory and make sure the start is playable. */
  setupStart(rng: Rng): void {
    const land = this.land;
    const { grid, terrain } = land.planet;
    let best = -1;
    let bestScore = -Infinity;
    for (let t = 0; t < grid.count; t++) {
      if (!land.isLand(t) || grid.degree(t) === 5) continue;
      const e = terrain.elevation[t] as number;
      if (e < 0.4 || e > terrain.params.mountainHeight * 0.35) continue;
      const slope = land.slope(t);
      if (slope > 0.9) continue;
      let flatLand = 0;
      let trees = 0;
      let rocks = 0;
      let water = 0;
      for (const n of land.ring(t, 7)) {
        if (land.isLand(n)) {
          if (land.slope(n) < 1.2) flatLand++;
          if (land.feature[n] === Feature.Tree) trees++;
          if (land.feature[n] === Feature.Rock) rocks++;
        } else water++;
      }
      const lat = Math.abs(grid.center[t * 3 + 1] as number);
      const score =
        flatLand * 1.0 + Math.min(trees, 40) * 0.8 + Math.min(rocks, 10) * 1.5 + (water > 0 && water < 40 ? 15 : 0) - lat * 30 - slope * 20 + rng.next() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best < 0) throw new Error("No start site found");

    // Clear space around the keep, then top up trees and rocks so the first chains can run.
    for (const n of [best, ...land.ring(best, 2)]) {
      if (land.feature[n] !== Feature.None) {
        land.feature[n] = Feature.None;
        land.amount[n] = 0;
      }
    }
    const around = land.ring(best, 8).filter((n) => n !== best && land.isLand(n) && land.feature[n] === Feature.None && grid.degree(n) === 6);
    const count = (f: Feature) => land.ring(best, 8).filter((n) => land.feature[n] === f).length;
    const far = around.filter((n) => !land.ring(best, 3).includes(n));
    for (let i = 0; count(Feature.Rock) < 6 && i < 40 && far.length; i++) {
      const n = rng.pick(far);
      if (land.feature[n] === Feature.None && land.slope(n) < 2) {
        land.feature[n] = Feature.Rock;
        land.amount[n] = rng.int(5, 9);
        land.variety[n] = rng.int(0, 3);
      }
    }
    for (let i = 0; count(Feature.Tree) < 18 && i < 80 && far.length; i++) {
      const n = rng.pick(far);
      if (land.feature[n] === Feature.None) {
        land.feature[n] = Feature.Tree;
        land.amount[n] = TREE_MATURE;
        land.variety[n] = rng.int(0, 3);
      }
    }
    land.featureVersion++;
    land.claim(best, START.territoryRadius);

    const flagTile = land.bestFlagTile(best);
    const flag = this.createFlag(flagTile);
    const keep = this.createBuilding(buildingType("keep"), best, flag.id);
    keep.built = true;
    keep.residents = START.settlers;
    keep.stock = goodsArray(START.stock);
    for (const n of land.planet.grid.neighborsOf(best)) if (n !== flagTile && land.use[n] === Use.Free) land.use[n] = Use.Blocked;
    this.keep = keep.id;
  }

  // ------------------------------------------------------------------ commands

  apply(cmd: Command): CommandResult {
    switch (cmd.t) {
      case "flag":
        return this.cmdFlag(cmd.tile);
      case "road":
        return this.cmdRoad(cmd.tiles);
      case "build":
        return this.cmdBuild(cmd.type, cmd.tile, cmd.flagTile);
      case "demolish":
        return this.cmdDemolish(cmd.tile);
    }
  }

  private cmdFlag(tile: number): CommandResult {
    const land = this.land;
    if (land.use[tile] === Use.Flag) return { ok: false, reason: "There is already a flag here." };
    if (!land.canPlaceFlag(tile)) return { ok: false, reason: "A flag can't go here." };
    if (land.use[tile] === Use.Road) return this.splitRoad(tile);
    this.createFlag(tile);
    return { ok: true };
  }

  /** Validate a road path (first tile must be a flag). Returns an error message or null. */
  checkRoad(tiles: readonly number[]): string | null {
    const land = this.land;
    const grid = land.planet.grid;
    if (tiles.length < 3) return "Roads need at least one tile between flags.";
    if (tiles.length > MAX_ROAD_TILES) return "That road is too long. Add flags along the way.";
    const first = tiles[0] as number;
    const last = tiles[tiles.length - 1] as number;
    if (land.use[first] !== Use.Flag) return "Roads start at a flag.";
    const seen = new Set<number>();
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as number;
      if (seen.has(t)) return "A road can't cross itself.";
      seen.add(t);
      if (i > 0 && !grid.neighborsOf(tiles[i - 1] as number).includes(t)) return "Road tiles must be connected.";
      if (i > 0 && i < tiles.length - 1 && !land.roadable(t)) return "Something is in the way.";
    }
    if (last === first) return "A road needs two different flags.";
    if (land.use[last] !== Use.Flag && !land.canPlaceFlag(last)) return "The road must end at a flag.";
    const fa = this.flagAt(first);
    const fb = this.flagAt(last);
    if (fa && fb) for (const r of fa.roads) {
      const road = this.roads[r] as Road;
      if ((road.a === fa.id && road.b === fb.id) || (road.b === fa.id && road.a === fb.id)) return "These flags are already connected.";
    }
    return null;
  }

  private cmdRoad(tiles: number[]): CommandResult {
    const err = this.checkRoad(tiles);
    if (err) return { ok: false, reason: err };
    const last = tiles[tiles.length - 1] as number;
    if (this.land.use[last] === Use.Road) {
      const r = this.splitRoad(last);
      if (!r.ok) return r;
    } else if (this.land.use[last] !== Use.Flag) this.createFlag(last);
    const a = this.flagAt(tiles[0] as number) as Flag;
    const b = this.flagAt(last) as Flag;
    this.createRoad(a.id, b.id, tiles);
    return { ok: true };
  }

  private cmdBuild(typeId: string, tile: number, flagTile: number): CommandResult {
    const type = buildingType(typeId);
    const def = BUILDINGS[type] as BuildingDef;
    if (def.buildable === false) return { ok: false, reason: `${def.name} can't be built.` };
    const land = this.land;
    if (!land.canBuild(tile, flagTile, def.large)) return { ok: false, reason: "You can't build here." };
    const existing = this.flagAt(flagTile);
    if (existing && existing.building >= 0) return { ok: false, reason: "That flag already serves a building." };
    let flag = existing;
    if (!flag) {
      const r = this.cmdFlag(flagTile);
      if (!r.ok) return r;
      flag = this.flagAt(flagTile) as Flag;
    }
    this.createBuilding(type, tile, flag.id);
    return { ok: true };
  }

  private cmdDemolish(tile: number): CommandResult {
    const land = this.land;
    const ref = land.ref[tile] as number;
    switch (land.use[tile]) {
      case Use.Building: {
        const b = this.buildings[ref] as Building;
        if (b.id === this.keep) return { ok: false, reason: "The Hearthship can't be demolished." };
        this.removeBuilding(b);
        return { ok: true };
      }
      case Use.Road:
        this.removeRoad(this.roads[ref] as Road);
        return { ok: true };
      case Use.Flag: {
        const f = this.flags[ref] as Flag;
        if (f.building === this.keep) return { ok: false, reason: "The Hearthship needs its flag." };
        this.removeFlag(f);
        return { ok: true };
      }
      default:
        return { ok: false, reason: "Nothing to demolish here." };
    }
  }

  // ------------------------------------------------------------------ creation and removal

  flagAt(tile: number): Flag | null {
    return this.land.use[tile] === Use.Flag ? (this.flags[this.land.ref[tile] as number] as Flag) : null;
  }

  buildingAt(tile: number): Building | null {
    return this.land.use[tile] === Use.Building ? (this.buildings[this.land.ref[tile] as number] as Building) : null;
  }

  private createFlag(tile: number): Flag {
    const f: Flag = { id: this.flags.length, tile, goods: [], reserved: 0, roads: [], building: -1, alive: true };
    this.flags.push(f);
    this.land.use[tile] = Use.Flag;
    this.land.ref[tile] = f.id;
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
    return f;
  }

  private createRoad(a: number, b: number, tiles: number[]): Road {
    const r: Road = { id: this.roads.length, a, b, tiles: [...tiles], carrier: -1, alive: true };
    this.roads.push(r);
    (this.flags[a] as Flag).roads.push(r.id);
    (this.flags[b] as Flag).roads.push(r.id);
    for (let i = 1; i < tiles.length - 1; i++) {
      const t = tiles[i] as number;
      this.land.use[t] = Use.Road;
      this.land.ref[t] = r.id;
    }
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
    return r;
  }

  private createBuilding(type: number, tile: number, flagId: number): Building {
    const def = BUILDINGS[type] as BuildingDef;
    const cost = goodsArray(def.cost);
    const b: Building = {
      id: this.buildings.length,
      type,
      def,
      tile,
      flag: flagId,
      built: false,
      cost,
      delivered: new Array<number>(GOODS.length).fill(0),
      consumed: 0,
      costTotal: cost.reduce((s, v) => s + v, 0),
      stock: new Array<number>(GOODS.length).fill(0),
      pending: new Array<number>(GOODS.length).fill(0),
      worker: -1,
      builder: -1,
      residents: 0,
      output: 0,
      alive: true,
    };
    this.buildings.push(b);
    (this.flags[flagId] as Flag).building = b.id;
    const land = this.land;
    land.use[tile] = Use.Building;
    land.ref[tile] = b.id;
    if (land.feature[tile] !== Feature.None) {
      land.feature[tile] = Feature.None;
      land.featureVersion++;
    }
    this.structureVersion++;
    land.useVersion++;
    return b;
  }

  /** Put a flag on a road tile, splitting the road in two. */
  private splitRoad(tile: number): CommandResult {
    const land = this.land;
    const road = this.roads[land.ref[tile] as number] as Road;
    const i = road.tiles.indexOf(tile);
    if (i <= 1 || i >= road.tiles.length - 2) return { ok: false, reason: "Too close to the next flag." };
    const left = road.tiles.slice(0, i + 1);
    const right = road.tiles.slice(i);
    const carrier = road.carrier;
    const { a, b } = road;
    // Detach the old road without sending the carrier home; it keeps working on one half.
    road.alive = false;
    this.detachRoad(road);
    const flag = this.createFlag(tile);
    const r1 = this.createRoad(a, flag.id, left);
    const r2 = this.createRoad(flag.id, b, right);
    if (carrier >= 0) {
      const s = this.settlers[carrier] as Settler;
      const onLeft = s.roadIdx <= i;
      const keepRoad = onLeft ? r1 : r2;
      keepRoad.carrier = carrier;
      s.road = keepRoad.id;
      s.roadIdx = onLeft ? Math.min(s.roadIdx, left.length - 1) : Math.max(0, s.roadIdx - i);
      if (s.carryGood >= 0) {
        // Drop what it carried at its position's nearest flag later; simplest: return it to origin flag logic.
        this.dropCarriedGoodAt(s, onLeft ? a : b);
      }
      this.releaseReservations(s);
      s.state = "idle";
      s.path = [keepRoad.tiles[s.roadIdx] as number];
      s.pi = 0;
      s.prog = 0;
    }
    this.rerouteAll();
    return { ok: true };
  }

  private detachRoad(road: Road): void {
    for (const f of [road.a, road.b]) {
      const flag = this.flags[f] as Flag;
      flag.roads = flag.roads.filter((r) => r !== road.id);
    }
    for (let i = 1; i < road.tiles.length - 1; i++) {
      const t = road.tiles[i] as number;
      this.land.use[t] = Use.Free;
      this.land.ref[t] = -1;
    }
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
  }

  private removeRoad(road: Road): void {
    if (!road.alive) return;
    road.alive = false;
    this.detachRoad(road);
    if (road.carrier >= 0) {
      const s = this.settlers[road.carrier] as Settler;
      if (s.carryGood >= 0) this.dropCarriedGoodAt(s, s.roadIdx < road.tiles.length / 2 ? road.a : road.b);
      this.releaseReservations(s);
      this.sendHome(s);
    }
    road.carrier = -1;
    this.rerouteAll();
  }

  private removeFlag(f: Flag): void {
    if (!f.alive) return;
    if (f.building >= 0) this.removeBuilding(this.buildings[f.building] as Building);
    for (const r of [...f.roads]) this.removeRoad(this.roads[r] as Road);
    for (const g of f.goods) this.destroyGood(this.goods[g] as Good);
    f.goods = [];
    f.alive = false;
    this.land.use[f.tile] = Use.Free;
    this.land.ref[f.tile] = -1;
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
    this.rerouteAll();
  }

  private removeBuilding(b: Building): void {
    if (!b.alive) return;
    b.alive = false;
    const land = this.land;
    land.use[b.tile] = Use.Free;
    land.ref[b.tile] = -1;
    const flag = this.flags[b.flag] as Flag;
    flag.building = -1;
    for (const id of [b.worker, b.builder]) if (id >= 0) this.sendHome(this.settlers[id] as Settler);
    // Goods heading here need a new destination.
    for (const g of this.goods) if (g.alive && g.dest === b.id) g.dest = -1;
    this.structureVersion++;
    land.useVersion++;
    this.rerouteAll();
  }

  private destroyGood(g: Good): void {
    g.alive = false;
    if (g.dest >= 0) {
      const b = this.buildings[g.dest] as Building;
      if (b.alive) b.pending[g.type] = Math.max(0, (b.pending[g.type] as number) - 1);
    }
  }

  private dropCarriedGoodAt(s: Settler, flagId: number): void {
    const g = this.goods[s.carryGood] as Good;
    const flag = this.flags[flagId] as Flag;
    if (flag.alive && flag.goods.length < FLAG_CAPACITY) {
      g.flag = flagId;
      g.carrier = -1;
      flag.goods.push(g.id);
    } else this.destroyGood(g);
    s.carryGood = -1;
    s.carrying = -1;
  }

  // ------------------------------------------------------------------ routing

  /** Next flag on the cheapest road route from `from` to `to`, distance included; -1 if unreachable. */
  route(from: number, to: number): { next: number; dist: number } {
    if (from === to) return { next: from, dist: 0 };
    let c = this.routeCache.get(to);
    if (!c || c.v !== this.graphVersion) {
      c = this.dijkstraFrom(to);
      this.routeCache.set(to, c);
    }
    const d = c.dist[from] as number;
    return d === Infinity ? { next: -1, dist: Infinity } : { next: c.next[from] as number, dist: d };
  }

  /** Distances from `src` to every flag, and for each flag the next hop toward `src`. */
  private dijkstraFrom(src: number): { v: number; next: Int32Array; dist: Float64Array } {
    const n = this.flags.length;
    const dist = new Float64Array(n).fill(Infinity);
    const next = new Int32Array(n).fill(-1);
    dist[src] = 0;
    next[src] = src;
    const heap = new MinHeap();
    heap.push(src, 0);
    while (heap.size) {
      const d0 = heap.peekPriority();
      const f = heap.pop();
      if (d0 > (dist[f] as number)) continue;
      const flag = this.flags[f] as Flag;
      if (!flag.alive) continue;
      for (const rid of flag.roads) {
        const road = this.roads[rid] as Road;
        const other = road.a === f ? road.b : road.a;
        // Congested flags cost a little more, so goods spread over parallel roads.
        const w = road.tiles.length - 1 + (this.flags[other] as Flag).goods.length * 0.25;
        const nd = (dist[f] as number) + w;
        if (nd < (dist[other] as number)) {
          dist[other] = nd;
          next[other] = f;
          heap.push(other, nd);
        }
      }
    }
    if (this.routeCache.size > 256) this.routeCache.clear();
    return { v: this.graphVersion, next, dist };
  }

  private rerouteAll(): void {
    for (const g of this.goods) if (g.alive && g.dest >= 0 && !(this.buildings[g.dest] as Building).alive) g.dest = -1;
  }

  /** Needed count of a good type at a building (construction or production inputs). */
  need(b: Building, type: number): number {
    if (!b.alive) return 0;
    if (!b.built) return (b.cost[type] as number) - (b.delivered[type] as number) - (b.pending[type] as number);
    const inputs = b.def.inputs;
    if (!inputs || b.worker < 0) return 0;
    const good = GOODS[type];
    if (!good || !(good.id in inputs)) return 0;
    return (b.def.inputStock ?? 4) - (b.stock[type] as number) - (b.pending[type] as number);
  }

  /** Choose where a good lying on a flag should go: a building that needs it, else storage. */
  private assignDestination(g: Good): void {
    let best = -1;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || this.need(b, g.type) <= 0) continue;
      const d = this.route(g.flag, b.flag).dist;
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    if (best < 0) {
      for (const b of this.buildings) {
        if (!b.alive || !b.def.storage || !b.built) continue;
        const d = this.route(g.flag, b.flag).dist;
        if (d < bestD) {
          bestD = d;
          best = b.id;
        }
      }
    }
    if (best >= 0) {
      g.dest = best;
      (this.buildings[best] as Building).pending[g.type]!++;
    }
  }

  private nextHop(g: Good): number {
    if (g.dest < 0) return -1;
    const dest = this.buildings[g.dest] as Building;
    if (dest.flag === g.flag) return -2;
    return this.route(g.flag, dest.flag).next;
  }

  /** Storage buildings send goods out to buildings that need them. */
  private supply(): void {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      for (let type = 0; type < GOODS.length; type++) {
        let need = this.need(b, type);
        while (need > 0) {
          let src: Building | null = null;
          let bestD = Infinity;
          for (const s of this.buildings) {
            if (!s.alive || !s.def.storage || !s.built || (s.stock[type] as number) <= 0) continue;
            const sf = this.flags[s.flag] as Flag;
            if (sf.goods.length + sf.reserved >= FLAG_CAPACITY) continue;
            const d = this.route(s.flag, b.flag).dist;
            if (d < bestD) {
              bestD = d;
              src = s;
            }
          }
          if (!src || bestD === Infinity) break;
          src.stock[type]!--;
          const g = this.spawnGood(type, src.flag);
          g.dest = b.id;
          b.pending[type]!++;
          need--;
        }
      }
    }
  }

  private spawnGood(type: number, flagId: number): Good {
    const g: Good = { id: this.goods.length, type, flag: flagId, dest: -1, carrier: -1, alive: true };
    this.goods.push(g);
    (this.flags[flagId] as Flag).goods.push(g.id);
    return g;
  }

  /** A building receives a good carried in by a carrier. */
  private receive(b: Building, type: number): void {
    b.pending[type] = Math.max(0, (b.pending[type] as number) - 1);
    if (!b.built) b.delivered[type]!++;
    else b.stock[type]!++;
  }

  // ------------------------------------------------------------------ settlers

  /** Is the flag connected to storage (so settlers can come)? Returns the nearest storage. */
  private homeFor(flagId: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const s of this.buildings) {
      if (!s.alive || !s.def.storage || !s.built || s.residents <= 0) continue;
      const d = this.route(s.flag, flagId).dist;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Tile path along roads from one flag to another. */
  private roadPath(from: number, to: number): number[] | null {
    const tiles = [(this.flags[from] as Flag).tile];
    let cur = from;
    for (let guard = 0; cur !== to && guard < 10000; guard++) {
      const { next } = this.route(cur, to);
      if (next < 0) return null;
      const road = (this.flags[cur] as Flag).roads.map((r) => this.roads[r] as Road).find((r) => (r.a === cur && r.b === next) || (r.b === cur && r.a === next));
      if (!road) return null;
      const seg = road.a === cur ? road.tiles : [...road.tiles].reverse();
      tiles.push(...seg.slice(1));
      cur = next;
    }
    return tiles;
  }

  private spawnSettler(role: Role, home: Building, path: number[]): Settler {
    home.residents--;
    const s: Settler = {
      id: this.settlers.length,
      role,
      building: -1,
      road: -1,
      path: [home.tile, ...path],
      pi: 0,
      prog: 0,
      carrying: -1,
      carryGood: -1,
      state: "goto",
      timer: 0,
      target: -1,
      roadIdx: 0,
      alive: true,
    };
    this.settlers.push(s);
    return s;
  }

  private sendHome(s: Settler): void {
    const here = s.path[s.pi] as number;
    if (s.role === "carrier" && s.road >= 0) {
      const road = this.roads[s.road] as Road;
      if (road.carrier === s.id) road.carrier = -1;
    }
    if (s.role === "worker" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      if (b.worker === s.id) b.worker = -1;
    }
    if (s.role === "builder" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      if (b.builder === s.id) b.builder = -1;
    }
    s.road = -1;
    s.building = -1;
    const home = this.buildings[this.keep] as Building;
    const path = this.land.findPath(here, home.tile, (t) => this.land.walkable(t) || t === home.tile, 20000);
    s.state = "home";
    s.path = path ?? [here, home.tile];
    s.pi = 0;
    s.prog = 0;
  }

  private dispatch(): void {
    // Carriers for roads without one.
    for (const r of this.roads) {
      if (!r.alive || r.carrier >= 0) continue;
      const home = this.homeFor(r.a) ?? this.homeFor(r.b);
      if (!home) continue;
      const mid = Math.floor(r.tiles.length / 2);
      const toA = this.roadPath(home.flag, r.a);
      const toB = toA ? null : this.roadPath(home.flag, r.b);
      if (!toA && !toB) continue;
      const approach = toA ? [...toA, ...r.tiles.slice(1, mid + 1)] : [...(toB as number[]), ...[...r.tiles].reverse().slice(1, r.tiles.length - mid)];
      const s = this.spawnSettler("carrier", home, approach);
      s.road = r.id;
      s.roadIdx = mid;
      r.carrier = s.id;
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (!b.built && b.builder < 0) {
        const home = this.homeFor(b.flag);
        if (!home) continue;
        const p = this.roadPath(home.flag, b.flag);
        if (!p) continue;
        const s = this.spawnSettler("builder", home, [...p, b.tile]);
        s.building = b.id;
        b.builder = s.id;
      } else if (b.built && b.def.job && b.worker < 0) {
        const home = this.homeFor(b.flag);
        if (!home) continue;
        const p = this.roadPath(home.flag, b.flag);
        if (!p) continue;
        const s = this.spawnSettler("worker", home, [...p, b.tile]);
        s.building = b.id;
        b.worker = s.id;
      }
    }
  }

  /** Advance along the current path. Returns true when the last tile is reached. */
  private walk(s: Settler): boolean {
    if (s.pi >= s.path.length - 1) return true;
    const a = s.path[s.pi] as number;
    const b = s.path[s.pi + 1] as number;
    const onRoad = this.land.use[b] === Use.Road || this.land.use[b] === Use.Flag;
    const ticks = (onRoad ? TICKS_PER_TILE_ROAD : TICKS_PER_TILE_OFFROAD) * this.land.stepCost(a, b);
    s.prog += Math.max(20, Math.floor(1000 / ticks));
    if (s.prog >= 1000) {
      s.prog -= 1000;
      s.pi++;
      if (s.pi >= s.path.length - 1) {
        s.prog = 0;
        return true;
      }
    }
    return false;
  }

  private setPath(s: Settler, path: number[]): void {
    s.path = path;
    s.pi = 0;
    s.prog = 0;
  }

  private releaseReservations(s: Settler): void {
    if (s.target >= 0) {
      const f = this.flags[s.target] as Flag;
      f.reserved = Math.max(0, f.reserved - 1);
      s.target = -1;
    }
    for (const g of this.goods) if (g.alive && g.carrier === s.id && g.id !== s.carryGood) g.carrier = -1;
  }

  private stepCarrier(s: Settler): void {
    const road = this.roads[s.road] as Road;
    if (!road || !road.alive) {
      this.sendHome(s);
      return;
    }
    const end = road.tiles.length - 1;
    const walkAlong = (to: number) => {
      const from = s.roadIdx;
      const seg = from <= to ? road.tiles.slice(from, to + 1) : road.tiles.slice(to, from + 1).reverse();
      this.setPath(s, seg);
    };
    switch (s.state) {
      case "goto":
        if (this.walk(s)) {
          s.state = "idle";
          this.setPath(s, [road.tiles[s.roadIdx] as number]);
        }
        return;
      case "idle": {
        const pick = this.chooseTransfer(road);
        if (pick) {
          const [fromFlag, good] = pick;
          const g = this.goods[good] as Good;
          g.carrier = s.id;
          const toFlag = fromFlag === road.a ? road.b : road.a;
          const into = this.nextHopFrom(g, toFlag) === -2 || (this.buildings[g.dest]?.flag ?? -1) === toFlag;
          if (!into) {
            (this.flags[toFlag] as Flag).reserved++;
            s.target = toFlag;
          }
          s.carryGood = good;
          s.state = "fetch";
          walkAlong(fromFlag === road.a ? 0 : end);
        } else if (s.roadIdx !== Math.floor(end / 2)) {
          walkAlong(Math.floor(end / 2));
          s.state = "center";
        }
        return;
      }
      case "center":
        if (this.walk(s)) {
          s.roadIdx = Math.floor(end / 2);
          s.state = "idle";
        }
        return;
      case "fetch":
        if (this.walk(s)) {
          s.roadIdx = s.path[s.path.length - 1] === road.tiles[0] ? 0 : end;
          const fromFlag = s.roadIdx === 0 ? road.a : road.b;
          const flag = this.flags[fromFlag] as Flag;
          const g = this.goods[s.carryGood] as Good;
          const i = flag.goods.indexOf(g.id);
          if (i < 0 || !g.alive) {
            this.releaseReservations(s);
            s.carryGood = -1;
            s.state = "idle";
            return;
          }
          flag.goods.splice(i, 1);
          s.carrying = g.type;
          s.state = "carry";
          walkAlong(s.roadIdx === 0 ? end : 0);
        }
        return;
      case "carry":
        if (this.walk(s)) {
          s.roadIdx = s.roadIdx === 0 ? end : 0;
          const atFlag = s.roadIdx === 0 ? road.a : road.b;
          const g = this.goods[s.carryGood] as Good;
          const dest = g.dest >= 0 ? (this.buildings[g.dest] as Building) : null;
          if (dest && dest.alive && dest.flag === atFlag) {
            s.state = "enter";
            this.setPath(s, [road.tiles[s.roadIdx] as number, dest.tile]);
            if (s.target >= 0) {
              (this.flags[s.target] as Flag).reserved--;
              s.target = -1;
            }
            return;
          }
          const flag = this.flags[atFlag] as Flag;
          if (s.target >= 0) {
            flag.reserved = Math.max(0, flag.reserved - 1);
            s.target = -1;
          }
          g.flag = atFlag;
          g.carrier = -1;
          flag.goods.push(g.id);
          if (g.dest >= 0 && !(this.buildings[g.dest] as Building).alive) g.dest = -1;
          s.carryGood = -1;
          s.carrying = -1;
          s.state = "idle";
        }
        return;
      case "enter":
        if (this.walk(s)) {
          const g = this.goods[s.carryGood] as Good;
          const dest = this.buildings[g.dest] as Building;
          if (dest.alive) this.receive(dest, g.type);
          g.alive = false;
          s.carryGood = -1;
          s.carrying = -1;
          s.state = "leave";
          this.setPath(s, [dest.tile, road.tiles[s.roadIdx] as number]);
        }
        return;
      case "leave":
        if (this.walk(s)) s.state = "idle";
        return;
    }
  }

  private nextHopFrom(g: Good, flag: number): number {
    if (g.dest < 0) return -1;
    const dest = this.buildings[g.dest] as Building;
    if (dest.flag === flag) return -2;
    return this.route(flag, dest.flag).next;
  }

  /** Pick the oldest good at either end of the road that wants to travel along it. */
  private chooseTransfer(road: Road): [number, number] | null {
    const options: [number, number][] = [];
    for (const [from, to] of [
      [road.a, road.b],
      [road.b, road.a],
    ] as const) {
      const flag = this.flags[from] as Flag;
      const target = this.flags[to] as Flag;
      for (const gid of flag.goods) {
        const g = this.goods[gid] as Good;
        if (g.carrier >= 0) continue;
        if (g.dest < 0) this.assignDestination(g);
        const hop = this.nextHop(g);
        if (hop !== to) continue;
        const dest = this.buildings[g.dest] as Building;
        const intoBuilding = dest.flag === to;
        if (!intoBuilding && target.goods.length + target.reserved >= FLAG_CAPACITY) continue;
        options.push([from, gid]);
        break;
      }
    }
    if (options.length === 0) return null;
    // Serve the fuller flag first; ties go to the older good.
    options.sort((x, y) => {
      const fx = (this.flags[x[0]] as Flag).goods.length;
      const fy = (this.flags[y[0]] as Flag).goods.length;
      return fy - fx || x[1] - y[1];
    });
    return options[0] as [number, number];
  }

  private stepBuilder(s: Settler): void {
    const b = this.buildings[s.building] as Building;
    if (!b || !b.alive) {
      this.sendHome(s);
      return;
    }
    if (s.state === "goto") {
      if (this.walk(s)) {
        s.state = "work";
        s.timer = 0;
      }
      return;
    }
    // Work while materials are on site.
    const onSite = b.delivered.reduce((a, v) => a + v, 0) - b.consumed;
    if (onSite > 0) {
      s.timer++;
      if (s.timer >= BUILD_TICKS_PER_MATERIAL) {
        s.timer = 0;
        b.consumed++;
        if (b.consumed >= b.costTotal) {
          b.built = true;
          b.builder = -1;
          this.notices.push(`${b.def.name} finished.`);
          this.structureVersion++;
          this.sendHome(s);
        }
      }
    }
    if (b.costTotal === 0) {
      b.built = true;
      this.sendHome(s);
    }
  }

  /** Nearest tile around a building that satisfies `pred`, not already targeted by another worker. */
  private findWorkTile(b: Building, pred: (t: number) => boolean): number {
    const radius = b.def.radius ?? 5;
    for (const t of this.land.ring(b.tile, radius)) {
      if (!pred(t)) continue;
      if (this.settlers.some((o) => o.alive && o.role === "worker" && o.target === t && o.building !== b.id)) continue;
      return t;
    }
    return -1;
  }

  private stepWorker(s: Settler): void {
    const b = this.buildings[s.building] as Building;
    if (!b || !b.alive) {
      this.sendHome(s);
      return;
    }
    const def = b.def;
    const land = this.land;
    const flag = this.flags[b.flag] as Flag;
    switch (s.state) {
      case "goto":
        if (this.walk(s)) {
          s.state = "rest";
          s.timer = def.restTicks ?? 30;
        }
        return;
      case "rest": {
        if (--s.timer > 0) return;
        if (b.output > 0) {
          if (flag.goods.length + flag.reserved >= FLAG_CAPACITY) {
            s.timer = 10;
            return;
          }
          s.state = "drop";
          this.setPath(s, [b.tile, flag.tile]);
          return;
        }
        if (def.job === "craft") {
          const inputs = goodsArray(def.inputs);
          if (inputs.every((n, i) => (b.stock[i] as number) >= n)) {
            inputs.forEach((n, i) => (b.stock[i] = (b.stock[i] as number) - n));
            s.state = "craft";
            s.timer = def.workTicks ?? 60;
          } else s.timer = 15;
          return;
        }
        let target = -1;
        if (def.job === "fell") target = this.findWorkTile(b, (t) => land.feature[t] === Feature.Tree && land.amount[t] === TREE_MATURE);
        else if (def.job === "quarry") target = this.findWorkTile(b, (t) => land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0);
        else if (def.job === "plant")
          target = this.findWorkTile(
            b,
            (t) => land.isLand(t) && land.use[t] === Use.Free && land.feature[t] === Feature.None && land.slope(t) < 2 && land.planet.grid.degree(t) === 6,
          );
        if (target < 0) {
          s.timer = 60;
          return;
        }
        const path = land.findPath(b.tile, target, (t) => land.walkable(t) || t === b.tile, 3000);
        if (!path) {
          s.timer = 60;
          return;
        }
        s.target = target;
        s.state = "out";
        this.setPath(s, path);
        return;
      }
      case "out":
        if (this.walk(s)) {
          s.state = "work";
          s.timer = def.workTicks ?? 60;
        }
        return;
      case "work": {
        if (--s.timer > 0) return;
        const t = s.target;
        let got = -1;
        if (def.job === "fell" && land.feature[t] === Feature.Tree && land.amount[t] === TREE_MATURE) {
          land.feature[t] = Feature.Stump;
          land.amount[t] = 12;
          land.featureVersion++;
          got = GOODS.findIndex((g) => g.id === def.produces);
        } else if (def.job === "quarry" && land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
          land.amount[t]!--;
          if (land.amount[t] === 0) land.feature[t] = Feature.None;
          land.featureVersion++;
          got = GOODS.findIndex((g) => g.id === def.produces);
        } else if (def.job === "plant" && land.feature[t] === Feature.None && land.use[t] === Use.Free) {
          land.feature[t] = Feature.Tree;
          land.amount[t] = 0;
          land.variety[t] = (t * 7 + this.tick) & 3;
          land.nextGrowth[t] = this.tick + TREE_GROWTH_TICKS;
          this.growing.push(t);
          land.featureVersion++;
        }
        s.carrying = got;
        const back = land.findPath(t, b.tile, (x) => land.walkable(x) || x === b.tile, 3000);
        s.state = "back";
        s.target = -1;
        this.setPath(s, back ?? [t, b.tile]);
        return;
      }
      case "back":
        if (this.walk(s)) {
          if (s.carrying >= 0) b.output++;
          s.carrying = -1;
          s.state = "rest";
          s.timer = def.restTicks ?? 30;
        }
        return;
      case "craft":
        if (--s.timer > 0) return;
        b.output++;
        s.state = "rest";
        s.timer = def.restTicks ?? 10;
        return;
      case "drop":
        if (this.walk(s)) {
          const type = GOODS.findIndex((g) => g.id === def.produces);
          if (b.output > 0 && type >= 0 && flag.goods.length + flag.reserved < FLAG_CAPACITY) {
            b.output--;
            const g = this.spawnGood(type, flag.id);
            this.assignDestination(g);
          }
          s.carrying = -1;
          s.state = "enter";
          this.setPath(s, [flag.tile, b.tile]);
        } else s.carrying = GOODS.findIndex((g) => g.id === def.produces);
        return;
      case "enter":
        if (this.walk(s)) {
          s.state = "rest";
          s.timer = def.restTicks ?? 20;
        }
        return;
    }
  }

  private stepSettler(s: Settler): void {
    if (s.state === "home") {
      if (this.walk(s)) {
        s.alive = false;
        (this.buildings[this.keep] as Building).residents++;
      }
      return;
    }
    if (s.role === "carrier") this.stepCarrier(s);
    else if (s.role === "builder") this.stepBuilder(s);
    else this.stepWorker(s);
  }

  // ------------------------------------------------------------------ nature

  private stepNature(): void {
    const land = this.land;
    if (this.tick % 10 !== 0) return;
    let changed = false;
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const t = this.growing[i] as number;
      if (land.feature[t] !== Feature.Tree) {
        this.growing.splice(i, 1);
        continue;
      }
      if ((land.nextGrowth[t] as number) <= this.tick) {
        land.amount[t]!++;
        changed = true;
        if ((land.amount[t] as number) >= TREE_MATURE) this.growing.splice(i, 1);
        else land.nextGrowth[t] = this.tick + TREE_GROWTH_TICKS;
      }
    }
    // Stumps rot away slowly (checked on a rotating slice of tiles).
    const n = land.planet.grid.count;
    const slice = 200;
    const start = ((this.tick / 10) * slice) % n;
    for (let k = 0; k < slice; k++) {
      const t = (start + k) % n;
      if (land.feature[t] === Feature.Stump) {
        if ((land.amount[t] as number) <= 1) {
          land.feature[t] = Feature.None;
          land.amount[t] = 0;
          changed = true;
        } else land.amount[t]!--;
      }
    }
    if (changed) land.featureVersion++;
  }

  // ------------------------------------------------------------------ main step

  step(tick: number): void {
    this.tick = tick;
    if (tick % SUPPLY_INTERVAL === 0) {
      this.supply();
      this.dispatch();
      for (const g of this.goods) if (g.alive && g.dest < 0 && g.carrier < 0) this.assignDestination(g);
    }
    for (const s of this.settlers) if (s.alive) this.stepSettler(s);
    this.stepNature();
    if (tick % 600 === 0) this.compact();
  }

  /** Drop dead goods from the goods array tail to keep memory bounded. */
  private compact(): void {
    while (this.goods.length && !(this.goods[this.goods.length - 1] as Good).alive) this.goods.pop();
    while (this.settlers.length && !(this.settlers[this.settlers.length - 1] as Settler).alive) this.settlers.pop();
  }

  // ------------------------------------------------------------------ queries

  storageTotals(): number[] {
    const out = new Array<number>(GOODS.length).fill(0);
    for (const b of this.buildings) if (b.alive && b.def.storage) b.stock.forEach((v, i) => (out[i] = (out[i] as number) + v));
    return out;
  }

  population(): { idle: number; working: number } {
    let idle = 0;
    for (const b of this.buildings) if (b.alive) idle += b.residents;
    const working = this.settlers.filter((s) => s.alive && s.state !== "home").length;
    return { idle, working };
  }

  hash(h: StateHasher): void {
    h.int(this.flags.length).int(this.roads.length).int(this.buildings.length);
    for (const s of this.settlers) if (s.alive) h.int(s.id).int(s.path[s.pi] ?? -1).int(s.prog).int(s.carrying);
    for (const f of this.flags) if (f.alive) h.int(f.goods.length);
    for (const b of this.buildings) if (b.alive) h.int(b.consumed).int(b.output).int(b.residents);
  }
}
