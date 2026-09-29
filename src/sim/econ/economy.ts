import type { StateHasher } from "../hash";
import { ticksPerDay } from "../clock";
import { mix32, Rng } from "../rng";
import { fullName, glowSpeed, glowValue, note, randomFamily, randomFirst, skillSpeed, title, tradeName, type GlowParts, type Person } from "./people";
import {
  BUILDINGS,
  buildingType,
  DEFAULT_DISTRIBUTION,
  DEFAULT_TOOL_PRIORITY,
  distributionKey,
  GOOD_INDEX,
  goodId,
  GOODS,
  goodsArray,
  goodsFor,
  inputKeyFor,
  START,
  TOOLS,
  type BuildingDef,
} from "./defs";
import { MinHeap } from "./heap";
import { Deposit, DEPOSIT_IDS, Feature, FIELD_GROWTH_TICKS, FIELD_RIPE, LandUse, SIGN_TICKS, TREE_GROWTH_TICKS, TREE_MATURE, Use } from "./landuse";

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
  owner: number;
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
  owner: number;
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
  owner: number;
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
  /** Good type of each finished unit, oldest first. */
  outputTypes: number[];
  /** Mines: outputs left before more food is needed. */
  food: number;
  /** Mines: nothing left to dig. */
  exhausted: boolean;
  /** Lantern buildings: wardens assigned (walking there or on watch). */
  garrison: number[];
  /** Lantern buildings: lit once the first warden arrives; only lit lanterns hold territory. */
  lit: boolean;
  /** Lantern buildings: close to another player's border. */
  frontier: boolean;
  alive: boolean;
}

/** Per-player economy preferences: distribution weights and tool priorities (0..1). */
export interface Prefs {
  dist: Record<string, Record<string, number>>;
  tools: Record<string, number>;
  /** Share of warden places to fill, near other players' borders and further inside. */
  garrison: { frontier: number; inland: number };
}

export type Role = "carrier" | "builder" | "worker" | "geologist" | "warden";

export interface Settler {
  id: number;
  owner: number;
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
  /** Tool carried as the settler's trade, returned to storage when they go home. */
  tool: number;
  /** Geologists: flag tile to survey around, and survey visits left. */
  home: number;
  visits: number;
  /** The person this settler is. */
  person: number;
  alive: boolean;
}

/** Days a child needs to grow up, and when adults retire, in game days. */
const CHILD_DAYS = 3;
const ELDER_DAYS = 40;
const LIFE_DAYS = 55;
/** A house holds up to four grown-ups and room for two children. */
const HOUSE_ADULTS = 4;
const HOUSE_CAPACITY = 6;
const KEEP_SHELTER = 12;
/** Tree variety used for memorial trees; woodcutters leave them standing. */
export const MEMORIAL = 7;

/** Player commands. `player` defaults to 0; in shared-keep co-op everyone acts as player 0. */
export type Command = (
  | { t: "flag"; tile: number }
  | { t: "road"; tiles: number[] }
  | { t: "build"; type: string; tile: number; flagTile: number }
  | { t: "demolish"; tile: number }
  | { t: "geologist"; flagTile: number }
  | { t: "prio"; key: string; target: string; value: number }
  | { t: "toolprio"; tool: string; value: number }
  | { t: "garrison"; zone: "frontier" | "inland"; value: number }
) & { player?: number };

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
  /** Keep (Hearthship) building id per player. */
  readonly keeps: number[] = [];
  readonly prefs: Prefs[] = [];
  readonly people: Person[] = [];
  readonly glow: number[] = [];
  readonly glowParts: GlowParts[] = [];
  private lifeRng: Rng | null = null;
  private readonly dayTicks: number;
  private hungry: boolean[] = [];
  private readonly fieldTiles: number[] = [];
  tick = 0;
  /** Messages for players (the UI shows its own player's and clears them). */
  readonly notices: { owner: number; text: string }[] = [];
  /** Per player: tiles lit right now, and tiles ever seen (fog of war). */
  readonly visible: Uint8Array[] = [];
  readonly explored: Uint8Array[] = [];
  /** Bumped when territory or sight changes. */
  visionVersion = 0;
  private territoryDirty = false;

  constructor(readonly land: LandUse) {
    this.dayTicks = ticksPerDay(land.planet.params.dayLengthHours);
  }

  // ------------------------------------------------------------------ setup

  /** Player 0's keep (single player and shared co-op). */
  get keep(): number {
    return this.keeps[0] ?? -1;
  }

  /** Choose a start site for `player`, place the keep, claim territory and make sure the start is playable. */
  setupStart(rng: Rng, player = 0): void {
    const others = this.keeps.map((k) => (this.buildings[k] as Building).tile);
    const land = this.land;
    const { grid, terrain } = land.planet;
    let best = -1;
    let bestScore = -Infinity;
    for (let t = 0; t < grid.count; t++) {
      if (!land.isLand(t) || grid.degree(t) === 5 || land.territory[t] !== 0) continue;
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
      // Other players' keeps: stay well clear, but not on the far side of the world either.
      let spread = 0;
      for (const o of others) {
        const d = (grid.center[t * 3] as number) * (grid.center[o * 3] as number) + (grid.center[t * 3 + 1] as number) * (grid.center[o * 3 + 1] as number) + (grid.center[t * 3 + 2] as number) * (grid.center[o * 3 + 2] as number);
        const ang = Math.sqrt(Math.max(0, 2 - 2 * d)); // chord length ~ angle
        if (ang < land.spacing * (START.territoryRadius * 2 + 4)) spread -= 1000;
        else spread -= Math.abs(ang - land.spacing * (START.territoryRadius * 2 + 10)) * 40;
      }
      const score =
        spread +
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
    land.claim(best, START.territoryRadius, player);

    const flagTile = land.bestFlagTile(best, player);
    const flag = this.createFlag(flagTile, player);
    const keep = this.createBuilding(buildingType("keep"), best, flag.id, player);
    keep.built = true;
    keep.lit = true;
    this.lifeRng ??= rng.fork("life");
    const r = rng.fork(`people-${player}`);
    let family = randomFamily(r);
    for (let i = 0; i < START.settlers; i++) {
      if (i % 3 === 0) family = randomFamily(r);
      const age = r.int(16, 34);
      this.addPerson(player, randomFirst(r), family, -age * this.dayTicks, r);
    }
    keep.residents = START.settlers;
    keep.stock = goodsArray(START.stock);
    for (const n of land.planet.grid.neighborsOf(best)) if (n !== flagTile && land.use[n] === Use.Free) land.use[n] = Use.Blocked;
    this.keeps[player] = keep.id;
    this.prefs[player] = JSON.parse(JSON.stringify({ dist: DEFAULT_DISTRIBUTION, tools: DEFAULT_TOOL_PRIORITY, garrison: START.garrison })) as Prefs;
    this.glow[player] = 60;
    this.glowParts[player] = { nourishment: 0.8, shelter: 0.6, belonging: 0.4, beauty: 0.5, rest: 1 };
    this.hungry[player] = false;
    this.updateTerritory();
  }

  private addPerson(owner: number, first: string, family: string, born: number, r: Rng): Person {
    const p: Person = {
      id: this.people.length,
      owner,
      first,
      family,
      born,
      stage: born > this.tick - CHILD_DAYS * this.dayTicks ? "child" : "adult",
      skills: {},
      done: {},
      house: -1,
      settler: -1,
      lifespan: born + (LIFE_DAYS + r.int(0, 15)) * this.dayTicks,
      journal: [],
      alive: true,
    };
    this.people.push(p);
    return p;
  }

  /** Age in whole game days. */
  ageDays(p: Person): number {
    return Math.floor((this.tick - p.born) / this.dayTicks);
  }

  // ------------------------------------------------------------------ commands

  apply(cmd: Command): CommandResult {
    const r = this.applyCommand(cmd);
    if (this.territoryDirty) this.updateTerritory();
    return r;
  }

  private applyCommand(cmd: Command): CommandResult {
    const p = cmd.player ?? 0;
    if (this.keeps[p] === undefined) return { ok: false, reason: "Unknown player." };
    switch (cmd.t) {
      case "flag":
        return this.cmdFlag(cmd.tile, p);
      case "road":
        return this.cmdRoad(cmd.tiles, p);
      case "build":
        return this.cmdBuild(cmd.type, cmd.tile, cmd.flagTile, p);
      case "demolish":
        return this.cmdDemolish(cmd.tile, p);
      case "geologist":
        return this.cmdGeologist(cmd.flagTile, p);
      case "prio": {
        const table = ((this.prefs[p] as Prefs).dist[cmd.key] ??= {});
        table[cmd.target] = Math.max(0, Math.min(1, cmd.value));
        return { ok: true };
      }
      case "toolprio":
        (this.prefs[p] as Prefs).tools[cmd.tool] = Math.max(0, Math.min(1, cmd.value));
        return { ok: true };
      case "garrison":
        if (cmd.zone !== "frontier" && cmd.zone !== "inland") return { ok: false, reason: "Unknown zone." };
        (this.prefs[p] as Prefs).garrison[cmd.zone] = Math.max(0, Math.min(1, cmd.value));
        return { ok: true };
    }
  }

  private cmdGeologist(flagTile: number, p: number): CommandResult {
    const flag = this.flagAt(flagTile);
    if (!flag || flag.owner !== p) return { ok: false, reason: "Send geologists to one of your flags." };
    const pick = this.pickPerson(flag.id, "geologist");
    if (!pick) return { ok: false, reason: "No one is free, or that flag isn't connected to your Hearthship." };
    const path = this.roadPath(pick.origin.flag, flag.id);
    if (!path) return { ok: false, reason: "That flag isn't connected to your Hearthship." };
    const hammer = this.takeTool(p, goodId("hammer"));
    if (hammer < 0) return { ok: false, reason: "No hammer for a geologist. Build a toolsmith." };
    const s = this.spawnSettler("geologist", pick.origin, path, pick.person);
    s.tool = hammer;
    s.home = flagTile;
    s.visits = 8;
    return { ok: true };
  }

  /** Check a command without changing anything (for instant feedback in multiplayer). */
  check(cmd: Command): string | null {
    const p = cmd.player ?? 0;
    const land = this.land;
    switch (cmd.t) {
      case "flag":
        return land.use[cmd.tile] === Use.Flag ? "There is already a flag here." : land.canPlaceFlag(cmd.tile, p) ? null : "A flag can't go here.";
      case "road":
        return this.checkRoad(cmd.tiles, p);
      case "build":
        return land.canBuildDef(cmd.tile, cmd.flagTile, BUILDINGS[buildingType(cmd.type)] as BuildingDef, p) ? null : this.placementHint(BUILDINGS[buildingType(cmd.type)] as BuildingDef);
      case "demolish":
        return land.use[cmd.tile] === Use.Free || land.use[cmd.tile] === Use.Blocked ? "Nothing to demolish here." : null;
      case "geologist": {
        const f = this.flagAt(cmd.flagTile);
        return f && f.owner === p ? null : "Send geologists to one of your flags.";
      }
      default:
        return null;
    }
  }

  private cmdFlag(tile: number, p: number): CommandResult {
    const land = this.land;
    if (land.use[tile] === Use.Flag) return { ok: false, reason: "There is already a flag here." };
    if (!land.canPlaceFlag(tile, p)) return { ok: false, reason: "A flag can't go here." };
    if (land.use[tile] === Use.Road) {
      if ((this.roads[land.ref[tile] as number] as Road).owner !== p) return { ok: false, reason: "That road isn't yours." };
      return this.splitRoad(tile);
    }
    this.createFlag(tile, p);
    return { ok: true };
  }

  /** Validate a road path (first tile must be a flag). Returns an error message or null. */
  checkRoad(tiles: readonly number[], p = 0): string | null {
    const land = this.land;
    const grid = land.planet.grid;
    if (tiles.length < 3) return "Roads need at least one tile between flags.";
    if (tiles.length > MAX_ROAD_TILES) return "That road is too long. Add flags along the way.";
    const first = tiles[0] as number;
    const last = tiles[tiles.length - 1] as number;
    if (land.use[first] !== Use.Flag) return "Roads start at a flag.";
    if ((this.flags[land.ref[first] as number] as Flag).owner !== p) return "That flag isn't yours.";
    const seen = new Set<number>();
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as number;
      if (seen.has(t)) return "A road can't cross itself.";
      seen.add(t);
      if (i > 0 && !grid.neighborsOf(tiles[i - 1] as number).includes(t)) return "Road tiles must be connected.";
      if (i > 0 && i < tiles.length - 1 && !land.roadable(t, p)) return "Something is in the way.";
    }
    if (last === first) return "A road needs two different flags.";
    if (land.use[last] === Use.Flag ? (this.flags[land.ref[last] as number] as Flag).owner !== p : !land.canPlaceFlag(last, p)) return "The road must end at one of your flags.";
    const fa = this.flagAt(first);
    const fb = this.flagAt(last);
    if (fa && fb) for (const r of fa.roads) {
      const road = this.roads[r] as Road;
      if ((road.a === fa.id && road.b === fb.id) || (road.b === fa.id && road.a === fb.id)) return "These flags are already connected.";
    }
    return null;
  }

  private cmdRoad(tiles: number[], p: number): CommandResult {
    const err = this.checkRoad(tiles, p);
    if (err) return { ok: false, reason: err };
    const last = tiles[tiles.length - 1] as number;
    if (this.land.use[last] === Use.Road) {
      const r = this.splitRoad(last);
      if (!r.ok) return r;
    } else if (this.land.use[last] !== Use.Flag) this.createFlag(last, p);
    const a = this.flagAt(tiles[0] as number) as Flag;
    const b = this.flagAt(last) as Flag;
    this.createRoad(a.id, b.id, tiles, p);
    return { ok: true };
  }

  private cmdBuild(typeId: string, tile: number, flagTile: number, p: number): CommandResult {
    const type = buildingType(typeId);
    const def = BUILDINGS[type] as BuildingDef;
    if (def.buildable === false) return { ok: false, reason: `${def.name} can't be built.` };
    const land = this.land;
    if (!land.canBuildDef(tile, flagTile, def, p)) return { ok: false, reason: this.placementHint(def) };
    const existing = this.flagAt(flagTile);
    if (existing && existing.building >= 0) return { ok: false, reason: "That flag already serves a building." };
    let flag = existing;
    if (!flag) {
      const r = this.cmdFlag(flagTile, p);
      if (!r.ok) return r;
      flag = this.flagAt(flagTile) as Flag;
    }
    this.createBuilding(type, tile, flag.id, p);
    return { ok: true };
  }

  private placementHint(def: BuildingDef): string {
    if (def.terrain === "mountain") return `${def.name}s go on mountain slopes inside your border.`;
    if (def.terrain === "coast") return `${def.name}s must be built near water.`;
    return "You can't build here.";
  }

  private cmdDemolish(tile: number, p: number): CommandResult {
    const land = this.land;
    const ref = land.ref[tile] as number;
    const owner =
      land.use[tile] === Use.Building ? this.buildings[ref]?.owner : land.use[tile] === Use.Road ? this.roads[ref]?.owner : land.use[tile] === Use.Flag ? this.flags[ref]?.owner : p;
    if (owner !== p) return { ok: false, reason: "That isn't yours." };
    switch (land.use[tile]) {
      case Use.Building: {
        const b = this.buildings[ref] as Building;
        if (this.keeps.includes(b.id)) return { ok: false, reason: "The Hearthship can't be demolished." };
        this.removeBuilding(b);
        return { ok: true };
      }
      case Use.Road:
        this.removeRoad(this.roads[ref] as Road);
        return { ok: true };
      case Use.Flag: {
        const f = this.flags[ref] as Flag;
        if (this.keeps.includes(f.building)) return { ok: false, reason: "The Hearthship needs its flag." };
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

  private createFlag(tile: number, owner: number): Flag {
    const f: Flag = { id: this.flags.length, owner, tile, goods: [], reserved: 0, roads: [], building: -1, alive: true };
    this.flags.push(f);
    this.land.use[tile] = Use.Flag;
    this.land.ref[tile] = f.id;
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
    return f;
  }

  private createRoad(a: number, b: number, tiles: number[], owner: number): Road {
    const r: Road = { id: this.roads.length, owner, a, b, tiles: [...tiles], carrier: -1, alive: true };
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

  private createBuilding(type: number, tile: number, flagId: number, owner: number): Building {
    const def = BUILDINGS[type] as BuildingDef;
    const cost = goodsArray(def.cost);
    const b: Building = {
      id: this.buildings.length,
      owner,
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
      outputTypes: [],
      food: 0,
      exhausted: false,
      garrison: [],
      lit: false,
      frontier: false,
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
    const flag = this.createFlag(tile, road.owner);
    const r1 = this.createRoad(a, flag.id, left, road.owner);
    const r2 = this.createRoad(flag.id, b, right, road.owner);
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
    for (const id of [b.worker, b.builder, ...b.garrison]) if (id >= 0) this.sendHome(this.settlers[id] as Settler);
    b.garrison = [];
    if (b.def.light && b.lit) {
      b.lit = false;
      this.territoryDirty = true;
    }
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
    if (b.worker < 0 || b.exhausted) return 0;
    const key = inputKeyFor(b.def, type);
    if (!key) return 0;
    if (this.priority(b, type) <= 0) return 0;
    let have = 0;
    for (const g of goodsFor(key)) have += (b.stock[g] as number) + (b.pending[g] as number);
    return (b.def.inputStock ?? 4) - have;
  }

  /** Distribution weight (0..1) of a building for a good; 0 means it gets none. */
  priority(b: Building, type: number): number {
    const table = this.prefs[b.owner]?.dist[distributionKey(type)];
    if (!table) return 1;
    return table[b.built ? b.def.id : "site"] ?? 1;
  }

  /** Take a tool of `type` from any of the player's storages; returns the type or -1. */
  private takeTool(owner: number, type: number): number {
    for (const s of this.buildings) {
      if (!s.alive || !s.def.storage || s.owner !== owner || (s.stock[type] as number) <= 0) continue;
      s.stock[type]!--;
      return type;
    }
    return -1;
  }

  /** Does the player have a tool of this type in storage? */
  hasTool(owner: number, type: number): boolean {
    return this.buildings.some((s) => s.alive && s.def.storage && s.owner === owner && (s.stock[type] as number) > 0);
  }

  /** Choose where a good lying on a flag should go: a building that needs it, else storage. */
  private assignDestination(g: Good): void {
    let best = -1;
    let bestD = Infinity;
    const owner = (this.flags[g.flag] as Flag).owner;
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== owner || this.need(b, g.type) <= 0) continue;
      const d = this.route(g.flag, b.flag).dist / Math.max(0.05, this.priority(b, g.type));
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    if (best < 0) {
      for (const b of this.buildings) {
        if (!b.alive || !b.def.storage || !b.built || b.owner !== owner) continue;
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

  /** Storage buildings send goods out to buildings that need them, highest priority first. */
  private supply(): void {
    const order = this.buildings.filter((b) => b.alive);
    for (let type = 0; type < GOODS.length; type++) {
      const wanting = order.filter((b) => this.need(b, type) > 0).sort((x, y) => this.priority(y, type) - this.priority(x, type) || x.id - y.id);
      for (const b of wanting) {
        let need = this.need(b, type);
        while (need > 0) {
          let src: Building | null = null;
          let bestD = Infinity;
          for (const s of this.buildings) {
            if (!s.alive || !s.def.storage || !s.built || s.owner !== b.owner || (s.stock[type] as number) <= 0) continue;
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

  /** What a production building still lacks, for the details panel. */
  waitingFor(b: Building): string | null {
    if (!b.built) return null;
    if (b.def.tool && b.worker < 0 && !this.hasTool(b.owner, goodId(b.def.tool))) return `Needs a worker with a ${GOODS[goodId(b.def.tool)]?.name.toLowerCase()}. Make one at a toolsmith.`;
    if (b.exhausted) return "Nothing left to dig here.";
    if (b.def.inputs && b.worker >= 0) {
      const missing = Object.keys(b.def.inputs).filter((k) => goodsFor(k).every((g) => (b.stock[g] as number) === 0));
      if (missing.length && b.food <= 0) return `Waiting for ${missing.map((k) => GOODS[GOOD_INDEX.get(k) ?? -1]?.name.toLowerCase() ?? k).join(" and ")}.`;
    }
    return null;
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

  /**
   * Choose who takes a job at `flagId`: a free adult of the flag's owner, preferring skill in the
   * trade, then who lives closest. They set out from their house, or from the Hearthship.
   */
  private pickPerson(flagId: number, trade: string): { origin: Building; person: Person } | null {
    const owner = (this.flags[flagId] as Flag).owner;
    const keep = this.buildings[this.keeps[owner] ?? -1];
    let best: { origin: Building; person: Person } | null = null;
    let bestScore = -Infinity;
    for (const p of this.people) {
      if (!p.alive || p.owner !== owner || p.stage !== "adult" || p.settler >= 0) continue;
      const house = p.house >= 0 ? this.buildings[p.house] : undefined;
      const origin = house && house.alive && house.built ? house : keep;
      if (!origin) continue;
      let d = this.route(origin.flag, flagId).dist;
      if (d === Infinity && origin !== keep && keep) d = this.route(keep.flag, flagId).dist;
      if (d === Infinity) continue;
      const score = (p.skills[trade] ?? 0) * 40 - d * 0.1 - p.id * 1e-6;
      if (score > bestScore) {
        bestScore = score;
        best = { origin: this.route(origin.flag, flagId).dist === Infinity ? (keep as Building) : origin, person: p };
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

  private spawnSettler(role: Role, home: Building, path: number[], person: Person): Settler {
    const s: Settler = {
      id: this.settlers.length,
      owner: home.owner,
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
      tool: -1,
      home: -1,
      visits: 0,
      person: person.id,
      alive: true,
    };
    this.settlers.push(s);
    person.settler = s.id;
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
    if (s.role === "warden" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      b.garrison = b.garrison.filter((id) => id !== s.id);
    }
    this.releaseReservations(s);
    if (s.role === "builder" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      if (b.builder === s.id) b.builder = -1;
    }
    s.road = -1;
    s.building = -1;
    const person = this.people[s.person];
    const house = person && person.house >= 0 ? this.buildings[person.house] : undefined;
    const home = house && house.alive && house.built ? house : (this.buildings[this.keeps[s.owner] as number] as Building);
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
      const pick = this.pickPerson(r.a, "carrier") ?? this.pickPerson(r.b, "carrier");
      if (!pick) continue;
      const home = pick.origin;
      const mid = Math.floor(r.tiles.length / 2);
      const toA = this.roadPath(home.flag, r.a);
      const toB = toA ? null : this.roadPath(home.flag, r.b);
      if (!toA && !toB) continue;
      const approach = toA ? [...toA, ...r.tiles.slice(1, mid + 1)] : [...(toB as number[]), ...[...r.tiles].reverse().slice(1, r.tiles.length - mid)];
      const s = this.spawnSettler("carrier", home, approach, pick.person);
      s.road = r.id;
      s.roadIdx = mid;
      r.carrier = s.id;
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (!b.built && b.builder < 0) {
        const pick = this.pickPerson(b.flag, "builder");
        if (!pick) continue;
        const p = this.roadPath(pick.origin.flag, b.flag);
        if (!p) continue;
        const tool = this.takeTool(b.owner, goodId("hammer"));
        if (tool < 0) continue;
        const s = this.spawnSettler("builder", pick.origin, [...p, b.tile], pick.person);
        s.building = b.id;
        s.tool = tool;
        b.builder = s.id;
      } else if (b.built && b.def.job && b.worker < 0) {
        const pick = this.pickPerson(b.flag, b.def.id);
        if (!pick) continue;
        const p = this.roadPath(pick.origin.flag, b.flag);
        if (!p) continue;
        let tool = -1;
        if (b.def.tool) {
          tool = this.takeTool(b.owner, goodId(b.def.tool));
          if (tool < 0) continue;
        }
        const s = this.spawnSettler("worker", pick.origin, [...p, b.tile], pick.person);
        const person = this.people[pick.person.id] as Person;
        if (!person.done[b.def.id]) note(person, `Took up work at the ${b.def.name.toLowerCase()}.`);
        s.building = b.id;
        s.tool = tool;
        b.worker = s.id;
      } else if (b.built && b.def.slots) {
        const want = this.garrisonWant(b);
        if (b.garrison.length < want) {
          const pick = this.pickPerson(b.flag, "warden");
          if (!pick) continue;
          const p = this.roadPath(pick.origin.flag, b.flag);
          if (!p) continue;
          const s = this.spawnSettler("warden", pick.origin, [...p, b.tile], pick.person);
          note(this.people[pick.person.id] as Person, `Took up the watch at a ${b.def.name.toLowerCase()}.`);
          s.building = b.id;
          b.garrison.push(s.id);
        } else if (b.garrison.length > want && b.garrison.length > 1) {
          const id = [...b.garrison].reverse().find((g) => (this.settlers[g] as Settler).state === "guard");
          if (id !== undefined) this.sendHome(this.settlers[id] as Settler);
        }
      }
    }
  }

  /** Wardens a lantern building should have under its owner's garrison policy (at least one). */
  garrisonWant(b: Building): number {
    const slots = b.def.slots ?? 0;
    const g = (this.prefs[b.owner] as Prefs).garrison;
    return Math.max(1, Math.min(slots, Math.ceil(slots * (b.frontier ? g.frontier : g.inland) - 1e-9)));
  }

  private stepWarden(s: Settler): void {
    const b = this.buildings[s.building];
    if (!b || !b.alive) {
      this.sendHome(s);
      return;
    }
    if (s.state === "goto" && this.walk(s)) {
      s.state = "guard";
      if (!b.lit) {
        b.lit = true;
        this.territoryDirty = true;
        this.notify(b.owner, `The ${b.def.name.toLowerCase()} is lit. Your border grows.`);
      }
    }
  }

  notify(owner: number, text: string): void {
    this.notices.push({ owner, text });
    if (this.notices.length > 50) this.notices.shift();
  }

  /**
   * Territory comes from light. A tile stays with its owner while any of their lit lanterns
   * reaches it; otherwise it goes to the nearest lit lantern (ties to the older building).
   * Structures on land a player loses burn down. Also refreshes sight and explored tiles.
   */
  updateTerritory(): void {
    for (let guard = 0; guard < 4; guard++) {
      this.territoryDirty = false;
      this.recomputeTerritory();
      if (!this.territoryDirty) break;
    }
    this.updateVision();
  }

  private sources(): Building[] {
    return this.buildings.filter((b) => b.alive && b.lit && !!b.def.light);
  }

  /** Visit tiles within `radius` steps of `center` with their distance. */
  private flood(center: number, radius: number, visit: (t: number, d: number) => void): void {
    const grid = this.land.planet.grid;
    const dist = new Map<number, number>([[center, 0]]);
    const queue = [center];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i] as number;
      const d = dist.get(t) as number;
      visit(t, d);
      if (d >= radius) continue;
      for (const n of grid.neighborsOf(t))
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
    }
  }

  private recomputeTerritory(): void {
    const land = this.land;
    const n = land.planet.grid.count;
    const bestD = new Int16Array(n).fill(32767);
    const bestO = new Uint8Array(n);
    const held = new Uint8Array(n);
    const sources = this.sources();
    for (const b of sources) {
      this.flood(b.tile, b.def.light as number, (t, d) => {
        if (land.territory[t] === b.owner + 1) held[t] = 1;
        if (d < (bestD[t] as number)) {
          bestD[t] = d;
          bestO[t] = b.owner + 1;
        }
      });
    }
    const lost: number[] = [];
    let changed = false;
    for (let t = 0; t < n; t++) {
      const old = land.territory[t] as number;
      const next = held[t] ? old : (bestO[t] as number);
      if (next === old) continue;
      land.territory[t] = next;
      changed = true;
      if (old) lost.push(t);
    }
    if (changed) land.territoryVersion++;
    // Burn what stands on lost land.
    for (const t of lost) {
      const ref = land.ref[t] as number;
      if (land.use[t] === Use.Building) {
        const b = this.buildings[ref] as Building;
        if (b.alive && land.territory[t] !== b.owner + 1 && !this.keeps.includes(b.id)) {
          this.notify(b.owner, `Your ${b.def.name.toLowerCase()} was left in the dark and burned down.`);
          this.removeBuilding(b);
        }
      } else if (land.use[t] === Use.Flag) {
        const f = this.flags[ref] as Flag;
        if (f.alive && land.territory[t] !== f.owner + 1 && !this.keeps.includes(f.building)) this.removeFlag(f);
      } else if (land.use[t] === Use.Road) {
        const r = this.roads[ref] as Road;
        if (r.alive && land.territory[t] !== r.owner + 1) this.removeRoad(r);
      }
    }
    // Frontier lanterns: another player's land within a few steps of their light.
    for (const b of sources) {
      if (!b.def.slots) continue;
      let frontier = false;
      this.flood(b.tile, (b.def.light as number) + 3, (t) => {
        const o = land.territory[t] as number;
        if (o && o !== b.owner + 1) frontier = true;
      });
      b.frontier = frontier;
    }
  }

  private updateVision(): void {
    const n = this.land.planet.grid.count;
    for (let p = 0; p < this.keeps.length; p++) {
      this.visible[p] = new Uint8Array(n);
      this.explored[p] ??= new Uint8Array(n);
    }
    for (const b of this.sources()) {
      const vis = this.visible[b.owner] as Uint8Array;
      const exp = this.explored[b.owner] as Uint8Array;
      this.flood(b.tile, (b.def.light as number) + 3, (t) => {
        vis[t] = 1;
        exp[t] = 1;
      });
    }
    this.visionVersion++;
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
      if (!onRoad && this.land.use[b] !== Use.Building) {
        this.land.wear[b] = Math.min(2000, (this.land.wear[b] as number) + 24);
        this.land.wearVersion++;
      }
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
      if (s.timer >= BUILD_TICKS_PER_MATERIAL * this.speedFactor(s, "builder")) {
        s.timer = 0;
        b.consumed++;
        this.train(s, "builder");
        if (b.consumed >= b.costTotal) {
          b.built = true;
          b.builder = -1;
          this.notify(b.owner, `${b.def.name} finished.`);
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

  /** Work-time factor for a settler at a trade: skill and the settlement's Glow. */
  private speedFactor(s: Settler, trade: string): number {
    const p = this.people[s.person];
    return skillSpeed(p?.skills[trade] ?? 0) * glowSpeed(this.glow[s.owner] ?? 60);
  }

  /** Practice makes perfect: raise skill, record milestones in the person's journal. */
  private train(s: Settler, trade: string): void {
    const p = this.people[s.person];
    if (!p) return;
    const elders = this.people.some((o) => o.alive && o.owner === p.owner && o.stage === "elder");
    const before = p.skills[trade] ?? 0;
    const gain = 0.025 * (1 - before) * (elders ? 1.4 : 1);
    const after = Math.min(1, before + gain);
    p.skills[trade] = after;
    const n = (p.done[trade] ?? 0) + 1;
    p.done[trade] = n;
    const noun = tradeName(trade);
    if (title(after) !== title(before)) {
      const t = title(after).toLowerCase();
      note(p, `Became ${/^[aeiou]/.test(t) ? "an" : "a"} ${t} ${noun}.`);
    } else if (n === 10 || n === 50 || n === 100 || n === 250) note(p, `${n} jobs done as ${noun}.`);
  }

  /** Consume one unit of each input (groups take from the fullest member). Returns false if short. */
  private consumeInputs(b: Building): boolean {
    const inputs = b.def.inputs ?? {};
    for (const [key, n] of Object.entries(inputs)) {
      if (key === "food" && b.def.job === "mine") continue;
      let have = 0;
      for (const g of goodsFor(key)) have += b.stock[g] as number;
      if (have < n) return false;
    }
    for (const [key, n] of Object.entries(inputs)) {
      if (key === "food" && b.def.job === "mine") continue;
      for (let k = 0; k < n; k++) {
        let pick = -1;
        for (const g of goodsFor(key)) if (pick < 0 || (b.stock[g] as number) > (b.stock[pick] as number)) pick = g;
        b.stock[pick]!--;
      }
    }
    return true;
  }

  /** Toolsmith: the tool with the highest priority relative to how many are in stock. */
  private chooseTool(owner: number): number {
    const prefs = this.prefs[owner] as Prefs;
    const stock = this.storageTotals(owner);
    let best = -1;
    let bestScore = 0;
    for (const t of TOOLS) {
      const prio = prefs.tools[(GOODS[t] as { id: string }).id] ?? 0;
      const score = prio / (1 + (stock[t] as number));
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  private produce(b: Building, type: number): void {
    if (type < 0) return;
    b.output++;
    b.outputTypes.push(type);
  }

  private producedType(b: Building): number {
    const p = b.def.produces;
    if (!p) return -1;
    return p === "tool" ? this.chooseTool(b.owner) : goodId(p);
  }

  /** Mines: the richest matching deposit within reach, or -1. */
  private mineTile(b: Building): number {
    const want = Deposit[(b.def.resource ?? "granite").replace(/^./, (c) => c.toUpperCase()) as keyof typeof Deposit];
    let best = -1;
    let most = 0;
    for (const t of [b.tile, ...this.land.ring(b.tile, b.def.radius ?? 2)]) {
      if (this.land.deposit[t] !== want) continue;
      const a = this.land.depositAmount[t] as number;
      if (a > most) {
        most = a;
        best = t;
      }
    }
    return best;
  }

  /** Mines: eat if needed; returns false if hungry with nothing to eat. */
  private feedMiner(b: Building): boolean {
    if (b.food > 0) return true;
    let pick = -1;
    for (const g of goodsFor("food")) if ((b.stock[g] as number) > 0 && (pick < 0 || (b.stock[g] as number) > (b.stock[pick] as number))) pick = g;
    if (pick < 0) return false;
    b.stock[pick]!--;
    b.food = b.def.foodPer ?? 2;
    return true;
  }

  private findJobTarget(b: Building, s: Settler): number {
    const land = this.land;
    const def = b.def;
    const open = (t: number) =>
      land.isLand(t) && land.use[t] === Use.Free && land.feature[t] === Feature.None && land.slope(t) < 1.8 && land.planet.grid.degree(t) === 6;
    switch (def.job) {
      case "fell":
        return this.findWorkTile(b, (t) => land.feature[t] === Feature.Tree && land.amount[t] === TREE_MATURE && land.variety[t] !== MEMORIAL);
      case "quarry":
        return this.findWorkTile(b, (t) => land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0);
      case "plant":
        return this.findWorkTile(b, open);
      case "farm": {
        const ripe = this.findWorkTile(b, (t) => land.feature[t] === Feature.Field && (land.amount[t] as number) >= FIELD_RIPE);
        if (ripe >= 0) return ripe;
        const fields = land.ring(b.tile, def.radius ?? 3).filter((t) => land.feature[t] === Feature.Field).length;
        return fields < 8 ? this.findWorkTile(b, open) : -1;
      }
      case "fish": {
        for (const t of land.ring(b.tile, def.radius ?? 5)) {
          if (!land.isLand(t) || !land.walkable(t)) continue;
          for (const w of land.planet.grid.neighborsOf(t)) {
            if (land.isLand(w) || (land.fish[w] as number) === 0) continue;
            if (this.settlers.some((o) => o.alive && o.role === "worker" && o.target === t && o.id !== s.id)) continue;
            s.home = w;
            return t;
          }
        }
        return -1;
      }
      default:
        return -1;
    }
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
          s.carrying = b.outputTypes[0] ?? -1;
          this.setPath(s, [b.tile, flag.tile]);
          return;
        }
        if (def.job === "craft") {
          const out = this.producedType(b);
          if (out >= 0 && this.consumeInputs(b)) {
            s.state = "craft";
            s.target = out;
            s.timer = Math.round((def.workTicks ?? 60) * this.speedFactor(s, def.id));
          } else s.timer = 15;
          return;
        }
        if (def.job === "mine") {
          if (b.exhausted) {
            s.timer = 200;
            return;
          }
          const t = this.mineTile(b);
          if (t < 0) {
            b.exhausted = true;
            this.notify(b.owner, `${def.name} has run out.`);
            s.timer = 200;
            return;
          }
          if (!this.feedMiner(b)) {
            s.timer = 30;
            return;
          }
          s.state = "mining";
          s.target = t;
          s.timer = Math.round((def.workTicks ?? 90) * this.speedFactor(s, def.id));
          return;
        }
        const target = this.findJobTarget(b, s);
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
          s.timer = Math.round((def.workTicks ?? 60) * this.speedFactor(s, def.id));
        }
        return;
      case "work": {
        if (--s.timer > 0) return;
        const t = s.target;
        let got = -1;
        const produced = def.produces ? goodId(def.produces) : -1;
        this.train(s, def.id);
        if (def.job === "fell" && land.feature[t] === Feature.Tree && land.amount[t] === TREE_MATURE && land.variety[t] !== MEMORIAL) {
          land.feature[t] = Feature.Stump;
          land.amount[t] = 12;
          land.featureVersion++;
          got = produced;
        } else if (def.job === "quarry" && land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
          land.amount[t]!--;
          if (land.amount[t] === 0) land.feature[t] = Feature.None;
          land.featureVersion++;
          got = produced;
        } else if (def.job === "plant" && land.feature[t] === Feature.None && land.use[t] === Use.Free) {
          land.feature[t] = Feature.Tree;
          land.amount[t] = 0;
          land.variety[t] = (t * 7 + this.tick) & 3;
          land.nextGrowth[t] = this.tick + TREE_GROWTH_TICKS;
          this.growing.push(t);
          land.featureVersion++;
        } else if (def.job === "farm") {
          if (land.feature[t] === Feature.Field && (land.amount[t] as number) >= FIELD_RIPE) {
            land.feature[t] = Feature.None;
            land.amount[t] = 0;
            got = produced;
          } else if (land.feature[t] === Feature.None && land.use[t] === Use.Free) {
            land.feature[t] = Feature.Field;
            land.amount[t] = 0;
            land.nextGrowth[t] = this.tick + FIELD_GROWTH_TICKS;
            this.fieldTiles.push(t);
          }
          land.featureVersion++;
        } else if (def.job === "fish" && s.home >= 0 && (land.fish[s.home] as number) > 0) {
          land.fish[s.home]!--;
          got = produced;
        }
        s.carrying = got;
        const back = land.findPath(t, b.tile, (x) => land.walkable(x) || x === b.tile, 3000);
        s.state = "back";
        s.target = -1;
        s.home = -1;
        this.setPath(s, back ?? [t, b.tile]);
        return;
      }
      case "back":
        if (this.walk(s)) {
          if (s.carrying >= 0) this.produce(b, s.carrying);
          s.carrying = -1;
          s.state = "rest";
          s.timer = def.restTicks ?? 30;
        }
        return;
      case "craft":
        if (--s.timer > 0) return;
        this.train(s, def.id);
        this.produce(b, s.target);
        s.target = -1;
        s.state = "rest";
        s.timer = def.restTicks ?? 10;
        return;
      case "mining": {
        if (--s.timer > 0) return;
        const t = s.target;
        if ((land.depositAmount[t] as number) > 0) {
          this.train(s, def.id);
          land.depositAmount[t]!--;
          if (land.depositAmount[t] === 0) land.deposit[t] = Deposit.None;
          b.food--;
          this.produce(b, def.produces ? goodId(def.produces) : -1);
        }
        s.target = -1;
        s.state = "rest";
        s.timer = def.restTicks ?? 20;
        return;
      }
      case "drop":
        if (this.walk(s)) {
          if (b.output > 0 && flag.goods.length + flag.reserved < FLAG_CAPACITY) {
            b.output--;
            const type = b.outputTypes.shift() as number;
            const g = this.spawnGood(type, flag.id);
            this.assignDestination(g);
          }
          s.carrying = -1;
          s.state = "enter";
          this.setPath(s, [flag.tile, b.tile]);
        }
        return;
      case "enter":
        if (this.walk(s)) {
          s.state = "rest";
          s.timer = def.restTicks ?? 20;
        }
        return;
    }
  }

  /** Geologists wander around their flag, inspect the ground and plant signposts. */
  private stepGeologist(s: Settler): void {
    const land = this.land;
    switch (s.state) {
      case "goto":
      case "walk":
        if (this.walk(s)) {
          if (s.state === "goto") s.state = "pick";
          else {
            s.state = "inspect";
            s.timer = 50;
          }
        }
        return;
      case "pick": {
        if (s.visits <= 0) {
          this.sendHome(s);
          return;
        }
        const options = land.ring(s.home, 4).filter((t) => land.walkable(t) && land.use[t] !== Use.Road && land.sign[t] === 0);
        if (!options.length) {
          this.sendHome(s);
          return;
        }
        const t = options[mix32(this.tick, s.id) % options.length] as number;
        const here = s.path[s.pi] as number;
        const path = land.findPath(here, t, (x) => land.walkable(x), 1500);
        s.visits--;
        if (!path) return;
        this.setPath(s, path);
        s.state = "walk";
        return;
      }
      case "inspect": {
        if (--s.timer > 0) return;
        const t = s.path[s.pi] as number;
        land.sign[t] = land.deposit[t] !== Deposit.None ? (land.deposit[t] as number) + 1 : 1;
        land.signExpire[t] = this.tick + SIGN_TICKS;
        land.signVersion++;
        if (land.deposit[t] !== Deposit.None && land.deposit[t] !== Deposit.Granite)
          this.notify(s.owner, `Geologist found ${DEPOSIT_IDS[land.deposit[t] as number]}.`);
        s.state = "pick";
        return;
      }
    }
  }

  private stepSettler(s: Settler): void {
    if (s.state === "home") {
      if (this.walk(s)) {
        s.alive = false;
        const keep = this.buildings[this.keeps[s.owner] as number] as Building;
        if (s.tool >= 0) keep.stock[s.tool]!++;
        s.tool = -1;
        const person = this.people[s.person];
        if (person) person.settler = -1;
      }
      return;
    }
    if (s.role === "carrier") this.stepCarrier(s);
    else if (s.role === "builder") this.stepBuilder(s);
    else if (s.role === "geologist") this.stepGeologist(s);
    else if (s.role === "warden") this.stepWarden(s);
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
    for (let i = this.fieldTiles.length - 1; i >= 0; i--) {
      const t = this.fieldTiles[i] as number;
      if (land.feature[t] !== Feature.Field) {
        this.fieldTiles.splice(i, 1);
        continue;
      }
      if ((land.amount[t] as number) < FIELD_RIPE && (land.nextGrowth[t] as number) <= this.tick) {
        land.amount[t]!++;
        land.nextGrowth[t] = this.tick + FIELD_GROWTH_TICKS;
        changed = true;
      }
    }
    // Stumps rot away slowly (checked on a rotating slice of tiles).
    const n = land.planet.grid.count;
    const slice = 200;
    const start = ((this.tick / 10) * slice) % n;
    for (let k = 0; k < slice; k++) {
      const t = (start + k) % n;
      if ((land.wear[t] as number) > 0) {
        land.wear[t] = Math.max(0, (land.wear[t] as number) - 6);
        land.wearVersion++;
      }
      if (land.sign[t] !== 0 && (land.signExpire[t] as number) <= this.tick) {
        land.sign[t] = 0;
        land.signVersion++;
      }
      if (!land.isLand(t) && (land.fish[t] as number) > 0 && (land.fish[t] as number) < 12 && (mix32(t, this.tick) & 7) === 0) land.fish[t]!++;
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

  // ------------------------------------------------------------------ life

  /** Hourly: Glow. Daily: meals, growing up, retiring, births and farewells. */
  private stepLife(): void {
    const hour = Math.max(1, Math.round(this.dayTicks / 24));
    const daily = this.tick % this.dayTicks === 0;
    if (this.tick % hour !== 0 && !daily) return;
    for (let p = 0; p < this.keeps.length; p++) {
      if (daily) this.dailyLife(p);
      this.updateGlow(p);
    }
  }

  private members(owner: number, stage?: string): Person[] {
    return this.people.filter((p) => p.alive && p.owner === owner && (!stage || p.stage === stage));
  }

  private houses(owner: number): Building[] {
    return this.buildings.filter((b) => b.alive && b.built && b.owner === owner && b.def.id === "house");
  }

  private updateGlow(owner: number): void {
    const all = this.members(owner);
    if (!all.length) return;
    const adults = all.filter((p) => p.stage !== "child");
    const food = goodsFor("food").reduce((s, g) => s + (this.storageTotals(owner)[g] as number), 0);
    const perDay = Math.max(1, Math.ceil(all.length * 0.45));
    const houses = this.houses(owner);
    const housed = all.filter((p) => p.house >= 0).length;
    const keep = this.buildings[this.keeps[owner] ?? -1];
    let trees = 0;
    if (keep) for (const t of this.land.ring(keep.tile, 7)) if (this.land.feature[t] === Feature.Tree) trees += this.land.variety[t] === MEMORIAL ? 3 : 1;
    const working = adults.filter((p) => p.settler >= 0).length / Math.max(1, adults.length);
    const parts: GlowParts = {
      nourishment: this.hungry[owner] ? 0.1 : Math.min(1, 0.25 + food / (perDay * 4)),
      shelter: Math.min(1, (KEEP_SHELTER + houses.length * HOUSE_ADULTS) / all.length),
      belonging: 0.3 + 0.7 * (housed / all.length),
      beauty: Math.min(1, 0.2 + trees / 30),
      rest: Math.max(0.3, Math.min(1, 1.35 - working)),
    };
    this.glowParts[owner] = parts;
    this.glow[owner] = glowValue(parts);
    if (keep) keep.residents = all.filter((p) => p.stage === "adult" && p.settler < 0 && p.house < 0).length;
  }

  private dailyLife(owner: number): void {
    const r = this.lifeRng as Rng;
    const all = this.members(owner);
    // Meals.
    let need = Math.ceil(all.length * 0.45);
    for (const s of this.buildings) {
      if (!s.alive || !s.def.storage || s.owner !== owner) continue;
      for (const g of goodsFor("food")) {
        while (need > 0 && (s.stock[g] as number) > 0) {
          s.stock[g]!--;
          need--;
        }
      }
    }
    const wasHungry = this.hungry[owner];
    this.hungry[owner] = need > 0;
    if (this.hungry[owner] && !wasHungry) this.notify(owner, "Your people are going hungry. Bread, fish or meat are needed.");
    // Growing up, retiring, farewells.
    for (const p of all) {
      const age = this.ageDays(p);
      if (p.stage === "child" && age >= CHILD_DAYS) {
        p.stage = "adult";
        note(p, "Grew up and is ready to work.");
      } else if (p.stage === "adult" && age >= ELDER_DAYS && p.settler < 0) {
        p.stage = "elder";
        note(p, "Retired, and now teaches the young ones.");
      } else if (this.tick >= p.lifespan && p.settler < 0) {
        this.farewell(p);
      }
    }
    // Move the homeless into houses with room, families together.
    for (const h of this.houses(owner)) {
      let occupants = this.people.filter((p) => p.alive && p.house === h.id);
      const family = occupants[0]?.family;
      const candidates = this.people
        .filter((p) => p.alive && p.owner === owner && p.house < 0)
        .sort((a, b) => Number(b.family === family) - Number(a.family === family) || a.id - b.id);
      for (const p of candidates) {
        if (occupants.length >= HOUSE_CAPACITY) break;
        if (p.stage !== "child" && occupants.filter((o) => o.stage !== "child").length >= HOUSE_ADULTS) continue;
        p.house = h.id;
        occupants = [...occupants, p];
        note(p, `Moved into a house with the ${occupants[0]?.family} family.`);
      }
      // Births: a household with room and at least two adults, in a content settlement.
      const adults = occupants.filter((p) => p.stage !== "child");
      const glow = this.glow[owner] ?? 0;
      if (occupants.length < HOUSE_CAPACITY && adults.length >= 2 && glow >= 45 && !this.hungry[owner] && r.chance(0.2 + glow / 250)) {
        const fam = adults[0]?.family ?? randomFamily(r);
        const child = this.addPerson(owner, randomFirst(r), fam, this.tick, r);
        child.stage = "child";
        child.house = h.id;
        note(child, `Born to the ${fam} family.`);
        this.notify(owner, `${fullName(child)} was born.`);
      }
    }
  }

  private farewell(p: Person): void {
    p.alive = false;
    const house = p.house;
    p.house = -1;
    this.notify(p.owner, `Remembering ${fullName(p)}, ${this.ageDays(p)} days old.`);
    // A memorial tree near where they lived.
    const home = this.buildings[house >= 0 ? house : this.keeps[p.owner] ?? -1];
    if (!home) return;
    const land = this.land;
    for (const t of land.ring(home.tile, 3)) {
      if (!land.isLand(t) || land.use[t] !== Use.Free || land.feature[t] !== Feature.None) continue;
      land.feature[t] = Feature.Tree;
      land.amount[t] = TREE_MATURE;
      land.variety[t] = MEMORIAL;
      land.featureVersion++;
      break;
    }
  }

  /** People of a player, for the UI. */
  peopleOf(owner: number): Person[] {
    return this.members(owner);
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
    this.stepLife();
    if (this.territoryDirty) this.updateTerritory();
    if (tick % 600 === 0) this.compact();
  }

  /** Drop dead goods from the goods array tail to keep memory bounded. */
  private compact(): void {
    while (this.goods.length && !(this.goods[this.goods.length - 1] as Good).alive) this.goods.pop();
    while (this.settlers.length && !(this.settlers[this.settlers.length - 1] as Settler).alive) this.settlers.pop();
  }

  // ------------------------------------------------------------------ queries

  storageTotals(owner = 0): number[] {
    const out = new Array<number>(GOODS.length).fill(0);
    for (const b of this.buildings) if (b.alive && b.def.storage && b.owner === owner) b.stock.forEach((v, i) => (out[i] = (out[i] as number) + v));
    return out;
  }

  population(owner = 0): { idle: number; working: number } {
    const idle = this.people.filter((p) => p.alive && p.owner === owner && p.stage === "adult" && p.settler < 0).length;
    const working = this.settlers.filter((s) => s.alive && s.owner === owner && s.state !== "home").length;
    return { idle, working };
  }

  hash(h: StateHasher): void {
    h.int(this.flags.length).int(this.roads.length).int(this.buildings.length);
    for (const s of this.settlers) if (s.alive) h.int(s.id).int(s.path[s.pi] ?? -1).int(s.prog).int(s.carrying);
    for (const f of this.flags) if (f.alive) h.int(f.goods.length);
    let wear = 0;
    for (let t = 0; t < this.land.wear.length; t += 13) wear += this.land.wear[t] as number;
    h.int(wear);
    for (const b of this.buildings) if (b.alive) h.int(b.consumed).int(b.output).int(b.residents).int(b.garrison.length).int(b.lit ? 1 : 0);
    let owned = 0;
    for (let t = 0; t < this.land.territory.length; t++) owned = (owned + (this.land.territory[t] as number) * (t % 97 + 1)) | 0;
    h.int(owned);
  }
}
