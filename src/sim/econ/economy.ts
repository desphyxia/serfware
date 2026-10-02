import type { StateHasher } from "../hash";
import { dayInfo, ticksPerDay } from "../clock";
import { atan2, TAU } from "../dmath";
import { Region } from "../biomes/regions";
import { sunHeight } from "../biomes/sun";
import { Biome } from "../planet/terrain";
import { mix32, Rng } from "../rng";
import { ARM_BLADE, ARM_BOW, ARM_MOUNT, fullName, glowSpeed, glowValue, note, randomFamily, randomFirst, skillSpeed, title, tradeName, type GlowParts, type Person } from "./people";
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
  COMBAT,
  type BuildingDef,
} from "./defs";
import { MinHeap } from "./heap";
import { Culture, DISCOVERIES, unlockedBy } from "./culture";
import { Adversity, METEORITE } from "./adversity";
import { Wanderers } from "./wanderers";
import { Diplomacy, DIPLOMACY_COMMANDS, type DiplomacyCommand } from "./diplomacy";
import { CLIMATE_STEP, type Climate } from "../climate/climate";
import { Ecology, WELL_REACH } from "./ecology";
import { captureOdds, duelChance, fatigueFor, hasBow, rankTitle, strength, VOLLEY_HIT, type Fighter } from "./combat";
import { Deposit, DEPOSIT_IDS, Feature, fellable, FIELD_GROWTH_TICKS, FIELD_RIPE, GLOWCAP_RIPE, LandUse, MEMORIAL, ORCHARD, SIGN_TICKS, TREE_GROWTH_TICKS, TREE_MATURE, Use } from "./landuse";

/**
 * The Serf City core: flags, roads with one carrier each, goods handed from flag to flag,
 * construction sites, and production buildings with workers. Everything is deterministic:
 * entities live in arrays indexed by id and are always processed in id order.
 */

export const FLAG_CAPACITY = 8;
const TICKS_PER_TILE_ROAD = 11;
const TICKS_PER_TILE_OFFROAD = 16;
const BUILD_TICKS_PER_MATERIAL = 45;
/** Ticks to dig away one unit of ground (see LandUse.levelWork). */
const DIG_TICKS = 120;
const SUPPLY_INTERVAL = 5;
/** Store modes, as in Serf City: In takes goods, Stop only holds them, Out empties the store into the others. */
export const STORE_IN = 0;
export const STORE_STOP = 1;
export const STORE_OUT = 2;
/** An emptying store sends one good out this often (ticks). */
const EMPTY_INTERVAL = 10;
const MAX_ROAD_TILES = 24;
/**
 * Carriers a road may have in all, by its length (as in Serf City): one on a short road, more
 * on long ones. Extra carriers are called when goods queue (see dispatch) and go home when idle.
 */
export function helperCap(length: number): number {
  return length >= 24 ? 15 : length >= 18 ? 11 : length >= 13 ? 8 : length >= 10 ? 6 : length >= 7 ? 4 : length >= 6 ? 3 : length >= 4 ? 2 : 1;
}
/** Goods queued one way on a road before another carrier is called. */
const QUEUE_FOR_HELPER = 3;
/** Places a good moves up the transport priority for each hour it waits on a flag. */
const RANK_PER_HOUR = 6;

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
  /** Extra carriers called to a busy road (Serf City's rule; see helperCap). */
  helpers: number[];
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
  /** Tick it was put down on its flag (goods that wait long go first). */
  since: number;
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
  /** Ground still to be dug away before building can start (large buildings on a slope). */
  dig: number;
  /** Stores: 0 takes goods in, 1 keeps what it holds but takes no more, 2 carries its goods out to other stores. */
  mode: number;
  /** How near another player's land is: 0 far (inland), 1 near, 2 close (the frontier). */
  threat: number;
  /** Tick it was cut off on someone else's land, or -1. Stranded buildings stand idle. */
  stranded: number;
  /** Attackers waiting at the door, and the duel being fought there. */
  siege: number[];
  duel: { attacker: number; defender: number; until: number } | null;
  /** Hearthships: militia raised today (at most five a day). */
  levy: number;
  /** Weathering 0..1: rain and years wear it; at half, it asks for a plank (or stone) of upkeep. */
  wear: number;
  /** Soot on forge walls and moss on damp roofs, 0..1 (looks only). */
  soot: number;
  moss: number;
  /** Fire damage: at 3 it burns down (the Hearthship only chars). */
  burn: number;
  /** Heated buildings (waystations): warm until this tick on the last log burned. */
  fuelUntil: number;
  /** Launch rails: cargo wanted for the voyages loading here, by good. */
  want?: number[];
  alive: boolean;
}

/** Per-player economy preferences: distribution weights and tool priorities (0..1). */
export interface Prefs {
  dist: Record<string, Record<string, number>>;
  tools: Record<string, number>;
  /** Share of warden places to fill, near other players' borders and further inside. */
  garrison: { frontier: number; inland: number; near?: number };
  /** Transport priority: goods carriers pick up first, first in the list first (good ids). */
  transport: string[];
}

/**
 * Default transport priority, after Serf City's: building materials first, then what feeds the
 * smithies and the people, tools and arms, and gold last. Goods not listed (mods) come after.
 */
export const DEFAULT_TRANSPORT = [
  "plank", "stone", "skystone", "glass", "iron", "coal", "peat", "log", "obsidian", "ironore", "salt",
  "bread", "fish", "meat", "fruit", "honey", "shellfish", "glowcap",
  "blade", "bow", "mount",
  "hammer", "shovel", "pick", "axe", "saw", "rod", "cleaver", "scythe", "crook", "tongs",
  "livestock", "flour", "grain", "relic", "gold", "goldore",
];

export type Role = "carrier" | "builder" | "worker" | "geologist" | "warden" | "attacker";

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
  /** Carriers in a swap: the flag where a place is kept for the good they bring back, or -1. */
  back: number;
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
/** Buildings (not counting storage) a colony needs before it has taken root. */
export const ROOTED_BUILDINGS = 8;
/** Ticks between harvests of one orchard tree (about six in-game hours). */
const FRUIT_TICKS = 1800;
/** Tree variety used for memorial trees; woodcutters leave them standing. */
export { MEMORIAL } from "./landuse";

/** Player commands. `player` defaults to 0; in shared-keep co-op everyone acts as player 0. */
export type Command = (
  | { t: "flag"; tile: number }
  | { t: "road"; tiles: number[] }
  | { t: "build"; type: string; tile: number; flagTile: number }
  | { t: "demolish"; tile: number }
  | { t: "geologist"; flagTile: number }
  | { t: "prio"; key: string; target: string; value: number }
  | { t: "toolprio"; tool: string; value: number }
  | { t: "transport"; good: string; to: number }
  | { t: "storeMode"; building: number; mode: number }
  | { t: "rotate" }
  | { t: "garrison"; zone: "frontier" | "near" | "inland"; value: number }
  | { t: "attack"; target: number; count: number; order?: "strongest" | "weakest" }
  | { t: "hedge"; tile: number }
  | { t: "causeway"; tile: number }
  | DiplomacyCommand
  | { t: "send"; to: number; good: string; count: number }
) & { player?: number };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

/** A founder aboard a Hearthship: who they are, carried to the new world. */
export interface Founder {
  first: string;
  family: string;
  born: number;
  skills: Record<string, number>;
  journal: string[];
  /** Planet index they were raised on, and their stride there (see Person). */
  origin: number;
  stride: number;
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
  /** Seasons and weather (set by the world). Fields only grow in the growing season. */
  climate: Climate | null = null;
  private combatRng: Rng | null = null;
  /** "wounded": the loser of a duel limps home; "mortal": they fall. */
  stakes: "wounded" | "mortal" = "wounded";
  /** No attacks before this tick. */
  peaceUntil = 0;
  readonly defeated: boolean[] = [];
  /** Per player: until this tick, lanterns near a border swap their weakest warden for a stronger free one (-1: not rotating). */
  readonly rotateUntil: number[] = [];
  /** Player who has won, or -1. */
  winner = -1;
  winReason = "";
  /** Per player: tick since they have held enough Star Wells, or -1. */
  readonly wellsSince: number[] = [];
  readonly dayTicks: number;
  private hungry: boolean[] = [];
  private readonly fieldTiles: number[] = [];
  tick = 0;
  /** The Almanac, festivals and the joy and wonder they bring (see culture.ts). */
  readonly culture: Culture;
  /** Floods, blight, cold snaps, meteors and pests, and the difficulty (see adversity.ts). */
  readonly adversity: Adversity;
  /** Treaties between settlements, reputation and shame (see diplomacy.ts). */
  readonly diplomacy: Diplomacy;
  /** Nomad caravans, hamlets in the wild, and native creatures (see wanderers.ts). */
  readonly wanderers: Wanderers;
  /** Players run by the computer (they answer offers themselves). */
  readonly aiPlayers = new Set<number>();
  /** Per player: team (allies share sight, may lay roads on each other's land and win together). */
  readonly teams: number[] = [];
  /** How this world is won: the last settlement standing or Star Wells ("conquest"), or the first colony to bloom ("bloom"). */
  goal: "conquest" | "bloom" = "conquest";
  /** Per player: the settlement's name, if it has one. */
  readonly names: string[] = [];
  /** A colony world (settled from a Hearthship voyage, not a starting world). */
  colony = false;
  /** Terraforming works finished a cycle (the world passes it to the planet's atmosphere). */
  onTerraform: ((b: Building) => void) | null = null;
  /** Colony worlds, per player: taken root (enough built that newcomers arrive). */
  readonly rooted: boolean[] = [];
  /** Colony worlds, per player: how far its ways have drifted from home, 0..1. */
  readonly drift: number[] = [];
  /** Messages for players (the UI shows its own player's and clears them). */
  readonly notices: { owner: number; text: string }[] = [];
  /** Per player: tiles lit right now, and tiles ever seen (fog of war). */
  readonly visible: Uint8Array[] = [];
  readonly explored: Uint8Array[] = [];
  /** Bumped when territory or sight changes. */
  visionVersion = 0;
  private territoryDirty = false;
  /** Tiles whose owner is decided afresh (nearest lantern) at the next recount: where a lantern fell. */
  private readonly recontest = new Set<number>();
  /** Fire, succession, erosion, groundwater, wildlife and pollinators. */
  readonly ecology: Ecology;
  /** Per tile: covered by a working well (rebuilt when buildings change). */
  private wellMap: Uint8Array;
  private wellMapVersion = -1;

  constructor(readonly land: LandUse) {
    this.dayTicks = ticksPerDay(land.planet.params.dayLengthHours);
    this.wellMap = new Uint8Array(land.planet.grid.count);
    this.ecology = new Ecology(land, {
      dayLength: this.dayTicks,
      wellCovers: (t) => this.wellCovers(t),
      beesBoost: (t) => this.apiaryNear(t),
      scorchBuilding: (t) => this.scorchBuilding(t),
      seedling: (t) => this.growing.push(t),
      temp: (t) => this.climate?.temp[t] ?? (land.planet.terrain.temperature[t] as number),
      rain: (t) => this.climate?.rain[t] ?? 0,
      notifyFire: (t) => {
        const owner = (land.territory[t] as number) - 1;
        if (owner >= 0) {
          this.notify(owner, "Lightning has started a fire on your land! Wells nearby put fires out.");
          this.culture.discover(owner, "fire");
        }
      },
    });
    land.aquifer = this.ecology.aquifer;
    land.flagServes = (t) => (this.flagAt(t)?.building ?? -1) >= 0;
    land.largeAt = (t) => !!this.buildings[land.ref[t] as number]?.def.large;
    land.lanternAt = (t) => !!this.buildings[land.ref[t] as number]?.def.slots;
    this.culture = new Culture(this);
    this.adversity = new Adversity(this);
    this.diplomacy = new Diplomacy(this);
    this.wanderers = new Wanderers(this);
  }

  /** People who join at once (a hamlet coming in): one family, arriving grown up. */
  welcome(owner: number, n: number, why: string): void {
    const r = this.lifeRng;
    if (!r) return;
    const family = randomFamily(r);
    for (let i = 0; i < n; i++) note(this.addPerson(owner, randomFirst(r), family, this.tick - r.int(17, 40) * this.dayTicks, r), why);
  }

  /** Roads across land no longer shared (a shared-roads treaty ended) are taken up. */
  dropForeignRoads(): void {
    for (const r of this.roads) if (r.alive && r.tiles.slice(1, -1).some((t) => !this.land.mayRoad(t, r.owner))) this.removeRoad(r);
  }

  /** Same player, or both on one team. */
  allied(p: number, q: number): boolean {
    if (p === q) return true;
    const a = this.teams[p];
    return a !== undefined && a === this.teams[q];
  }

  /** Everyone allied with `p` (p included). */
  team(p: number): number[] {
    return this.keeps.map((_, q) => q).filter((q) => this.keeps[q] !== undefined && this.allied(p, q));
  }

  playerName(p: number): string {
    return this.names[p] ?? (p === 0 ? "the first settlement" : `settlement ${p + 1}`);
  }

  /** Remove a building struck down by disaster (a meteor). */
  removeBuildingAt(t: number): void {
    const b = this.buildingAt(t);
    if (b?.alive) this.removeBuilding(b);
  }

  /** Apiaries within three steps: their bees make the flowers there busier. */
  private apiaryMap: Uint8Array | null = null;
  private apiaryMapVersion = -1;
  apiaryNear(t: number): boolean {
    if (!this.apiaryMap || this.apiaryMapVersion !== this.structureVersion) {
      this.apiaryMapVersion = this.structureVersion;
      this.apiaryMap ??= new Uint8Array(this.land.planet.grid.count);
      this.apiaryMap.fill(0);
      for (const b of this.buildings) {
        if (!b.alive || !b.built || b.def.job !== "bees") continue;
        this.apiaryMap[b.tile] = 1;
        for (const m of this.land.ring(b.tile, 3)) this.apiaryMap[m] = 1;
      }
    }
    return this.apiaryMap[t] === 1;
  }

  /** A built well with water in it covers this tile. */
  wellCovers(t: number): boolean {
    if (this.wellMapVersion !== this.structureVersion) {
      this.wellMapVersion = this.structureVersion;
      this.wellMap.fill(0);
      for (const b of this.buildings) {
        if (!b.alive || !b.built || !(b.def.well || b.def.dew)) continue;
        this.wellMap[b.tile] = 1;
        for (const m of this.land.ring(b.tile, WELL_REACH)) this.wellMap[m] = 1;
      }
    }
    return this.wellMap[t] === 1;
  }

  /** Fire licks at the building on this tile. */
  private scorchBuilding(t: number): void {
    const b = this.buildingAt(t);
    if (!b || !b.alive) return;
    b.wear = Math.min(1, b.wear + 0.15);
    b.soot = Math.min(1, b.soot + 0.3);
    if (this.keeps.includes(b.id) || !b.built) return;
    // Gentle: fire scorches but never takes a building. Hard: it burns down sooner.
    const diff = this.adversity.difficulty;
    if (diff === "gentle" && b.burn >= 2) return;
    b.burn++;
    if (b.burn === 1) this.notify(b.owner, `Your ${b.def.name.toLowerCase()} has caught fire! A well within five steps would save it.`);
    if (b.burn >= (diff === "hard" ? 2 : 3)) {
      this.notify(b.owner, `Your ${b.def.name.toLowerCase()} has burned down.`);
      this.removeBuilding(b);
    }
  }

  // ------------------------------------------------------------------ setup

  /** Player 0's keep (single player and shared co-op). */
  get keep(): number {
    return this.keeps[0] ?? -1;
  }

  /** Choose a start site for `player`, place the keep, claim territory and make sure the start is playable. */
  /**
   * How good a start site is, the way fair starts compare them: fresh water near by, ore in the
   * ground, the soil, and how close the nearest Star Well is. 0..40.
   */
  siteScore(t: number): number {
    const land = this.land;
    const grid = land.planet.grid;
    let water = 0;
    let ore = 0;
    let soil = 0;
    let n = 0;
    for (const x of land.ring(t, 7)) {
      if (!land.isLand(x)) water++;
      else {
        soil += land.soil[x] as number;
        n++;
        if (land.deposit[x]) ore++;
      }
    }
    let well = Infinity;
    this.wellTiles ??= Array.from({ length: grid.count }, (_, w) => w).filter((w) => grid.degree(w) === 5);
    for (const w of this.wellTiles) {
      const dx = (grid.center[w * 3] as number) - (grid.center[t * 3] as number);
      const dy = (grid.center[w * 3 + 1] as number) - (grid.center[t * 3 + 1] as number);
      const dz = (grid.center[w * 3 + 2] as number) - (grid.center[t * 3 + 2] as number);
      well = Math.min(well, Math.sqrt(dx * dx + dy * dy + dz * dz) / land.spacing);
    }
    return 10 * Math.min(1, (water > 0 ? 8 + Math.min(water, 22) : 0) / 30) + 10 * Math.min(1, ore / 12) + 10 * (n ? soil / n : 0) + 10 * Math.max(0, 1 - well / 30);
  }

  private wellTiles: number[] | null = null;

  /** Per player: the start site's score (see siteScore). */
  readonly startScores: number[] = [];

  /**
   * Ore for every start: coal and iron within 10 steps of the Hearthship, gold within 14 and
   * granite within 10. Where a kind is missing, a small deposit (a core and a rim) is laid in the
   * nearest hills that have none of the four, so no one starts without the means to make tools.
   */
  guaranteeOre(): void {
    const land = this.land;
    const needs: [Deposit, number][] = [[Deposit.Coal, 10], [Deposit.Iron, 10], [Deposit.Gold, 14], [Deposit.Granite, 10]];
    for (let p = 0; p < this.keeps.length; p++) {
      const keep = this.buildings[this.keeps[p] ?? -1];
      if (!keep) continue;
      for (const [kind, reach] of needs) {
        const within = land.ring(keep.tile, reach);
        if (within.some((t) => land.deposit[t] === kind)) continue;
        // The nearest hill (four steps or more from the Hearthship) with no ore under it yet.
        const near = new Set<number>(land.ring(keep.tile, 3));
        let site = -1;
        for (let k = 4; k <= reach && site < 0; k++) {
          const ring = land.ring(keep.tile, k).filter((t) => !near.has(t));
          for (const t of ring) near.add(t);
          site = ring.find((t) => land.isMountain(t) && land.isLand(t) && land.deposit[t] === Deposit.None && land.use[t] === Use.Free) ?? -1;
        }
        if (site < 0) continue;
        land.deposit[site] = kind;
        land.depositAmount[site] = 28;
        for (const n of land.planet.grid.neighborsOf(site))
          if (land.isMountain(n) && land.isLand(n) && land.deposit[n] === Deposit.None) {
            land.deposit[n] = kind;
            land.depositAmount[n] = 18;
          }
      }
    }
  }

  /**
   * Fair starts, the last step: where no site came close enough, bring the poorer starts up to
   * within 5 % of the richest with more ore in the hills around them and better soil.
   */
  evenStarts(): void {
    const land = this.land;
    const players = this.keeps.map((_, p) => p).filter((p) => this.buildings[this.keeps[p] ?? -1]);
    const tileOf = (p: number) => (this.buildings[this.keeps[p] as number] as Building).tile;
    const area = (p: number) => land.ring(tileOf(p), 7).filter((t) => land.isLand(t));
    for (const p of players) this.startScores[p] = this.siteScore(tileOf(p));
    // Raise the poorest where it can be raised (more ore, better soil); else temper the richest.
    for (let i = 0; i < 240; i++) {
      const by = players.slice().sort((x, y) => (this.startScores[x] as number) - (this.startScores[y] as number));
      const lo = by[0] as number;
      const hi = by[by.length - 1] as number;
      if ((this.startScores[lo] as number) >= (this.startScores[hi] as number) * 0.96) break;
      const low = area(lo);
      const bare = low.filter((t) => !land.deposit[t] && land.use[t] === Use.Free && (land.ring(tileOf(lo), 4).indexOf(t) < 0));
      if (low.filter((t) => land.deposit[t]).length < 12 && bare.length) {
        const t = bare[(mix32(lo * 977 + i, tileOf(lo)) >>> 0) % bare.length] as number;
        land.deposit[t] = 1 + (i % 3);
        land.depositAmount[t] = 20;
      } else if (low.some((t) => (land.soil[t] as number) < 1)) {
        for (const t of low) land.soil[t] = Math.min(1, (land.soil[t] as number) + 0.04);
      } else {
        for (const t of area(hi)) land.soil[t] = Math.max(0.2, (land.soil[t] as number) - 0.04);
        this.startScores[hi] = this.siteScore(tileOf(hi));
        continue;
      }
      this.startScores[lo] = this.siteScore(tileOf(lo));
    }
  }

  setupStart(rng: Rng, player = 0, fairTo?: number): void {
    const others = this.keeps.map((k) => (this.buildings[k] as Building).tile);
    const land = this.land;
    const { grid, terrain } = land.planet;
    let best = -1;
    let bestScore = -Infinity;
    // Room to build first: sites with too little flat land are a last resort (a start on a
    // narrow spit of land between sea and cliffs stalls, however fair its water and ore look).
    const MIN_FLAT = 80;
    let roomy = false;
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
        else spread -= (Math.abs(ang - land.spacing * (START.territoryRadius * 2 + 10)) / land.spacing) * 6;
      }
      // Fair starts: a site more than 5 % better or worse than the first player's is a last resort.
      if (flatLand < MIN_FLAT && roomy) continue;
      // Fair starts: prefer a site close to the first player's (evenStarts closes the rest of the gap).
      const fair = fairTo === undefined ? 0 : Math.abs(this.siteScore(t) / fairTo - 1) > 0.05 ? -40 : 0;
      const score =
        fair +
        spread +
        flatLand * 1.0 + Math.min(trees, 40) * 0.8 + Math.min(rocks, 10) * 1.5 + (water > 0 && water < 40 ? 15 : 0) - lat * 30 - slope * 20 + rng.next() * 3;
      // The first roomy site found outranks every cramped one before it.
      if (flatLand >= MIN_FLAT && !roomy) {
        roomy = true;
        bestScore = -Infinity;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best < 0) throw new Error("No start site found");
    this.startScores[player] = this.siteScore(best);
    this.settleAt(best, rng, player);
  }

  /**
   * Can a Hearthship come down here? Flat, dry land with room around it, outside anyone's
   * territory. Returns why not, or null.
   */
  landingProblem(t: number): string | null {
    const land = this.land;
    const { grid, terrain } = land.planet;
    if (t < 0 || t >= grid.count || !land.isLand(t)) return "Land on dry ground.";
    if (grid.degree(t) === 5) return "That is a Star Well: land beside it, not on it.";
    if (land.territory[t] !== 0) return "Someone has already settled there.";
    if ((terrain.elevation[t] as number) > terrain.params.mountainHeight * 0.45 || land.slope(t) > 1.1) return "Too steep to land.";
    if (land.ring(t, 2).some((n) => !land.isLand(n))) return "Too close to the water.";
    return null;
  }

  /**
   * Place a keep on `best` for `player`: clear the ground, make sure the first chains can run,
   * claim the land and move the founders in. Without `founders`, the standard start.
   */
  settleAt(best: number, rng: Rng, player: number, founders?: { people: Founder[]; stock: number[]; radius: number }): void {
    const land = this.land;
    const { grid } = land.planet;
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
    // Colonists find what the planet has: no woods are planted for them on bare worlds.
    for (let i = 0; !founders && count(Feature.Tree) < 18 && i < 80 && far.length; i++) {
      const n = rng.pick(far);
      if (land.feature[n] === Feature.None) {
        land.feature[n] = Feature.Tree;
        land.amount[n] = TREE_MATURE;
        land.variety[n] = rng.int(0, 3);
      }
    }
    land.featureVersion++;
    land.claim(best, founders?.radius ?? START.territoryRadius, player);

    const flagTile = land.bestFlagTile(best, player);
    const flag = this.createFlag(flagTile, player);
    const keep = this.createBuilding(buildingType("keep"), best, flag.id, player);
    keep.built = true;
    keep.lit = true;
    this.lifeRng ??= rng.fork("life");
    this.combatRng ??= rng.fork("combat");
    this.defeated[player] = false;
    this.wellsSince[player] = -1;
    const r = rng.fork(`people-${player}`);
    if (founders) {
      for (const f of founders.people) {
        const p = this.addPerson(player, f.first, f.family, f.born, r);
        p.skills = { ...f.skills };
        p.journal = [...f.journal];
        p.origin = f.origin;
        p.stride = f.stride;
      }
      keep.residents = founders.people.length;
      keep.stock = [...founders.stock];
    } else {
      let family = randomFamily(r);
      for (let i = 0; i < START.settlers; i++) {
        if (i % 3 === 0) family = randomFamily(r);
        const age = r.int(16, 34);
        this.addPerson(player, randomFirst(r), family, -age * this.dayTicks, r);
      }
      keep.residents = START.settlers;
      keep.stock = goodsArray(START.stock);
    }
    for (const n of land.planet.grid.neighborsOf(best)) if (n !== flagTile && land.use[n] === Use.Free) land.use[n] = Use.Blocked;
    this.keeps[player] = keep.id;
    this.prefs[player] = JSON.parse(JSON.stringify({ dist: DEFAULT_DISTRIBUTION, tools: DEFAULT_TOOL_PRIORITY, garrison: START.garrison, transport: DEFAULT_TRANSPORT })) as Prefs;
    this.glow[player] = 60;
    this.glowParts[player] = { nourishment: 0.8, shelter: 0.6, belonging: 0.4, beauty: 0.5, rest: 1, variety: 0.6, joy: 0.5, wonder: 0.4 };
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
      rank: 0,
      xp: 0,
      arms: 0,
      woundedUntil: 0,
      alive: true,
    };
    this.people.push(p);
    return p;
  }

  /**
   * How long a field takes to grow a stage: rich soil, water nearby and a hedgerow of trees to
   * break the wind all help.
   */
  fieldGrowthTicks(t: number): number {
    const land = this.land;
    const rules = land.regionOf(t).rules;
    let hedge = 0;
    for (const n of land.planet.grid.neighborsOf(t)) {
      if (land.feature[n] === Feature.Hedge) hedge = Math.max(hedge, rules.hedgeBonus);
      else if (land.feature[n] === Feature.Tree) hedge = Math.max(hedge, 0.15);
    }
    // Dew condensers water the dry Saltglass fields around them.
    const dew = this.dewNear(t) ? 0.6 : 0;
    const f = 0.75 + (land.soil[t] as number) + (land.nearWater(t, 2) ? 0.2 : 0) + hedge + dew;
    // Bees and other pollinators from wild ground nearby help the crop along; hardy seed kept
    // after a blight grows faster for a while.
    const owner = (land.territory[t] as number) - 1;
    const hardy = owner >= 0 && (this.adversity.hardyUntil[owner] ?? -1) > this.tick ? 1.25 : 1;
    return Math.round(FIELD_GROWTH_TICKS / (f * this.ecology.pollination(t) * rules.fieldGrowth * hardy));
  }

  /** Ticks per growth stage of a young tree: the Canopy Deeps grow fast, the tundra slow. */
  treeGrowthTicks(t: number): number {
    return Math.round(TREE_GROWTH_TICKS / this.land.regionOf(t).rules.treeGrowth);
  }

  /** A grown orchard tree with fruit ready (only in the growing season). */
  inFruit(t: number): boolean {
    const land = this.land;
    return land.feature[t] === Feature.Tree && land.variety[t] === ORCHARD && land.amount[t] === TREE_MATURE && (land.nextGrowth[t] as number) <= this.tick && (!this.climate || this.climate.growing(t));
  }

  /** Soil rests: land that isn't farmed slowly regains its nitrogen. */
  private restSoil(): void {
    const land = this.land;
    for (let t = 0; t < land.soil.length; t++) {
      if (!land.isLand(t) || land.feature[t] === Feature.Field) continue;
      // Bare, washed slopes don't recover while they stay bare.
      if ((this.ecology.cover[t] as number) < 90 && land.slope(t) > 0.9) continue;
      const cap = Math.min(1, 0.35 + 0.5 * (land.planet.terrain.moisture[t] as number) + (land.isRiver(t) ? 0.15 : 0));
      if ((land.soil[t] as number) < cap) land.soil[t] = Math.min(cap, (land.soil[t] as number) + 0.03);
    }
  }

  /** Ticks in a game day. */
  get dayLength(): number {
    return this.dayTicks;
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
    if (DIPLOMACY_COMMANDS.has(cmd.t)) return this.diplomacy.apply(cmd as DiplomacyCommand);
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
      case "rotate":
        if (this.defeated[p]) return { ok: false, reason: "Your settlement has fallen." };
        this.rotateUntil[p] = this.tick + Math.round(this.dayTicks / 2);
        this.notify(p, "Rotating wardens: the strongest are called to the lanterns near the border.");
        return { ok: true };
      case "storeMode": {
        const b = this.buildings[cmd.building];
        if (!b || !b.alive || b.owner !== p || !b.def.storage) return { ok: false, reason: "That isn't one of your stores." };
        if (this.keeps.includes(b.id)) return { ok: false, reason: "The Hearthship always takes goods in." };
        if (cmd.mode !== STORE_IN && cmd.mode !== STORE_STOP && cmd.mode !== STORE_OUT) return { ok: false, reason: "Unknown store mode." };
        if (b.mode === cmd.mode) return { ok: true };
        b.mode = cmd.mode;
        // Goods on their way here are sent somewhere else, as in Serf City.
        if (cmd.mode !== STORE_IN)
          for (const g of this.goods) {
            if (!g.alive || g.dest !== b.id) continue;
            b.pending[g.type] = Math.max(0, (b.pending[g.type] as number) - 1);
            g.dest = -1;
          }
        return { ok: true };
      }
      case "transport": {
        if (!GOOD_INDEX.has(cmd.good)) return { ok: false, reason: "Unknown good." };
        const list = (this.prefs[p] as Prefs).transport;
        const rest = list.filter((x) => x !== cmd.good);
        rest.splice(Math.max(0, Math.min(rest.length, Math.round(cmd.to))), 0, cmd.good);
        (this.prefs[p] as Prefs).transport = rest;
        return { ok: true };
      }
      case "attack":
        return this.cmdAttack(cmd.target, cmd.count, p, cmd.order);
      case "hedge":
        return this.cmdHedge(cmd.tile, p);
      case "causeway":
        return this.cmdCauseway(cmd.tile, p);
      case "send":
        return this.cmdSend(p, cmd.to, cmd.good, cmd.count);
      case "garrison":
        if (cmd.zone !== "frontier" && cmd.zone !== "near" && cmd.zone !== "inland") return { ok: false, reason: "Unknown zone." };
        (this.prefs[p] as Prefs).garrison[cmd.zone] = Math.max(0, Math.min(1, cmd.value));
        return { ok: true };
    }
    return { ok: false, reason: "Unknown command." };
  }

  /** Allies: send goods from your Hearthship's stores straight to theirs. */
  private cmdSend(p: number, to: number, good: string, count: number): CommandResult {
    if (to === p || !this.allied(p, to) || this.keeps[to] === undefined) return { ok: false, reason: "Only allies can be sent goods." };
    const g = GOOD_INDEX.get(good);
    const from = this.buildings[this.keeps[p] as number] as Building;
    const dest = this.buildings[this.keeps[to] as number] as Building;
    if (g === undefined || !dest.alive) return { ok: false, reason: "Nothing to send." };
    const n = Math.min(Math.max(0, Math.floor(count)), from.stock[g] as number);
    if (n <= 0) return { ok: false, reason: `No ${GOODS[g]!.name.toLowerCase()} in your Hearthship's stores.` };
    from.stock[g] = (from.stock[g] as number) - n;
    dest.stock[g] = (dest.stock[g] as number) + n;
    this.notify(to, `${this.playerName(p)} sends you ${n} ${GOODS[g]!.name.toLowerCase()}.`);
    return { ok: true };
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
    if (!this.culture.unlocked(p, def.id)) return { ok: false, reason: `${def.name}: not yet in your Almanac. It comes with "${DISCOVERIES[unlockedBy(def.id)!].title}" (L).` };
    if ((def.terra || def.reserve) && !this.colony) return { ok: false, reason: "Your home world already blooms: terraforming works are for the worlds you colonise." };
    if ((def.terra || def.reserve) && !this.rooted[p]) return { ok: false, reason: `Terraforming needs a colony that has taken root (${ROOTED_BUILDINGS} buildings standing).` };
    if (def.rail && this.colony && !this.rooted[p]) return { ok: false, reason: `A colony needs ${ROOTED_BUILDINGS} buildings standing (it must take root) before it can build a launch rail.` };
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
    if (def.terrain === "aquifer") return "There's too little groundwater here for a well. Try lower, wetter ground near rivers.";
    if (def.terrain === "saltpan") return `${def.name} pans go on the Saltglass Flats or by the sea.`;
    if (def.terrain === "vent") return `A ${def.name.toLowerCase()} must stand right next to a geothermal vent.`;
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
        if (b.def.storage) {
          const held = b.stock.reduce((a, n) => a + n, 0);
          if (held > 0) return { ok: false, reason: `This store still holds ${held} goods. Set it to Out and wait until it is empty.` };
        }
        this.removeBuilding(b);
        return { ok: true };
      }
      case Use.Road:
        this.removeRoad(this.roads[ref] as Road);
        return { ok: true };
      case Use.Flag: {
        const f = this.flags[ref] as Flag;
        if (this.keeps.includes(f.building)) return { ok: false, reason: "The Hearthship needs its flag." };
        if (f.building >= 0) {
          this.removeFlag(f);
          return { ok: true };
        }
        const roads = f.roads.map((r) => this.roads[r] as Road).filter((r) => r.alive);
        // A junction holds a network together: take its roads away first.
        if (roads.length >= 3) return { ok: false, reason: `This flag joins ${roads.length} roads. Demolish the roads first.` };
        if (roads.length === 2) return this.joinAtFlag(f, roads[0] as Road, roads[1] as Road);
        this.removeFlag(f);
        return { ok: true };
      }
      default: {
        // Grubbing up a hedgerow, or marking an ancient giant for the woodcutters.
        if (land.territory[tile] !== p + 1) return { ok: false, reason: "Nothing to demolish here." };
        if (land.feature[tile] === Feature.Hedge) {
          land.feature[tile] = Feature.None;
          land.featureVersion++;
          return { ok: true };
        }
        if (land.feature[tile] === Feature.Giant) {
          const marked = land.variety[tile] === 1;
          land.variety[tile] = marked ? 0 : 1;
          land.featureVersion++;
          this.notify(p, marked ? "The ancient tree is spared." : "Marked the ancient tree for felling. A woodcutter in reach will take it down: ten logs, but your people will grieve and the forest will empty.");
          return { ok: true };
        }
        return { ok: false, reason: "Nothing to demolish here." };
      }
    }
  }

  /** Raise a causeway on a tidal flat (under a road or ready for one); it takes a stone from storage. */
  private cmdCauseway(tile: number, p: number): CommandResult {
    const land = this.land;
    if (!land.tidal[tile] || land.territory[tile] !== p + 1) return { ok: false, reason: "Causeways go on your own tidal flats." };
    if (land.causeway[tile]) return { ok: false, reason: "There is a causeway here already." };
    if (land.use[tile] === Use.Building) return { ok: false, reason: "Buildings on the flats stand on stilts already." };
    if (this.takeTool(p, goodId("stone")) < 0) return { ok: false, reason: "A causeway needs a stone in storage." };
    land.causeway[tile] = 1;
    land.causewayVersion++;
    this.graphVersion++;
    return { ok: true };
  }

  /** Plant a hedgerow on an open tile of your land; it takes a log from storage. */
  private cmdHedge(tile: number, p: number): CommandResult {
    const land = this.land;
    if (!land.isLand(tile) || land.territory[tile] !== p + 1) return { ok: false, reason: "Hedgerows go on your own land." };
    if (land.use[tile] !== Use.Free || (land.feature[tile] !== Feature.None && land.feature[tile] !== Feature.Shrub)) return { ok: false, reason: "There's no room for a hedgerow here." };
    if (land.planet.grid.degree(tile) === 5) return { ok: false, reason: "Star Wells are sacred ground." };
    if (this.takeTool(p, goodId("log")) < 0) return { ok: false, reason: "A hedgerow needs a log in storage." };
    land.feature[tile] = Feature.Hedge;
    land.amount[tile] = 0;
    land.featureVersion++;
    return { ok: true };
  }

  /** Grief after an ancient giant falls: until this tick, Glow's beauty and belonging suffer. */
  readonly griefUntil: number[] = [];

  /** An ancient giant has come down: its logs are gone from the world forever, and so is its calm. */
  private ancientFelled(t: number, owner: number): void {
    const land = this.land;
    this.griefUntil[owner] = this.tick + this.dayTicks * 3;
    for (const m of [t, ...land.ring(t, 3)]) this.ecology.game[m] = Math.round((this.ecology.game[m] as number) * 0.35);
    this.notify(owner, "The ancient tree has fallen. The forest has gone quiet, and your people mourn it (Glow suffers for three days).");
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
    this.clearShrub(tile);
    this.land.use[tile] = Use.Flag;
    this.land.ref[tile] = f.id;
    this.structureVersion++;
    this.graphVersion++;
    this.land.useVersion++;
    return f;
  }

  private createRoad(a: number, b: number, tiles: number[], owner: number): Road {
    const r: Road = { id: this.roads.length, owner, a, b, tiles: [...tiles], carrier: -1, helpers: [], alive: true };
    this.roads.push(r);
    (this.flags[a] as Flag).roads.push(r.id);
    (this.flags[b] as Flag).roads.push(r.id);
    for (let i = 1; i < tiles.length - 1; i++) {
      const t = tiles[i] as number;
      this.clearShrub(t);
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
      dig: 0,
      mode: STORE_IN,
      threat: 0,
      stranded: -1,
      siege: [],
      duel: null,
      levy: 0,
      wear: 0,
      soot: 0,
      moss: 0,
      burn: 0,
      fuelUntil: 0,
      alive: true,
    };
    this.buildings.push(b);
    (this.flags[flagId] as Flag).building = b.id;
    const land = this.land;
    b.dig = def.buildable === false ? 0 : land.levelWork(tile, !!def.large);
    land.use[tile] = Use.Building;
    land.ref[tile] = b.id;
    // Everything on the ground is cleared, except the giant a treehouse is built into.
    if (land.feature[tile] !== Feature.None && def.terrain !== "giant") {
      land.feature[tile] = Feature.None;
      land.featureVersion++;
    }
    this.structureVersion++;
    land.useVersion++;
    return b;
  }

  private clearShrub(t: number): void {
    if (this.land.feature[t] === Feature.Shrub) {
      this.land.feature[t] = Feature.None;
      this.land.featureVersion++;
    }
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
    const helpers = [...road.helpers];
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
    for (const id of helpers) this.dismissCarrier(this.settlers[id] as Settler, road, a, b);
    road.helpers = [];
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
    if (road.carrier >= 0) this.dismissCarrier(this.settlers[road.carrier] as Settler, road, road.a, road.b);
    for (const id of [...road.helpers]) this.dismissCarrier(this.settlers[id] as Settler, road, road.a, road.b);
    road.carrier = -1;
    road.helpers = [];
    this.rerouteAll();
  }

  /** A carrier leaves its road: what it carried is put down at the nearer end, then it goes home. */
  private dismissCarrier(s: Settler, road: Road, a: number, b: number): void {
    if (!s?.alive) return;
    if (s.carryGood >= 0) this.dropCarriedGoodAt(s, s.roadIdx < road.tiles.length / 2 ? a : b);
    this.releaseReservations(s);
    this.sendHome(s);
  }

  /**
   * Take away a flag that two roads pass through, and join the roads into one (as in Serf City):
   * what lay on the flag is lost, and the new road gets a carrier of its own.
   */
  private joinAtFlag(f: Flag, r1: Road, r2: Road): CommandResult {
    const a = r1.a === f.id ? r1.b : r1.a;
    const b = r2.a === f.id ? r2.b : r2.a;
    if (a === b) return { ok: false, reason: "Both roads lead to the same flag. Demolish one of them first." };
    const fa = this.flags[a] as Flag;
    if (fa.roads.some((r) => this.roads[r]?.alive && ((this.roads[r] as Road).a === b || (this.roads[r] as Road).b === b))) return { ok: false, reason: "Those flags are already joined by another road. Demolish one of the roads first." };
    // The joined road, from a to b, through the flag's tile.
    const toFlag = r1.b === f.id ? [...r1.tiles] : [...r1.tiles].reverse();
    const fromFlag = r2.a === f.id ? [...r2.tiles] : [...r2.tiles].reverse();
    const tiles = [...toFlag, ...fromFlag.slice(1)];
    const owner = f.owner;
    this.removeRoad(r1);
    this.removeRoad(r2);
    this.removeFlag(f);
    this.createRoad(a, b, tiles, owner);
    return { ok: true };
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
    // Still on the way to fetch it: the good never left its flag, so it simply waits there again.
    if (s.state === "fetch" || s.carrying < 0) {
      if (g.alive) g.carrier = -1;
      this.releaseReservations(s);
      s.carryGood = -1;
      s.carrying = -1;
      return;
    }
    const flag = this.flags[flagId] as Flag;
    if (flag.alive && flag.goods.length < FLAG_CAPACITY) {
      g.flag = flagId;
      g.carrier = -1;
      g.since = this.tick;
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
        // Plain road lengths: congestion is weighed live, at each flag (see hopFrom).
        const w = road.tiles.length - 1;
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
    if (!b.built) {
      // Nothing is delivered until the ground is level.
      if (b.dig > 0) return 0;
      // Skystone builds like stone: a site short of stone takes either, counted together.
      const stone = goodId("stone");
      const sky = goodId("skystone");
      if (type === sky || type === stone) return (b.cost[stone] as number) - (b.delivered[stone] as number) - (b.pending[stone] as number) - (b.pending[sky] as number);
      return (b.cost[type] as number) - (b.delivered[type] as number) - (b.pending[type] as number);
    }
    if (b.stranded >= 0) return 0;
    const upkeep = this.upkeepNeed(b, type);
    if (upkeep > 0) return upkeep;
    // Launch rails ask for the cargo of the voyages loading there.
    if (b.def.rail) return (b.want?.[type] ?? 0) - (b.stock[type] as number) - (b.pending[type] as number);
    if (b.def.slots) return this.armsNeed(b, type);
    if ((b.worker < 0 && !b.def.heated) || b.exhausted) return 0;
    const key = inputKeyFor(b.def, type);
    if (!key || (key === "fuel" && this.ventHeat(b))) return 0;
    if (this.priority(b, type) <= 0) return 0;
    let have = 0;
    for (const g of goodsFor(key)) have += (b.stock[g] as number) + (b.pending[g] as number);
    return (b.def.inputStock ?? 4) - have;
  }

  /** Good a building mends itself with: stone for stone-built ones, else plank. */
  upkeepGood(b: Building): number {
    return (b.cost[goodId("stone")] as number) > (b.cost[goodId("plank")] as number) ? goodId("stone") : goodId("plank");
  }

  /**
   * Upkeep: a weathered building (wear at half or more) asks for one unit of its upkeep good.
   * Storage and buildings that already take that good as an input mend from their own stock.
   */
  private upkeepNeed(b: Building, type: number): number {
    if (b.wear < 0.5 || b.def.storage || type !== this.upkeepGood(b) || inputKeyFor(b.def, type)) return 0;
    return 1 - (b.stock[type] as number) - (b.pending[type] as number);
  }

  /** Daily weathering, soot and moss; mending when the upkeep good is at hand. */
  private weather(): void {
    const land = this.land;
    for (const b of this.buildings) {
      if (!b.alive || !b.built) continue;
      const damp = (land.mud[b.tile] as number) + (land.planet.terrain.moisture[b.tile] as number) * 0.5;
      b.wear = Math.min(1, b.wear + 0.018 + damp * 0.012);
      if (b.wear > 0.3) b.moss = Math.min(1, b.moss + damp * 0.03);
      if (b.def.forge && b.worker >= 0) b.soot = Math.min(1, b.soot + 0.04);
      b.soot = Math.max(0, b.soot - 0.005);
      if (b.burn > 0) b.burn = Math.max(0, b.burn - 1);
      if (b.wear < 0.5) continue;
      const g = this.upkeepGood(b);
      if ((b.stock[g] as number) > 0) {
        b.stock[g]!--;
        b.wear = 0.08;
        b.moss *= 0.4;
        b.soot *= 0.5;
      }
    }
    // Wells draw on the groundwater.
    for (const b of this.buildings) if (b.alive && b.built && b.def.well) this.ecology.draw(b.tile, 0.04);
  }

  /** Worn-out buildings (wear above 0.85) work at two-thirds speed. */
  wearSpeed(b: Building): number {
    return b.wear > 0.85 ? 1.5 : 1;
  }

  /** Distribution weight (0..1) of a building for a good; 0 means it gets none. */
  priority(b: Building, type: number): number {
    const table = this.prefs[b.owner]?.dist[distributionKey(type)];
    if (!table) return 1;
    return table[b.built ? b.def.id : "site"] ?? 1;
  }

  /**
   * How strongly a building calls for one more of a good (Serf City's rule): its distribution
   * weight, halved for every one it already holds or has on the way, so supplies go round the
   * buildings that want them instead of filling one first. A construction site whose builder
   * has not arrived yet calls at a quarter of that: materials go first where work can start.
   */
  claim(b: Building, type: number): number {
    let w = this.priority(b, type);
    let held = 0;
    if (!b.built) {
      // A site set to the lowest priority still gets its materials, last.
      w = Math.max(w, 1e-6);
      const onSite = b.delivered.reduce((a, v) => a + v, 0) - b.consumed;
      held = (b.pending[type] as number) + Math.max(0, Math.min(onSite, b.delivered[type] as number));
      const builder = b.builder >= 0 ? this.settlers[b.builder] : undefined;
      const working = !!builder?.alive && builder.state !== "goto";
      return (w / 2 ** held) * (working ? 1 : 0.25);
    }
    if (w <= 0) return 0;
    const key = inputKeyFor(b.def, type);
    for (const g of key ? goodsFor(key) : [type]) held += (b.stock[g] as number) + (b.pending[g] as number);
    return w / 2 ** held;
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
    let bestClaim = 0;
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== owner || this.need(b, g.type) <= 0) continue;
      const d = this.route(g.flag, b.flag).dist;
      if (d === Infinity) continue;
      const c = this.claim(b, g.type);
      if (c > bestClaim + 1e-12 || (Math.abs(c - bestClaim) <= 1e-12 && d < bestD)) {
        bestClaim = c;
        bestD = d;
        best = b.id;
      }
    }
    if (best < 0) {
      for (const b of this.buildings) {
        if (!b.alive || !b.def.storage || !b.built || b.owner !== owner || b.mode !== STORE_IN) continue;
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
    return this.nextHopFrom(g, g.flag);
  }

  /**
   * The next flag for a good at `from` on its way to `to`, as Serf City chooses: of the roads
   * that bring it closer, the one whose length, remaining distance and queue cost least. A road
   * with goods already queued its way, or with no carrier free, costs more, so goods spread over
   * parallel roads instead of piling up. Only roads that make progress count, so goods never loop.
   */
  private hopFrom(from: number, to: number): number {
    const base = this.route(from, to);
    if (base.next < 0) return -1;
    const here = this.flags[from] as Flag;
    if (here.roads.length <= 2) return base.next;
    let best = base.next;
    let bestCost = Infinity;
    for (const rid of here.roads) {
      const road = this.roads[rid] as Road;
      if (!road.alive) continue;
      const other = road.a === from ? road.b : road.a;
      const rest = other === to ? 0 : this.route(other, to).dist;
      if (!(rest < base.dist)) continue;
      const cost = road.tiles.length - 1 + rest + this.queued(road, from) * 1.5 + (this.freeCarriers(road) > 0 ? 0 : 2);
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && other < best)) {
        bestCost = cost;
        best = other;
      }
    }
    return best;
  }

  /** Goods lying at `from` that the shortest routes send along this road (not yet picked up). */
  private queued(road: Road, from: number): number {
    const to = road.a === from ? road.b : road.a;
    let n = 0;
    for (const gid of (this.flags[from] as Flag).goods) {
      const g = this.goods[gid] as Good;
      if (g.carrier >= 0 || g.dest < 0) continue;
      const dest = this.buildings[g.dest] as Building;
      if (dest.flag !== from && this.route(from, dest.flag).next === to) n++;
    }
    return n;
  }

  /** Carriers on a road that are free (waiting, or on their way to it). */
  private freeCarriers(road: Road): number {
    let n = 0;
    for (const id of [road.carrier, ...road.helpers]) {
      const st = this.settlers[id]?.state;
      if (st === "idle" || st === "center" || st === "goto") n++;
    }
    return n;
  }

  /**
   * Storage buildings send goods out to buildings that need them, one at a time to whichever
   * calls strongest (see claim), from the nearest store that has one.
   */
  private supply(): void {
    const order = this.buildings.filter((b) => b.alive);
    // Goods lying on flags on their way into storage, by type: these are sent on to a building
    // that needs them before anything is taken out of a store (no carrying the same good twice).
    const toStore = new Map<number, Good[]>();
    for (const g of this.goods) {
      if (!g.alive || g.carrier >= 0 || g.dest < 0 || g.flag < 0) continue;
      const d = this.buildings[g.dest] as Building;
      if (!d.def.storage || (this.flags[g.flag] as Flag).goods.indexOf(g.id) < 0) continue;
      let list = toStore.get(g.type);
      if (!list) toStore.set(g.type, (list = []));
      list.push(g);
    }
    for (let type = 0; type < GOODS.length; type++) {
      const wanting = order.filter((b) => this.need(b, type) > 0);
      while (wanting.length) {
        let b = wanting[0] as Building;
        let bc = -1;
        for (const x of wanting) {
          const c = this.claim(x, type);
          if (c > bc + 1e-12) {
            bc = c;
            b = x;
          }
        }
        if (bc <= 0) {
          wanting.splice(wanting.indexOf(b), 1);
          continue;
        }
        // A good already under way to a store, nearer than any store, is sent on instead.
        const moving = toStore.get(type);
        let redirect = -1;
        let redirectD = Infinity;
        for (let i = 0; moving && i < moving.length; i++) {
          const g = moving[i] as Good;
          if ((this.flags[g.flag] as Flag).owner !== b.owner) continue;
          const d = this.route(g.flag, b.flag).dist;
          if (d < redirectD) {
            redirectD = d;
            redirect = i;
          }
        }
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
        if (redirect >= 0 && redirectD <= bestD) {
          const g = (moving as Good[]).splice(redirect, 1)[0] as Good;
          (this.buildings[g.dest] as Building).pending[type]!--;
          g.dest = b.id;
          b.pending[type]!++;
          if (this.need(b, type) <= 0) wanting.splice(wanting.indexOf(b), 1);
          continue;
        }
        if (!src || bestD === Infinity) {
          wanting.splice(wanting.indexOf(b), 1);
          continue;
        }
        src.stock[type]!--;
        const g = this.spawnGood(type, src.flag);
        g.dest = b.id;
        b.pending[type]!++;
        if (this.need(b, type) <= 0) wanting.splice(wanting.indexOf(b), 1);
      }
    }
  }

  /**
   * Stores set to Out carry their goods to the others, most urgent first (the transport list),
   * one at a time so the store's flag isn't flooded.
   */
  private emptyStores(): void {
    for (const b of this.buildings) {
      if (!b.alive || !b.built || !b.def.storage || b.mode !== STORE_OUT) continue;
      const flag = this.flags[b.flag] as Flag;
      if (flag.goods.length + flag.reserved >= FLAG_CAPACITY) continue;
      let type = -1;
      for (let t = 0; t < GOODS.length; t++)
        if ((b.stock[t] as number) > 0 && (type < 0 || this.transportRank(b.owner, t) < this.transportRank(b.owner, type))) type = t;
      if (type < 0) continue;
      let to: Building | null = null;
      let bestD = Infinity;
      for (const s of this.buildings) {
        if (s === b || !s.alive || !s.built || !s.def.storage || s.owner !== b.owner || s.mode !== STORE_IN) continue;
        const d = this.route(b.flag, s.flag).dist;
        if (d < bestD) {
          bestD = d;
          to = s;
        }
      }
      if (!to) continue;
      b.stock[type]!--;
      const g = this.spawnGood(type, b.flag);
      g.dest = to.id;
      to.pending[type]!++;
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
    const g: Good = { id: this.goods.length, type, flag: flagId, dest: -1, carrier: -1, since: this.tick, alive: true };
    this.goods.push(g);
    (this.flags[flagId] as Flag).goods.push(g.id);
    return g;
  }

  /** A building receives a good carried in by a carrier. */
  private receive(b: Building, type: number): void {
    b.pending[type] = Math.max(0, (b.pending[type] as number) - 1);
    if (!b.built) b.delivered[type === goodId("skystone") ? goodId("stone") : type]!++;
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
      if (!p.alive || p.owner !== owner || p.stage !== "adult" || p.settler >= 0 || p.woundedUntil > this.tick) continue;
      const house = p.house >= 0 ? this.buildings[p.house] : undefined;
      const origin = house && house.alive && house.built ? house : keep;
      if (!origin) continue;
      let d = this.route(origin.flag, flagId).dist;
      if (d === Infinity && origin !== keep && keep) d = this.route(keep.flag, flagId).dist;
      if (d === Infinity) continue;
      // Wardens are chosen by rank first: the strongest free one takes a vacant place.
      const score = (p.skills[trade] ?? 0) * 40 + (trade === "warden" ? p.rank * 15 : 0) - d * 0.1 - p.id * 1e-6;
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
      back: -1,
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
      road.helpers = road.helpers.filter((id) => id !== s.id);
    }
    if (s.role === "worker" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      if (b.worker === s.id) b.worker = -1;
    }
    if (s.role === "warden" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      b.garrison = b.garrison.filter((id) => id !== s.id);
    }
    if (s.role === "attacker" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      b.siege = b.siege.filter((id) => id !== s.id);
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
    // Carriers for roads without one (a helper already there takes over first).
    for (const r of this.roads) {
      if (!r.alive || r.carrier >= 0) continue;
      if (r.helpers.length) {
        r.carrier = r.helpers.shift() as number;
        continue;
      }
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
    // Busy roads call more carriers, up to what their length allows.
    for (const r of this.roads) {
      if (!r.alive || r.carrier < 0 || 1 + r.helpers.length >= helperCap(r.tiles.length - 1)) continue;
      if (Math.max(this.queued(r, r.a), this.queued(r, r.b)) < QUEUE_FOR_HELPER) continue;
      if (this.freeCarriers(r) > 0) continue;
      const pick = this.pickPerson(r.a, "carrier") ?? this.pickPerson(r.b, "carrier");
      if (!pick) continue;
      const mid = Math.floor(r.tiles.length / 2);
      const toA = this.roadPath(pick.origin.flag, r.a);
      const toB = toA ? null : this.roadPath(pick.origin.flag, r.b);
      if (!toA && !toB) continue;
      const approach = toA ? [...toA, ...r.tiles.slice(1, mid + 1)] : [...(toB as number[]), ...[...r.tiles].reverse().slice(1, r.tiles.length - mid)];
      const s = this.spawnSettler("carrier", pick.origin, approach, pick.person);
      s.road = r.id;
      s.roadIdx = mid;
      r.helpers.push(s.id);
    }
    for (const b of this.buildings) {
      if (!b.alive || b.stranded >= 0 || this.defeated[b.owner]) continue;
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
        } else if (b.threat >= 1 && (this.rotateUntil[b.owner] ?? -1) > this.tick) {
          // Rotation (Serf City's "cycle knights"): a stronger free warden relieves the weakest on watch.
          let weakest = -1;
          let weakRank = Infinity;
          for (const g of b.garrison) {
            const w = this.settlers[g] as Settler;
            const rank = this.people[w.person]?.rank ?? 0;
            if (w.state === "guard" && rank < weakRank) {
              weakest = g;
              weakRank = rank;
            }
          }
          const pick = weakest >= 0 ? this.pickPerson(b.flag, "warden") : null;
          if (pick && pick.person.rank > weakRank) {
            this.sendHome(this.settlers[weakest] as Settler);
          }
        }
      }
    }
  }

  /** Wardens a lantern building should have under its owner's garrison policy (at least one). */
  garrisonWant(b: Building): number {
    const slots = b.def.slots ?? 0;
    const g = (this.prefs[b.owner] as Prefs).garrison;
    // Three levels, as in Serf City (which has four): the middle one defaults to halfway.
    const share = b.threat >= 2 ? g.frontier : b.threat === 1 ? (g.near ?? (g.frontier + g.inland) / 2) : g.inland;
    return Math.max(1, Math.min(slots, Math.ceil(slots * share - 1e-9)));
  }

  private stepWarden(s: Settler): void {
    const b = this.buildings[s.building];
    if (!b || !b.alive) {
      this.sendHome(s);
      return;
    }
    if (s.state === "guard" && this.tick % 25 === 0) this.equip(s, b);
    if (s.state === "goto" && this.walk(s)) {
      s.state = "guard";
      this.equip(s, b);
      if (!b.lit) {
        b.lit = true;
        this.territoryDirty = true;
        this.notify(b.owner, `The ${b.def.name.toLowerCase()} is lit. Your border grows.`);
      }
    }
  }

  // ------------------------------------------------------------------ combat

  /** Cut a building off: workers and wardens leave, a lantern goes dark. */
  private strand(b: Building): void {
    if (b.stranded >= 0) return;
    b.stranded = this.tick;
    for (const id of [b.worker, b.builder, ...b.garrison]) if (id >= 0) this.sendHome(this.settlers[id] as Settler);
    b.garrison = [];
    if (b.lit && b.def.light) {
      b.lit = false;
      this.territoryDirty = true;
    }
    const flag = this.flags[b.flag] as Flag;
    for (const r of [...flag.roads]) this.removeRoad(this.roads[r] as Road);
    this.notify(b.owner, `Your ${b.def.name.toLowerCase()} is cut off. Win the land back within a season or it falls to ruin.`);
    this.structureVersion++;
  }

  /** Stranded buildings come back when their land does, and fall to ruin after a season. */
  private stepStranded(): void {
    const land = this.land;
    for (const b of this.buildings) {
      if (!b.alive || b.stranded < 0) continue;
      if (land.territory[b.tile] === b.owner + 1 && !this.defeated[b.owner]) {
        b.stranded = -1;
        this.structureVersion++;
        this.notify(b.owner, `Your ${b.def.name.toLowerCase()} is back in your light.`);
      } else if (this.tick - b.stranded > COMBAT.strandedDays * this.dayTicks) {
        this.notify(b.owner, `Your stranded ${b.def.name.toLowerCase()} has fallen to ruin.`);
        const flag = this.flags[b.flag] as Flag;
        this.removeBuilding(b);
        if (flag.alive && flag.roads.length === 0) this.removeFlag(flag);
      }
    }
  }

  /** Arms a lantern building asks for: one of each kind per warden who lacks it. */
  private armsNeed(b: Building, type: number): number {
    const bit = type === goodId("blade") ? ARM_BLADE : type === goodId("bow") ? ARM_BOW : type === goodId("mount") ? ARM_MOUNT : 0;
    if (!bit || !b.built || this.priority(b, type) <= 0) return 0;
    let lacking = 0;
    for (const id of b.garrison) {
      const p = this.people[(this.settlers[id] as Settler).person];
      if (p && !(p.arms & bit)) lacking++;
    }
    return lacking - (b.stock[type] as number) - (b.pending[type] as number);
  }

  private equip(s: Settler, b: Building): void {
    const p = this.people[s.person];
    if (!p) return;
    for (const [id, bit] of [["blade", ARM_BLADE], ["bow", ARM_BOW], ["mount", ARM_MOUNT]] as const) {
      const g = goodId(id);
      if (!(p.arms & bit) && (b.stock[g] as number) > 0) {
        b.stock[g]!--;
        p.arms |= bit;
        note(p, `Was given a ${id}.`);
      }
    }
  }

  /** How bold a settlement's fighters are: gold in store, Glow, and full bellies. */
  resolve(owner: number): number {
    const gold = (this.storageTotals(owner)[goodId("gold")] as number) ?? 0;
    return 0.85 + 0.15 * Math.min(1, gold / 8) + 0.15 * ((this.glow[owner] ?? 50) / 100) - (this.hungry[owner] ? 0.1 : 0);
  }

  /**
   * Morale of a player's wardens away from home, as in Serf City: it follows their share of all the
   * gold in the world (no gold: three-quarters strength; half the world's gold or more: full).
   * Defenders on their own land don't need it.
   */
  warMorale(owner: number): number {
    let mine = 0;
    let all = 0;
    for (let p = 0; p < this.keeps.length; p++) {
      if (this.keeps[p] === undefined || this.defeated[p]) continue;
      const g = (this.storageTotals(p)[goodId("gold")] as number) ?? 0;
      all += g;
      if (p === owner) mine = g;
    }
    if (all <= 0) return 1;
    return 0.75 + 0.25 * Math.min(1, (mine / all) * 2);
  }

  private fighter(s: Settler, fatigue = 0): Fighter {
    const p = this.people[s.person];
    return { rank: p?.rank ?? 0, arms: p?.arms ?? 0, fatigue };
  }

  /** Wardens on watch inside a building, strongest last (they come out last). */
  defendersOf(b: Building): Settler[] {
    return b.garrison
      .map((id) => this.settlers[id] as Settler)
      .filter((s) => s.alive && s.state === "guard")
      .sort((x, y) => this.fighterScore(x) - this.fighterScore(y) || x.id - y.id);
  }

  private fighterScore(s: Settler): number {
    const p = this.people[s.person];
    return (p?.rank ?? 0) * 10 + ((p?.arms ?? 0) & ARM_BLADE ? 5 : 0) + ((p?.arms ?? 0) & ARM_BOW ? 2 : 0);
  }

  /** Steps between two tiles, up to `max` (or Infinity). */
  private steps(a: number, b: number, max: number): number {
    let found = Infinity;
    this.flood(a, max, (t, d) => {
      if (t === b && d < found) found = d;
    });
    return found;
  }

  /** Can `player` attack `target`? Returns the reason if not. */
  attackBlocked(player: number, target: Building): string | null {
    if (this.winner >= 0) return "The game is over.";
    if (this.tick < this.peaceUntil) return "The peace still holds.";
    if (this.defeated[player]) return "Your settlement has fallen.";
    if (target.owner !== player && this.allied(player, target.owner)) return "That is an ally's lantern.";
    if (target.owner !== player && this.diplomacy.truce(player, target.owner)) return `You have a truce with ${this.playerName(target.owner)}. Break it first (Diplomacy, J), at a cost.`;
    if (!target.alive || !target.built || target.owner === player) return "That isn't an enemy lantern.";
    if (!target.def.light || (!target.lit && !this.keeps.includes(target.id))) return "Only lit lanterns and Hearthships can be attacked.";
    if (!this.attackSources(player, target).length) return "None of your lanterns is close enough.";
    return null;
  }

  /** The player's lit lanterns within reach of a target, nearest first. */
  private attackSources(player: number, target: Building): { b: Building; d: number }[] {
    const out: { b: Building; d: number }[] = [];
    const reach = new Map<number, number>();
    let max = 0;
    for (const b of this.buildings) if (b.alive && b.lit && b.owner === player && b.def.slots && b.stranded < 0) max = Math.max(max, (b.def.light as number) + COMBAT.reach);
    if (!max) return out;
    this.flood(target.tile, max, (t, d) => reach.set(t, d));
    for (const b of this.buildings) {
      if (!b.alive || !b.lit || b.owner !== player || !b.def.slots || b.stranded >= 0) continue;
      const d = reach.get(b.tile);
      if (d !== undefined && d <= (b.def.light as number) + COMBAT.reach) out.push({ b, d });
    }
    return out.sort((x, y) => x.d - y.d || x.b.id - y.b.id);
  }

  /** Wardens that could join an attack (each lantern keeps one at home), strongest first. */
  attackersFor(player: number, target: Building, order: "strongest" | "weakest" = "strongest"): { s: Settler; from: Building; d: number }[] {
    const out: { s: Settler; from: Building; d: number }[] = [];
    for (const { b, d } of this.attackSources(player, target)) {
      const on = this.defendersOf(b).reverse();
      for (const s of on.slice(0, Math.max(0, on.length - 1))) out.push({ s, from: b, d });
    }
    const sign = order === "weakest" ? -1 : 1;
    return out.sort((x, y) => sign * (this.fighterScore(y.s) - this.fighterScore(x.s)) || x.d - y.d || x.s.id - y.s.id);
  }

  /** Estimated chance that `count` of the player's wardens take `target`. */
  attackOdds(player: number, target: Building, count: number, order: "strongest" | "weakest" = "strongest"): number {
    const att = this.attackersFor(player, target, order).slice(0, count);
    const ra = this.resolve(player);
    const rd = this.resolve(target.owner);
    const ground = this.keeps.includes(target.id) ? 1.2 : 1.1;
    const defs = [...(this.keeps.includes(target.id) ? this.militia(target) : []), ...this.defendersOf(target).map((s) => this.fighter(s))];
    const morale = this.warMorale(player);
    const a = att.map(({ s, d }) => strength(this.fighter(s, fatigueFor(d, this.people[s.person]?.arms ?? 0)), ra * morale, 1));
    const dd = defs.map((f) => strength(f, rd, ground)).reverse();
    const bowsA = att.filter(({ s }) => hasBow(this.fighter(s))).length;
    const bowsD = defs.filter((f) => hasBow(f)).length;
    return captureOdds(a, dd, bowsA, bowsD);
  }

  /** A Hearthship without wardens is defended by up to five of its idle adults. */
  private militia(keep: Building): Fighter[] {
    const n = Math.min(5 - keep.levy, this.people.filter((p) => p.alive && p.owner === keep.owner && p.stage === "adult" && p.settler < 0 && p.woundedUntil <= this.tick).length);
    return new Array<Fighter>(n).fill({ rank: 0, arms: 0, fatigue: 0 });
  }

  private cmdAttack(targetId: number, count: number, p: number, order?: "strongest" | "weakest"): CommandResult {
    const target = this.buildings[targetId];
    if (!target) return { ok: false, reason: "Nothing to attack there." };
    const blocked = this.attackBlocked(p, target);
    if (blocked) return { ok: false, reason: blocked };
    const pool = this.attackersFor(p, target, order === "weakest" ? "weakest" : "strongest").slice(0, Math.max(0, Math.floor(count)));
    if (!pool.length) return { ok: false, reason: "No wardens can be spared. Each lantern keeps one at home." };
    const flagTile = (this.flags[target.flag] as Flag).tile;
    let sent = 0;
    for (const { s, from } of pool) {
      const path = this.land.findPath(from.tile, flagTile, (t) => this.land.walkable(t) || t === from.tile || t === flagTile, 6000);
      if (!path) continue;
      from.garrison = from.garrison.filter((id) => id !== s.id);
      s.role = "attacker";
      s.building = target.id;
      s.home = from.id;
      s.state = "march";
      s.visits = path.length;
      this.setPath(s, path);
      const person = this.people[s.person];
      if (person) note(person, `Marched on a ${target.def.name.toLowerCase()}.`);
      sent++;
    }
    if (!sent) return { ok: false, reason: "No way through to it." };
    this.notify(target.owner, `Wardens are marching on your ${target.def.name.toLowerCase()}!`);
    return { ok: true };
  }

  private stepAttacker(s: Settler): void {
    const b = this.buildings[s.building];
    if (!b || !b.alive || b.owner === s.owner || this.winner >= 0) {
      this.sendHome(s);
      return;
    }
    if (s.state === "march") {
      if (!this.walk(s)) return;
      s.state = "siege";
      b.siege.push(s.id);
      // Volleys: the attacker's bow at a random defender, and a defender's bow back.
      const r = this.combatRng as Rng;
      const me = this.fighter(s);
      const defs = this.defendersOf(b);
      if (hasBow(me) && defs.length > 1 && r.chance(VOLLEY_HIT)) this.hurt(r.pick(defs), "was struck by an arrow");
      const archers = defs.filter((d) => hasBow(this.fighter(d)));
      if (archers.length && r.chance(VOLLEY_HIT)) this.hurt(s, "was struck by an arrow at the door");
    }
  }

  /** Duels at the doors of besieged buildings, one at a time. */
  private stepSieges(): void {
    for (const b of this.buildings) {
      if (!b.alive || (!b.siege.length && !b.duel)) continue;
      b.siege = b.siege.filter((id) => {
        const s = this.settlers[id];
        return !!s && s.alive && s.role === "attacker" && s.building === b.id && (s.state === "siege" || s.state === "duel");
      });
      if (b.duel) {
        if (this.tick >= b.duel.until) this.resolveDuel(b);
        continue;
      }
      const a = b.siege.map((id) => this.settlers[id] as Settler).find((s) => s.state === "siege");
      if (!a) continue;
      if (b.owner === a.owner) continue;
      let defenders = this.defendersOf(b);
      if (!defenders.length && this.keeps.includes(b.id)) defenders = this.raiseMilitia(b);
      if (!defenders.length) {
        this.capture(b, a.owner);
        continue;
      }
      const d = defenders[defenders.length - 1] as Settler;
      const flagTile = (this.flags[b.flag] as Flag).tile;
      d.state = "duel";
      this.setPath(d, [b.tile, flagTile]);
      d.pi = 1;
      a.state = "duel";
      b.duel = { attacker: a.id, defender: d.id, until: this.tick + COMBAT.duelTicks };
    }
  }

  /** Militia go back to their lives once no attack is under way. */
  private standDown(): void {
    for (const k of this.keeps) {
      if (k === undefined) continue;
      const keep = this.buildings[k] as Building;
      if (!keep.garrison.length || keep.siege.length || keep.duel) continue;
      if (this.settlers.some((s) => s.alive && s.role === "attacker" && s.building === keep.id)) continue;
      for (const id of [...keep.garrison]) {
        const s = this.settlers[id] as Settler;
        if (s.alive && s.state === "guard") this.sendHome(s);
      }
    }
  }

  /** Idle adults of a Hearthship take up arms when no warden is left to defend it. */
  private raiseMilitia(keep: Building): Settler[] {
    if (keep.levy >= 5) return [];
    const pick = this.people.find((p) => p.alive && p.owner === keep.owner && p.stage === "adult" && p.settler < 0 && p.woundedUntil <= this.tick);
    if (!pick) return [];
    keep.levy++;
    const s = this.spawnSettler("warden", keep, [], pick);
    s.building = keep.id;
    s.state = "guard";
    keep.garrison.push(s.id);
    note(pick, "Took up arms to defend the Hearthship.");
    return [s];
  }

  private resolveDuel(b: Building): void {
    const duel = b.duel as { attacker: number; defender: number; until: number };
    b.duel = null;
    const a = this.settlers[duel.attacker] as Settler;
    const d = this.settlers[duel.defender] as Settler;
    const aliveA = a.alive && a.state === "duel";
    const aliveD = d.alive && d.state === "duel";
    if (aliveD) {
      d.state = "guard";
      this.setPath(d, [b.tile]);
    }
    if (aliveA) a.state = "siege";
    if (!aliveA || !aliveD) return;
    const ground = this.keeps.includes(b.id) ? 1.2 : 1.1;
    const fa = strength(this.fighter(a, fatigueFor(a.visits, this.people[a.person]?.arms ?? 0)), this.resolve(a.owner) * this.warMorale(a.owner), 1);
    const fd = strength(this.fighter(d), this.resolve(d.owner), ground);
    const r = this.combatRng as Rng;
    const [winner, loser] = r.next() < duelChance(fa, fd) ? [a, d] : [d, a];
    const wp = this.people[winner.person];
    if (wp) {
      wp.xp += 2;
      note(wp, `Won a duel at the door of a ${b.def.name.toLowerCase()}.`);
    }
    this.hurt(loser, `lost a duel at the door of a ${b.def.name.toLowerCase()}`, loser === a ? b.owner : -1);
  }

  /** The loser of a fight: wounded and sent home, or fallen if the stakes are mortal. */
  private hurt(s: Settler, how: string, captor = -1): void {
    const p = this.people[s.person];
    if (s.role === "warden" && s.building >= 0) {
      const b = this.buildings[s.building] as Building;
      b.garrison = b.garrison.filter((id) => id !== s.id);
    }
    if (this.stakes === "mortal" && p) {
      note(p, `Fell in battle: ${how}.`);
      s.alive = false;
      p.settler = -1;
      this.farewell(p);
      return;
    }
    if (p) {
      p.woundedUntil = this.tick + COMBAT.woundedDays * this.dayTicks;
      note(p, `Was wounded: ${how}.`);
      // A beaten attacker may be taken prisoner (held until an exchange sends them home).
      if (captor >= 0 && captor !== p.owner && mix32(this.tick, p.id) % 2 === 0) {
        p.captive = captor;
        p.woundedUntil = this.tick + 1000 * this.dayTicks;
        note(p, `Was taken prisoner by ${this.playerName(captor)}.`);
        this.notify(captor, `Your wardens have taken ${fullName(p)} of ${this.playerName(p.owner)} prisoner.`);
      }
    }
    if (s.role === "attacker") s.building = -1;
    this.sendHome(s);
  }

  /** A building falls: the winners move in, the land shifts. */
  private capture(b: Building, owner: number): void {
    const old = b.owner;
    const isKeep = this.keeps.includes(b.id);
    for (const id of b.garrison) {
      const s = this.settlers[id] as Settler;
      if (s.alive) this.sendHome(s);
    }
    b.garrison = [];
    const flag = this.flags[b.flag] as Flag;
    for (const r of [...flag.roads]) this.removeRoad(this.roads[r] as Road);
    for (const g of flag.goods) this.destroyGood(this.goods[g] as Good);
    flag.goods = [];
    flag.owner = owner;
    b.owner = owner;
    b.stock.fill(0);
    b.pending.fill(0);
    b.stranded = -1;
    b.lit = true;
    const winners = b.siege.map((id) => this.settlers[id] as Settler).filter((s) => s.alive && s.owner === owner);
    b.siege = [];
    const room = isKeep ? 0 : b.def.slots ?? 0;
    winners.forEach((s, i) => {
      if (i < room) {
        s.role = "warden";
        s.state = "guard";
        s.building = b.id;
        this.setPath(s, [b.tile]);
        b.garrison.push(s.id);
        const p = this.people[s.person];
        if (p) {
          p.xp += 3;
          note(p, `Took a ${b.def.name.toLowerCase()} and now keeps watch there.`);
        }
      } else {
        s.building = -1;
        this.sendHome(s);
      }
    });
    // A fallen lantern decides its surroundings: within its light the nearest lantern takes the
    // land, even tiles the old owner also lights from further off.
    if (b.def.light) this.flood(b.tile, b.def.light, (t) => this.recontest.add(t));
    this.territoryDirty = true;
    this.structureVersion++;
    this.graphVersion++;
    this.notify(owner, `You took a ${b.def.name.toLowerCase()}!`);
    this.notify(old, `Your ${b.def.name.toLowerCase()} has fallen.`);
    if (isKeep) this.fall(old, owner);
  }

  /** A player whose Hearthship falls is out. Their people join the victor; their lanterns go dark. */
  private fall(loser: number, victor: number): void {
    this.defeated[loser] = true;
    for (const s of this.settlers) {
      if (!s.alive || s.owner !== loser) continue;
      s.alive = false;
      const p = this.people[s.person];
      if (p) p.settler = -1;
    }
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== loser) continue;
      b.garrison = [];
      b.worker = -1;
      b.builder = -1;
      if (b.lit) b.lit = false;
    }
    for (const r of this.roads) if (r.alive && r.owner === loser) r.carrier = -1;
    for (const p of this.people) {
      if (!p.alive || p.owner !== loser) continue;
      p.owner = victor;
      p.house = -1;
      note(p, "Joined a new settlement after the Hearthship fell.");
    }
    this.territoryDirty = true;
    this.notify(victor, "Their people join your settlement.");
  }

  /** Victory by conquest (last Hearthship standing) or by holding the Star Wells. */
  private stepVictory(): void {
    // Colonies are not battlefields (yet): nobody wins a colony world.
    if (this.winner >= 0 || this.colony) return;
    const alive = this.keeps.map((_, p) => p).filter((p) => !this.defeated[p]);
    // The last settlement (or the last team) standing.
    if (this.keeps.length > 1 && alive.length >= 1 && alive.every((p) => this.allied(p, alive[0] as number)) && this.keeps.some((_, p) => !this.allied(p, alive[0] as number))) {
      this.win(alive[0] as number, "conquest");
      return;
    }
    if (this.goal === "bloom") return;
    const grid = this.land.planet.grid;
    const held = new Array<number>(this.keeps.length).fill(0);
    for (let t = 0; t < grid.count; t++) {
      if (grid.degree(t) !== 5) continue;
      const o = this.land.territory[t] as number;
      if (o) held[o - 1] = (held[o - 1] as number) + 1;
    }
    for (const p of alive) {
      if ((held[p] as number) >= COMBAT.wellsToWin) {
        if ((this.wellsSince[p] ?? -1) < 0) {
          this.wellsSince[p] = this.tick;
          this.notify(p, `You hold ${held[p]} Star Wells. Keep them lit for a day to win.`);
        } else if (this.tick - (this.wellsSince[p] as number) >= COMBAT.wellHoldDays * this.dayTicks) {
          this.win(p, "wells");
          return;
        }
      } else this.wellsSince[p] = -1;
    }
  }

  win(p: number, reason: "conquest" | "wells" | "bloom"): void {
    if (this.winner >= 0) return;
    this.winner = p;
    this.winReason = reason;
    const why = { wells: "The Star Wells sing for you. Victory!", conquest: "The last rival Hearthship has fallen. Victory!", bloom: "Your colony has bloomed first. Victory!" }[reason];
    for (let o = 0; o < this.keeps.length; o++) {
      if (this.keeps[o] === undefined) continue;
      this.notify(o, o === p ? why : this.allied(o, p) ? `${this.playerName(p)} has won, and your team with them. Victory!` : "Another settlement has won this world.");
    }
  }

  /** Daily watch: wardens gain experience; gold in storage pays for faster promotion. */
  private trainWardens(owner: number): void {
    for (const s of this.settlers) {
      if (!s.alive || s.owner !== owner || s.role !== "warden" || s.state !== "guard") continue;
      const p = this.people[s.person];
      if (!p || p.rank >= COMBAT.ranks.length - 1) continue;
      p.xp++;
      const goldAt = this.buildings.find((b) => b.alive && b.def.storage && b.owner === owner && (b.stock[goodId("gold")] as number) > 0);
      if (goldAt && p.xp >= (p.rank + 1) * 2) {
        goldAt.stock[goodId("gold")]!--;
        p.rank++;
        p.xp = 0;
        note(p, `Was promoted to ${rankTitle(p.rank).toLowerCase()} (paid in gold).`);
      } else if (p.xp >= (p.rank + 1) * 5) {
        p.rank++;
        p.xp = 0;
        note(p, `Was promoted to ${rankTitle(p.rank).toLowerCase()}.`);
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
    this.recontest.clear();
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
      const next = held[t] && !this.recontest.has(t) ? old : (bestO[t] as number);
      if (next === old) continue;
      land.territory[t] = next;
      changed = true;
      if (old) lost.push(t);
    }
    if (changed) land.territoryVersion++;
    // What stands on lost land is stranded: it falls idle and can be won back within a season.
    for (const t of lost) {
      const ref = land.ref[t] as number;
      if (land.use[t] === Use.Building) {
        const b = this.buildings[ref] as Building;
        if (b.alive && land.territory[t] !== b.owner + 1 && !this.keeps.includes(b.id)) this.strand(b);
      } else if (land.use[t] === Use.Flag) {
        const f = this.flags[ref] as Flag;
        if (f.alive && land.territory[t] !== f.owner + 1 && !this.keeps.includes(f.building)) {
          const hb = f.building >= 0 ? this.buildings[f.building] : undefined;
          if (hb && hb.alive && hb.stranded >= 0) for (const r of [...f.roads]) this.removeRoad(this.roads[r] as Road);
          else this.removeFlag(f);
        }
      } else if (land.use[t] === Use.Road) {
        const r = this.roads[ref] as Road;
        if (r.alive && land.territory[t] !== r.owner + 1) this.removeRoad(r);
      }
    }
    // Threat to lanterns: how near another player's land is (within 3 steps of their light is the
    // frontier, within 7 is near).
    for (const b of sources) {
      if (!b.def.slots) continue;
      let threat = 0;
      this.flood(b.tile, (b.def.light as number) + 7, (t, d) => {
        const o = land.territory[t] as number;
        if (o && o !== b.owner + 1) threat = Math.max(threat, d <= (b.def.light as number) + 3 ? 2 : 1);
      });
      b.threat = threat;
      b.frontier = threat >= 2;
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
    // Allies share their sight.
    if (this.teams.length) {
      const own = this.visible.map((v) => v.slice());
      for (let p = 0; p < this.keeps.length; p++)
        for (let q = 0; q < this.keeps.length; q++) {
          if (p === q || !this.allied(p, q)) continue;
          const vis = this.visible[p] as Uint8Array;
          const exp = this.explored[p] as Uint8Array;
          const other = own[q] as Uint8Array;
          for (let t = 0; t < n; t++)
            if (other[t]) {
              vis[t] = 1;
              exp[t] = 1;
            }
        }
    }
    this.visionVersion++;
  }

  /** Advance along the current path. Returns true when the last tile is reached. */
  private walk(s: Settler): boolean {
    if (s.pi >= s.path.length - 1) return true;
    const a = s.path[s.pi] as number;
    const b = s.path[s.pi + 1] as number;
    const onRoad = this.land.use[b] === Use.Road || this.land.use[b] === Use.Flag;
    // High water over the flats: wait on the shore for the ebb (causeways and stilts stay dry).
    if (this.land.flooded[b] && !this.land.causeway[b] && this.land.use[b] !== Use.Building) return false;
    // Skystone is buoyant: its carriers walk as if empty-handed, and a little quicker.
    const light = s.carryGood >= 0 && this.goods[s.carryGood]?.type === goodId("skystone") ? 0.8 : 1;
    // People raised on heavier worlds stride easily on lighter ones (and the other way round).
    const ticks = ((onRoad ? TICKS_PER_TILE_ROAD : TICKS_PER_TILE_OFFROAD) * this.land.stepCost(a, b) * light) / (this.people[s.person]?.stride ?? 1);
    s.prog += Math.max(20, Math.floor(1000 / ticks));
    if (s.prog >= 1000) {
      s.prog -= 1000;
      s.pi++;
      if (!onRoad && this.land.use[b] !== Use.Building) {
        this.land.wear[b] = Math.min(2000, (this.land.wear[b] as number) + 24);
        this.land.wearVersion++;
      }
      // Traffic clears blown sand off the road.
      if (onRoad && (this.land.sand[b] as number) > 0) {
        this.land.sand[b] = Math.max(0, (this.land.sand[b] as number) - 0.04);
        this.land.sandVersion++;
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
    // Only carriers reserve a place at a flag; a worker's target is a tile or a good type.
    if (s.target >= 0 && s.role === "carrier") {
      const f = this.flags[s.target];
      if (f) f.reserved = Math.max(0, f.reserved - 1);
    }
    if (s.back >= 0) {
      const f = this.flags[s.back];
      if (f) f.reserved = Math.max(0, f.reserved - 1);
    }
    s.target = -1;
    s.back = -1;
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
          s.timer = 0;
          const toFlag = fromFlag === road.a ? road.b : road.a;
          const into = this.nextHopFrom(g, toFlag) === -2 || (this.buildings[g.dest]?.flag ?? -1) === toFlag;
          const tf = this.flags[toFlag] as Flag;
          if (!into && tf.goods.length + tf.reserved >= FLAG_CAPACITY) {
            // A swap: promise the good that comes back, which frees the place this one takes.
            const back = this.returnGood(road, toFlag, -1);
            if (back >= 0) (this.goods[back] as Good).carrier = s.id;
          } else if (!into) {
            tf.reserved++;
            s.target = toFlag;
          }
          s.carryGood = good;
          s.state = "fetch";
          walkAlong(fromFlag === road.a ? 0 : end);
        } else if (s.roadIdx !== Math.floor(end / 2)) {
          walkAlong(Math.floor(end / 2));
          s.state = "center";
        } else if (road.helpers.includes(s.id) && ++s.timer > this.dayTicks / 8) {
          // An extra carrier with nothing to do for three hours goes home.
          s.timer = 0;
          this.sendHome(s);
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
          // A swap: the place this good leaves is kept for the one coming back.
          const other = fromFlag === road.a ? road.b : road.a;
          if (s.target < 0 && (this.flags[other] as Flag).goods.some((id) => (this.goods[id] as Good).carrier === s.id)) {
            flag.reserved++;
            s.back = fromFlag;
          }
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
          if (!this.dropAt(s, road, atFlag)) s.state = "wait";
        }
        return;
      case "wait": {
        // At a full flag with nothing to swap: wait until there is room or something comes back.
        const atFlag = s.roadIdx === 0 ? road.a : road.b;
        if (this.dropAt(s, road, atFlag)) return;
        return;
      }
      case "enter":
        if (this.walk(s)) {
          const g = this.goods[s.carryGood] as Good;
          // The building may have gone while the good was on its way in (the good is lost).
          const dest = this.buildings[g.dest];
          if (dest?.alive) this.receive(dest, g.type);
          g.alive = false;
          s.carryGood = -1;
          s.carrying = -1;
          s.state = "leave";
          this.setPath(s, [dest?.tile ?? (s.path[s.pi] as number), road.tiles[s.roadIdx] as number]);
        }
        return;
      case "leave":
        if (this.walk(s)) s.state = "idle";
        return;
    }
  }

  /**
   * Put the carried good down at a flag. At a full flag the carrier first picks up a good that
   * goes back over its road (a swap, as in Serf City); if there is none it can't put it down
   * yet (false). Then, if a good waits to go back, it takes it instead of walking back empty.
   */
  private dropAt(s: Settler, road: Road, at: number): boolean {
    const flag = this.flags[at] as Flag;
    const g = this.goods[s.carryGood] as Good;
    const back = road.a === at ? road.b : road.a;
    const bf = this.flags[back] as Flag;
    const fits = (gid: number) => {
      const x = this.goods[gid] as Good;
      const into = this.nextHopFrom(x, back) === -2 || (this.buildings[x.dest]?.flag ?? -1) === back;
      return into || s.back === back || bf.goods.length + bf.reserved < FLAG_CAPACITY;
    };
    let swap = -1;
    if (s.target < 0 && flag.goods.length >= FLAG_CAPACITY) {
      swap = this.returnGood(road, at, s.id);
      if (swap < 0 || !fits(swap)) return false;
      flag.goods.splice(flag.goods.indexOf(swap), 1);
    }
    if (s.target >= 0) {
      flag.reserved = Math.max(0, flag.reserved - 1);
      s.target = -1;
    }
    g.flag = at;
    g.carrier = -1;
    g.since = this.tick;
    flag.goods.push(g.id);
    if (g.dest >= 0 && !(this.buildings[g.dest] as Building).alive) g.dest = -1;
    s.carryGood = -1;
    s.carrying = -1;
    s.state = "idle";
    if (swap < 0) {
      swap = this.returnGood(road, at, s.id);
      if (swap < 0 || !fits(swap)) {
        this.releaseReservations(s);
        return true;
      }
      flag.goods.splice(flag.goods.indexOf(swap), 1);
    }
    this.takeBack(s, road, back, swap);
    return true;
  }

  /** Carry a good (already off its flag) back over the road to `back`. */
  private takeBack(s: Settler, road: Road, back: number, gid: number): void {
    const g = this.goods[gid] as Good;
    const into = this.nextHopFrom(g, back) === -2 || (this.buildings[g.dest]?.flag ?? -1) === back;
    const bf = this.flags[back] as Flag;
    g.carrier = s.id;
    if (s.back === back) {
      // The place kept since the swap began.
      s.back = -1;
      if (into) bf.reserved = Math.max(0, bf.reserved - 1);
      else s.target = back;
    } else if (!into) {
      bf.reserved++;
      s.target = back;
    }
    s.carryGood = gid;
    s.carrying = g.type;
    s.timer = 0;
    s.state = "carry";
    const end = road.tiles.length - 1;
    const from = s.roadIdx;
    const to = from === 0 ? end : 0;
    this.setPath(s, from <= to ? road.tiles.slice(from, to + 1) : road.tiles.slice(to, from + 1).reverse());
  }

  private nextHopFrom(g: Good, flag: number): number {
    if (g.dest < 0) return -1;
    const dest = this.buildings[g.dest] as Building;
    if (dest.flag === flag) return -2;
    return this.hopFrom(flag, dest.flag);
  }

  /** Pick the oldest good at either end of the road that wants to travel along it. */
  /**
   * A good at `at` that wants to travel back over this road (the carrier takes it on the way
   * back): one already promised to `carrier`, else the highest in transport priority. -1 if none.
   */
  private returnGood(road: Road, at: number, carrier: number): number {
    const back = road.a === at ? road.b : road.a;
    let best = -1;
    for (const gid of (this.flags[at] as Flag).goods) {
      const g = this.goods[gid] as Good;
      if (g.carrier >= 0 && g.carrier !== carrier) continue;
      if (g.dest < 0) this.assignDestination(g);
      if (this.nextHop(g) !== back) continue;
      if (g.carrier === carrier && carrier >= 0) return gid;
      if (best < 0 || this.transportRank(road.owner, g.type) < this.transportRank(road.owner, (this.goods[best] as Good).type)) best = gid;
    }
    return best;
  }

  /** Where a good stands in a player's transport priority (lower goes first). */
  transportRank(owner: number, type: number): number {
    const list = this.prefs[owner]?.transport ?? DEFAULT_TRANSPORT;
    const i = list.indexOf(GOODS[type]?.id ?? "");
    return i >= 0 ? i : list.length + type;
  }

  private chooseTransfer(road: Road): [number, number] | null {
    const options: [number, number][] = [];
    // Transport priority, with waiting: each hour a good waits moves it RANK_PER_HOUR places up,
    // so goods low in the order still move when the roads are busy.
    const hour = Math.max(1, Math.round(this.dayTicks / 24));
    const rank = (gid: number) => {
      const g = this.goods[gid] as Good;
      return this.transportRank(road.owner, g.type) - Math.floor((this.tick - g.since) / hour) * RANK_PER_HOUR;
    };
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
        // A full flag can still take a good if one there goes back the other way: the carrier
        // swaps them (as in Serf City), so two full flags never block each other.
        if (!intoBuilding && target.goods.length + target.reserved >= FLAG_CAPACITY && this.returnGood(road, to, -1) < 0) continue;
        // At each end the good highest in the transport priority goes first (older on ties).
        const prev = options.findIndex((o) => o[0] === from);
        if (prev < 0) options.push([from, gid]);
        else if (rank(gid) < rank((options[prev] as [number, number])[1])) options[prev] = [from, gid];
      }
    }
    if (options.length === 0) return null;
    // Of the two ends: the higher priority good, then the fuller flag, then the older good.
    options.sort((x, y) => {
      const fx = (this.flags[x[0]] as Flag).goods.length;
      const fy = (this.flags[y[0]] as Flag).goods.length;
      return rank(x[1]) - rank(y[1]) || fy - fx || x[1] - y[1];
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
    // First the ground is dug level (large buildings on a slope), then the building goes up.
    if (b.dig > 0) {
      s.timer++;
      if (s.timer >= DIG_TICKS * this.speedFactor(s, "builder")) {
        s.timer = 0;
        b.dig--;
        if (b.dig === 0) {
          this.structureVersion++;
          this.notify(b.owner, `The ground for the ${b.def.name.toLowerCase()} is level.`);
        }
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
    const b = this.buildings[s.building];
    return skillSpeed(p?.skills[trade] ?? 0) * glowSpeed(this.glow[s.owner] ?? 60) * (b && b.built ? this.wearSpeed(b) : 1) * (b ? this.heatSpeed(b.tile) : 1);
  }

  /**
   * Shift work in the Saltglass heat: slow in the blaze of a hot day, a little quicker in the
   * cool of the night.
   */
  heatSpeed(t: number): number {
    if (this.land.region[t] !== Region.SaltglassFlats || !this.climate) return 1;
    if (!this.sunUp(t)) return 0.9;
    return (this.climate.temp[t] as number) > 30 ? 1.6 : 1;
  }

  /** Local daytime (07:00 to 19:00 solar) at a tile. */
  sunUp(t: number): boolean {
    if (this.land.planet.params.locked) return sunHeight(this.land.planet, t) > 0.05;
    const c = this.land.planet.grid.center;
    const lon = atan2(-(c[t * 3 + 2] as number), c[t * 3] as number) / TAU;
    const h = dayInfo(this.tick, this.land.planet.params.dayLengthHours, lon).hour;
    return h >= 7 && h < 19;
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
    const inputs = { ...b.def.inputs };
    // A forge by a geothermal vent smelts on the earth's own heat.
    if (this.ventHeat(b)) delete inputs.fuel;
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
      land.isLand(t) && land.use[t] === Use.Free && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.slope(t) < 1.8 && land.planet.grid.degree(t) === 6;
    switch (def.job) {
      case "fell":
        return this.findWorkTile(b, (t) => fellable(land, t) || (land.feature[t] === Feature.Giant && land.variety[t] === 1 && land.territory[t] === b.owner + 1));
      case "orchard": {
        const ripe = this.findWorkTile(b, (t) => this.inFruit(t));
        if (ripe >= 0) return ripe;
        const trees = land.ring(b.tile, def.radius ?? 3).filter((t) => land.feature[t] === Feature.Tree && land.variety[t] === ORCHARD).length;
        return trees < 6 ? this.findWorkTile(b, open) : -1;
      }
      case "quarry":
        return this.findWorkTile(b, (t) => land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0);
      case "excavate":
        return this.findWorkTile(b, (t) => land.feature[t] === Feature.Ruin && (land.amount[t] as number) > 0);
      case "plant":
        // Saplings need living soil: grassland at least.
        return this.findWorkTile(b, (t) => open(t) && (land.life[t] as number) >= 3);
      case "farm": {
        const ripe = this.findWorkTile(b, (t) => land.feature[t] === Feature.Field && (land.amount[t] as number) >= FIELD_RIPE);
        if (ripe >= 0) return ripe;
        const fields = land.ring(b.tile, def.radius ?? 3).filter((t) => land.feature[t] === Feature.Field).length;
        // Fields need living soil: moss at least (terraformed worlds).
        return fields < 8 ? this.findWorkTile(b, (t) => open(t) && (land.life[t] as number) >= 2) : -1;
      }
      case "hunt": {
        // The richest ground within reach that nobody else is stalking.
        let best = -1;
        let most = 29;
        for (const t of land.ring(b.tile, def.radius ?? 7)) {
          const g = this.ecology.game[t] as number;
          if (g <= most || !land.walkable(t)) continue;
          if (this.settlers.some((o) => o.alive && o.role === "worker" && o.target === t && o.id !== s.id)) continue;
          most = g;
          best = t;
        }
        return best;
      }
      case "fungus": {
        // Ripe glowcaps first (wild ones too); otherwise plant on open damp ground.
        const ripe = this.findWorkTile(b, (t) => land.feature[t] === Feature.Glowcap && (land.amount[t] as number) >= GLOWCAP_RIPE);
        if (ripe >= 0) return ripe;
        const caps = land.ring(b.tile, def.radius ?? 3).filter((t) => land.feature[t] === Feature.Glowcap).length;
        return caps < 8 ? this.findWorkTile(b, open) : -1;
      }
      case "peat":
        // Cut peat from deep mire soil.
        return this.findWorkTile(b, (t) => (land.region[t] === Region.LumenMire || land.planet.terrain.biome[t] === Biome.Marsh) && open(t) && (land.soil[t] as number) > 0.35);
      case "shellfish": {
        // Exposed flats with shellfish on them, at low water.
        for (const t of land.ring(b.tile, def.radius ?? 5)) {
          if (!land.tidal[t] || land.flooded[t] || (land.shell[t] as number) === 0 || !land.walkable(t)) continue;
          if (this.settlers.some((o) => o.alive && o.role === "worker" && o.target === t && o.id !== s.id)) continue;
          return t;
        }
        return -1;
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
        // Solar kilns and salt pans work by daylight; tide mills while the tide runs.
        if ((def.daylight && !this.sunUp(b.tile)) || (def.tidal && this.climate && Math.abs(this.climate.tide) > 0.85)) {
          s.timer = 60;
          return;
        }
        if (def.job === "craft") {
          // Terraforming works make no goods: each cycle works on the planet itself.
          const out = def.terra ? -1 : this.producedType(b);
          if ((out >= 0 || def.terra) && this.consumeInputs(b)) {
            s.state = "craft";
            s.target = out;
            s.timer = Math.round((def.workTicks ?? 60) * this.speedFactor(s, def.id));
          } else s.timer = 15;
          return;
        }
        if (def.job === "ropeway") {
          // Gondolas go up only while a sky island with stone drifts within reach.
          const isle = this.islandNear(b.tile, def.radius ?? 3);
          if (!isle) {
            s.timer = 120;
            return;
          }
          isle.stone--;
          s.state = "craft";
          s.target = goodId(def.produces ?? "skystone");
          s.timer = Math.round((def.workTicks ?? 100) * this.speedFactor(s, def.id));
          return;
        }
        if (def.job === "bees") {
          // Bees fly in the warm months; the more flowers nearby, the faster the honey.
          if (this.climate && (this.climate.temp[b.tile] as number) < 8) {
            s.timer = 120;
            return;
          }
          let bees = 0;
          const around = [b.tile, ...land.ring(b.tile, 2)];
          for (const t of around) bees += this.ecology.bees[t] as number;
          bees /= around.length * 255;
          s.state = "craft";
          s.target = goodId(def.produces ?? "honey");
          s.timer = Math.round(((def.workTicks ?? 200) / (0.35 + bees * 1.4)) * this.speedFactor(s, def.id));
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
        if (def.job === "fell" && land.feature[t] === Feature.Giant && land.variety[t] === 1) {
          // An ancient giant takes many trips; the last cut brings it down.
          land.amount[t] = Math.max(0, (land.amount[t] as number) - 1);
          got = produced;
          if (land.amount[t] === 0) {
            land.feature[t] = Feature.Stump;
            land.amount[t] = 60;
            land.variety[t] = 0;
            this.ancientFelled(t, b.owner);
          }
          land.featureVersion++;
        } else if (def.job === "orchard") {
          if (this.inFruit(t)) {
            land.nextGrowth[t] = this.tick + FRUIT_TICKS;
            got = produced;
          } else if ((land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.use[t] === Use.Free) {
            land.feature[t] = Feature.Tree;
            land.amount[t] = 0;
            land.variety[t] = ORCHARD;
            land.nextGrowth[t] = this.tick + this.treeGrowthTicks(t);
            this.growing.push(t);
            land.featureVersion++;
          }
        } else if (def.job === "fell" && fellable(land, t)) {
          land.feature[t] = Feature.Stump;
          land.amount[t] = 12;
          land.featureVersion++;
          got = produced;
        } else if (def.job === "quarry" && land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
          land.amount[t]!--;
          if (land.amount[t] === 0) land.feature[t] = Feature.None;
          land.featureVersion++;
          // Rock by a vent is shot through with volcanic glass; a meteorite is iron, with gold in it.
          if (land.variety[t] === METEORITE) got = mix32(t, this.tick) % 3 === 0 ? goodId("gold") : goodId("iron");
          else got = land.nearVent(t, 2) && (mix32(t, this.tick) & 1) === 0 ? goodId("obsidian") : produced;
        } else if (def.job === "excavate" && land.feature[t] === Feature.Ruin && (land.amount[t] as number) > 0) {
          land.amount[t]!--;
          // Dug out: the ruin stays, open to the sky.
          if (land.amount[t] === 0) land.variety[t] = 1;
          land.featureVersion++;
          got = produced;
          const who = this.people[s.person];
          this.culture.relic(b.owner, who ? `${who.first} ${who.family}` : "");
          if (who) note(who, "Dug a Precursor relic out of the ruin by the Star Well.");
        } else if (def.job === "plant" && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.use[t] === Use.Free) {
          land.feature[t] = Feature.Tree;
          land.amount[t] = 0;
          land.variety[t] = (t * 7 + this.tick) & 3;
          land.nextGrowth[t] = this.tick + this.treeGrowthTicks(t);
          this.growing.push(t);
          land.featureVersion++;
        } else if (def.job === "farm") {
          if (land.feature[t] === Feature.Field && (land.amount[t] as number) >= FIELD_RIPE) {
            land.feature[t] = Feature.None;
            land.amount[t] = 0;
            // Each harvest takes from the soil.
            land.soil[t] = Math.max(0.05, (land.soil[t] as number) - 0.09);
            // A blighted crop is good for nothing.
            got = this.adversity.blight[t] ? -1 : produced;
            if (this.adversity.blight[t]) {
              this.adversity.blight[t] = 0;
              this.adversity.blightVersion++;
            }
          } else if ((land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.use[t] === Use.Free) {
            land.feature[t] = Feature.Field;
            land.amount[t] = 0;
            land.nextGrowth[t] = this.tick + this.fieldGrowthTicks(t);
            this.fieldTiles.push(t);
          }
          land.featureVersion++;
        } else if (def.job === "fish" && s.home >= 0 && (land.fish[s.home] as number) > 0) {
          land.fish[s.home]!--;
          got = produced;
        } else if (def.job === "hunt" && this.ecology.hunt(t)) got = produced;
        else if (def.job === "fungus") {
          if (land.feature[t] === Feature.Glowcap && (land.amount[t] as number) >= GLOWCAP_RIPE) {
            land.feature[t] = Feature.None;
            land.amount[t] = 0;
            got = produced;
          } else if ((land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.use[t] === Use.Free) {
            land.feature[t] = Feature.Glowcap;
            land.amount[t] = 0;
            land.variety[t] = 0;
          }
          land.featureVersion++;
        } else if (def.job === "peat" && (land.soil[t] as number) > 0.35) {
          land.soil[t] = (land.soil[t] as number) - 0.2;
          got = produced;
        } else if (def.job === "shellfish" && !land.flooded[t] && (land.shell[t] as number) > 0) {
          land.shell[t]!--;
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
        if (def.terra) this.onTerraform?.(b);
        // The kiln's focused heat can set dry growth next door alight.
        if (def.fireRisk && mix32(b.id, this.tick) % def.fireRisk === 0) {
          const ns = land.planet.grid.neighborsOf(b.tile);
          const t = ns[mix32(this.tick, b.tile) % ns.length] as number;
          if (this.ecology.ignite(t)) this.notify(b.owner, `Sparks from the ${def.name.toLowerCase()} have started a fire!`);
        }
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
    else if (s.role === "attacker") this.stepAttacker(s);
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
        else land.nextGrowth[t] = this.tick + this.treeGrowthTicks(t);
      }
    }
    for (let i = this.fieldTiles.length - 1; i >= 0; i--) {
      const t = this.fieldTiles[i] as number;
      if (land.feature[t] !== Feature.Field) {
        this.fieldTiles.splice(i, 1);
        continue;
      }
      if ((land.amount[t] as number) < FIELD_RIPE && (land.nextGrowth[t] as number) <= this.tick) {
        // Outside the growing season fields wait; frost doesn't kill them, it just holds them.
        if (this.climate && !this.climate.growing(t)) {
          land.nextGrowth[t] = this.tick + 200;
          continue;
        }
        // Blighted crops stand still until the blight passes.
        if (this.adversity.blight[t]) {
          land.nextGrowth[t] = this.tick + 200;
          continue;
        }
        // Mire crops grow only in daylight or under glowcaps.
        if (land.region[t] === Region.LumenMire && !land.glow[t] && !this.sunUp(t)) {
          land.nextGrowth[t] = this.tick + 200;
          continue;
        }
        land.amount[t]!++;
        land.nextGrowth[t] = this.tick + this.fieldGrowthTicks(t);
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
    const hourIndex = Math.floor(this.tick / hour);
    if (daily) {
      for (const k of this.keeps) if (k !== undefined) (this.buildings[k] as Building).levy = 0;
      this.restSoil();
      this.weather();
    }
    for (let p = 0; p < this.keeps.length; p++) {
      // Colony worlds: only players who have landed there have a keep.
      if (this.keeps[p] === undefined) continue;
      if (!daily && hourIndex % 3 === p % 3) this.newcomers(p);
      if (daily) {
        if (this.colony) this.colonyDay(p);
        this.dailyLife(p);
        this.culture.daily(p);
        this.trainWardens(p);
      }
      this.updateGlow(p);
    }
    if (daily) this.diplomacy.daily();
  }

  /** Room for people: the Hearthship's berths plus every house. */
  capacity(owner: number): number {
    return 30 + this.houses(owner).length * HOUSE_CAPACITY;
  }

  /**
   * Newcomers: while there is room and the settlement is content and fed, a traveller joins
   * at the Hearthship every few hours. Houses are how a settlement grows.
   */
  private newcomers(owner: number): void {
    // Nobody comes looking for a home at a colony until it has taken root.
    if (this.defeated[owner] || (this.colony && !this.rooted[owner])) return;
    const keep = this.buildings[this.keeps[owner] ?? -1];
    if (!keep || keep.owner !== owner) return;
    const all = this.members(owner);
    if (all.length >= this.capacity(owner) || (this.glow[owner] ?? 0) < 50 || this.hungry[owner]) return;
    const r = this.lifeRng as Rng;
    const p = this.addPerson(owner, randomFirst(r), randomFamily(r), this.tick - r.int(17, 30) * this.dayTicks, r);
    note(p, "Arrived at the Hearthship looking for a new home.");
    this.notify(owner, `${fullName(p)} has come to join you.`);
  }

  /**
   * A colony's day: it takes root once enough is built, and its ways drift from home the longer
   * it goes without a skyship calling.
   */
  private colonyDay(owner: number): void {
    const built = this.buildings.filter((b) => b.alive && b.built && b.owner === owner && !b.def.storage).length;
    if (!this.rooted[owner] && built >= ROOTED_BUILDINGS) {
      this.rooted[owner] = true;
      this.notify(owner, "The colony has taken root: newcomers will now settle here, and it may build its own launch rail.");
    }
    this.drift[owner] = Math.min(1, (this.drift[owner] ?? 0) + 0.02);
  }

  /** A wild sapling takes on open ground (a terraformed world's new woodland). */
  sprout(t: number): void {
    const land = this.land;
    land.feature[t] = Feature.Tree;
    land.amount[t] = 0;
    land.variety[t] = mix32(t, 3) & 3;
    land.nextGrowth[t] = this.tick + TREE_GROWTH_TICKS * 2;
    land.featureVersion++;
    this.growing.push(t);
  }

  /** A skyship from home calls: news, letters and goods pull the colony's ways back a little. */
  skyshipCalled(owner: number): void {
    this.drift[owner] = Math.max(0, (this.drift[owner] ?? 0) - 0.08);
  }

  private members(owner: number, stage?: string): Person[] {
    return this.people.filter((p) => p.alive && p.owner === owner && (!stage || p.stage === stage));
  }

  private houses(owner: number): Building[] {
    return this.buildings.filter((b) => b.alive && b.built && b.owner === owner && !!b.def.home);
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
    if (keep) {
      for (const t of this.land.ring(keep.tile, 7)) {
        if (this.land.feature[t] === Feature.Tree) trees += this.land.variety[t] === MEMORIAL ? 3 : 1;
        else if (this.land.feature[t] === Feature.Spire) trees += 2;
      }
    }
    const totals = this.storageTotals(owner);
    const working = adults.filter((p) => p.settler >= 0).length / Math.max(1, adults.length);
    const grieving = (this.griefUntil[owner] ?? -1) > this.tick;
    // Broken word: the people are ashamed for a few days.
    const shamed = this.diplomacy.shamed(owner);
    const parts: GlowParts = {
      // Salt keeps the stores from spoiling: a little more nourishment from the same food.
      nourishment: this.hungry[owner] ? 0.1 : Math.min(1, 0.25 + food / (perDay * 4) + Math.min(0.15, (totals[goodId("salt")] as number) / 40)),
      shelter: Math.min(1, (KEEP_SHELTER + houses.length * HOUSE_ADULTS) / all.length),
      belonging: Math.max(0, 0.3 + 0.7 * (housed / all.length) - (grieving ? 0.2 : 0)) * (shamed ? 0.6 : 1),
      beauty: Math.min(1, 0.2 + trees / 30 + Math.min(0.25, ((totals[goodId("obsidian")] as number) + (totals[goodId("glass")] as number)) / 24) + Math.min(0.35, this.culture.decor(owner) / 12)) * (grieving ? 0.4 : 1),
      rest: Math.max(0.3, Math.min(1, 1.35 - working)),
      variety: Math.min(1, this.culture.variety(owner) / 3),
      joy: grieving ? 0.2 : (shamed ? 0.25 : 0.5) + (shamed ? 0.25 : 0.5) * this.culture.joy(owner),
      wonder: Math.min(1, 0.4 + (this.culture.pages[owner]?.length ?? 0) * 0.05 + (this.culture.relics[owner] ?? 0) * 0.05),
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

  // ------------------------------------------------------------------ Lumen Mire and Skyreef

  /** Floating islands of buoyant stone over the Skyreef: where they drift from, where they are now, stone left. */
  readonly islands: { id: number; home: number; at: number; stone: number }[] = [];
  private islandsMade = false;
  private lumenTiles: number[] | null = null;

  /** Sky islands, made once from the Skyreef heights (spaced out, at most eight). */
  skyIslands(): { id: number; home: number; at: number; stone: number }[] {
    if (!this.islandsMade) {
      this.islandsMade = true;
      const land = this.land;
      const reef: number[] = [];
      for (let t = 0; t < land.region.length; t++) if (land.region[t] === Region.Skyreef) reef.push(t);
      reef.sort((a, b) => mix32(a, 0x5c1f) - mix32(b, 0x5c1f));
      for (const t of reef) {
        if (this.islands.length >= Math.min(8, Math.ceil(reef.length / 20))) break;
        if (this.islands.some((i) => land.ring(i.home, 5).includes(t))) continue;
        this.islands.push({ id: this.islands.length, home: t, at: t, stone: 40 });
      }
    }
    return this.islands;
  }

  /** A sky island with stone left within `r` steps of a tile. */
  islandNear(t: number, r: number): { id: number; home: number; at: number; stone: number } | null {
    const near = [t, ...this.land.ring(t, r)];
    return this.skyIslands().find((i) => i.stone > 0 && near.includes(i.at)) ?? null;
  }

  /** Daily: the islands drift a step on the high winds, never far from home; mire spores spread. */
  private stepHeights(): void {
    const land = this.land;
    for (const isle of this.skyIslands()) {
      const around = land.ring(isle.home, 3);
      const next = land.planet.grid.neighborsOf(isle.at).filter((t) => t === isle.home || around.includes(t));
      if (next.length) isle.at = next[mix32(isle.id, this.tick) % next.length] as number;
    }
    // Spores: wild glowcaps seed the damp ground next to them.
    this.lumenTiles ??= Array.from({ length: land.region.length }, (_, t) => t).filter((t) => land.region[t] === Region.LumenMire);
    let spread = false;
    for (const t of this.lumenTiles) {
      if (land.feature[t] !== Feature.Glowcap || (land.amount[t] as number) < GLOWCAP_RIPE || (mix32(t, this.tick) & 3) !== 0) continue;
      const ns = land.planet.grid.neighborsOf(t);
      const n = ns[mix32(this.tick, t) % ns.length] as number;
      if (land.region[n] !== Region.LumenMire || land.use[n] !== Use.Free || land.feature[n] !== Feature.None) continue;
      land.feature[n] = Feature.Glowcap;
      land.amount[n] = 0;
      land.variety[n] = 1;
      spread = true;
    }
    if (spread) land.featureVersion++;
  }

  /** Hourly: glowcaps grow (in any light) and glow; mire tiles out of the sun and the glow go dim. */
  private stepLight(): void {
    const land = this.land;
    land.glow.fill(0);
    let grew = false;
    for (let t = 0; t < land.feature.length; t++) {
      if (land.feature[t] !== Feature.Glowcap) continue;
      const a = land.amount[t] as number;
      if (a < GLOWCAP_RIPE && (mix32(t, this.tick) & 1)) {
        land.amount[t] = a + 1;
        grew = true;
      }
      if (a >= 2) {
        land.glow[t] = 1;
        for (const n of land.planet.grid.neighborsOf(t)) land.glow[n] = 1;
      }
    }
    for (const b of this.buildings) if (b.alive && b.built && b.def.job === "fungus") for (const m of [b.tile, ...land.ring(b.tile, 2)]) land.glow[m] = 1;
    this.lumenTiles ??= Array.from({ length: land.region.length }, (_, t) => t).filter((t) => land.region[t] === Region.LumenMire);
    for (const t of this.lumenTiles) land.dim[t] = !land.glow[t] && !this.sunUp(t) ? 1 : 0;
    land.glowVersion++;
    if (grew) land.featureVersion++;
  }

  // ------------------------------------------------------------------ Saltglass and Tidewater

  /** Sandstorms raging now (Saltglass): centre tile and the tick they blow out. */
  readonly storms: { tile: number; until: number }[] = [];
  private saltTiles: number[] | null = null;
  private dewMap: Uint8Array | null = null;
  private dewMapVersion = -1;

  /** A working dew condenser within three steps. */
  dewNear(t: number): boolean {
    if (!this.dewMap || this.dewMapVersion !== this.structureVersion) {
      this.dewMapVersion = this.structureVersion;
      this.dewMap ??= new Uint8Array(this.land.planet.grid.count);
      this.dewMap.fill(0);
      for (const b of this.buildings) {
        if (!b.alive || !b.built || !b.def.dew) continue;
        this.dewMap[b.tile] = 1;
        for (const m of this.land.ring(b.tile, 3)) this.dewMap[m] = 1;
      }
    }
    return this.dewMap[t] === 1;
  }

  /** Daily: storms may rise over the Saltglass; shellfish breed on the flats; old sand settles. */
  private stepCoasts(): void {
    const land = this.land;
    this.saltTiles ??= Array.from({ length: land.region.length }, (_, t) => t).filter((t) => land.region[t] === Region.SaltglassFlats);
    const salt = this.saltTiles;
    if (salt.length && mix32(this.tick, 0x5a17) % 3 === 0) this.startStorm(salt[mix32(this.tick, 0x5a18) % salt.length] as number);
    for (let t = 0; t < land.shell.length; t++) if (land.tidal[t] && (land.shell[t] as number) < 10 && (mix32(t, this.tick) & 1)) land.shell[t]!++;
    let sand = false;
    for (let t = 0; t < land.sand.length; t++) {
      const v = land.sand[t] as number;
      if (v <= 0) continue;
      land.sand[t] = v < 0.03 ? 0 : v * 0.92;
      sand = true;
    }
    if (sand) land.sandVersion++;
  }

  /** A sandstorm rises at a tile and blows for six hours. */
  startStorm(t: number): void {
    this.storms.push({ tile: t, until: this.tick + 1800 });
    for (const o of this.ownersNear(t, 5)) {
      this.notify(o, "A sandstorm is blowing in over the Saltglass! Roads will be buried; carriers clear them as they pass.");
      this.culture.discover(o, "storms");
    }
  }

  /** Hourly while a storm blows: sand drifts over everything within four steps. */
  private stepStorms(): void {
    const land = this.land;
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const st = this.storms[i]!;
      if (st.until <= this.tick) {
        this.storms.splice(i, 1);
        continue;
      }
      for (const t of [st.tile, ...land.ring(st.tile, 4)]) if (land.isLand(t)) land.sand[t] = Math.min(1, (land.sand[t] as number) + 0.25);
      land.sandVersion++;
    }
  }

  // ------------------------------------------------------------------ Rimefall and Emberglass

  /** Tremors felt at each vent since it last erupted (for the tile panel). */
  readonly tremors = new Map<number, number>();
  /** Tick of each vent's last eruption (for the renderer's ash column). */
  readonly eruptedAt = new Map<number, number>();
  private ventList: number[] | null = null;

  /** Geothermal vent tiles (they never move). */
  vents(): number[] {
    if (!this.ventList) {
      this.ventList = [];
      for (let t = 0; t < this.land.feature.length; t++) if (this.land.feature[t] === Feature.Vent) this.ventList.push(t);
    }
    return this.ventList;
  }

  /** A forge within two steps of a vent needs no coal. */
  ventHeat(b: Building): boolean {
    return !!b.def.forge && !!b.def.inputs?.fuel && this.land.nearVent(b.tile, 2);
  }

  /** A waystation has fuel burning. */
  heated(b: Building): boolean {
    return !!b.def.heated && b.built && b.fuelUntil > this.tick;
  }

  private stepFrontiers(tick: number): void {
    if (this.climate?.thawed) {
      this.climate.thawed = false;
      this.sinkIceRoads();
    }
    if (tick % 300 === 150) {
      this.stepWarmth();
      this.stepLight();
      if (this.storms.length) this.stepStorms();
    }
    if (tick % this.dayTicks === 3601 % this.dayTicks) this.stepVents();
    if (tick % this.dayTicks === 1801 % this.dayTicks) this.stepCoasts();
    if (tick % this.dayTicks === 5401 % this.dayTicks) this.stepHeights();
  }

  /** Hourly: waystations burn a log when it's bitter nearby; hearths and fires warm the land. */
  private stepWarmth(): void {
    const land = this.land;
    const log = goodId("log");
    land.warm.fill(0);
    for (const b of this.buildings) {
      if (!b.alive || !b.built || !b.def.warmth || b.stranded >= 0) continue;
      const around = [b.tile, ...land.ring(b.tile, b.def.warmth)];
      if (b.def.heated && b.fuelUntil <= this.tick) {
        if ((b.stock[log] as number) <= 0 || !around.some((t) => land.chill[t])) continue;
        b.stock[log]!--;
        b.fuelUntil = this.tick + 1200;
      }
      for (const t of around) land.warm[t] = 1;
    }
  }

  /** The thaw: roads and flags out on lake ice sink. */
  private sinkIceRoads(): void {
    const land = this.land;
    const sunk = new Set<number>();
    const thin = (t: number) => land.hydro.lake[t] === 1 && !land.frozen[t];
    for (const r of this.roads) {
      if (!r.alive || !r.tiles.some(thin)) continue;
      sunk.add(r.owner);
      this.removeRoad(r);
    }
    for (const f of this.flags) {
      if (!f.alive || !thin(f.tile)) continue;
      sunk.add(f.owner);
      this.removeFlag(f);
    }
    for (const p of sunk) this.notify(p, "The lake ice has broken up and your ice road sank. Lay it again after the next hard frost.");
  }

  /** Daily: vents build pressure, the ground trembles, and at last they erupt. */
  private stepVents(): void {
    const land = this.land;
    for (const t of this.vents()) {
      const p = Math.min(255, (land.amount[t] as number) + 5 + (mix32(t, this.tick) & 7));
      land.amount[t] = p;
      if (p >= 250) {
        this.erupt(t);
        continue;
      }
      if (p < 190 || (mix32(t, this.tick ^ 0x7e11) & 1)) continue;
      this.tremors.set(t, (this.tremors.get(t) ?? 0) + 1);
      for (const o of this.ownersNear(t, 5)) this.notify(o, "The ground trembles near a vent. It may erupt: keep homes and fields back from it.");
    }
    // Old ash weathers into the soil.
    let ash = false;
    for (let t = 0; t < land.ash.length; t++) {
      const a = land.ash[t] as number;
      if (a <= 0) continue;
      land.ash[t] = a < 0.02 ? 0 : a * 0.94;
      ash = true;
    }
    if (ash) land.ashVersion++;
  }

  /** Players with land within `r` steps of `t`. */
  private ownersNear(t: number, r: number): number[] {
    const out = new Set<number>();
    for (const m of [t, ...this.land.ring(t, r)]) if (this.land.territory[m]) out.add((this.land.territory[m] as number) - 1);
    return [...out].sort((a, b) => a - b);
  }

  /** A vent blows: ash falls (enriching the soil), buildings nearby are scorched, dry growth catches. */
  erupt(t: number): void {
    const land = this.land;
    const grid = land.planet.grid;
    land.amount[t] = 0;
    this.tremors.delete(t);
    this.eruptedAt.set(t, this.tick);
    const dist = new Map<number, number>([[t, 0]]);
    for (let d = 1, front = [t]; d <= 4; d++) {
      const next: number[] = [];
      for (const x of front) for (const n of grid.neighborsOf(x)) if (!dist.has(n)) {
        dist.set(n, d);
        next.push(n);
      }
      front = next;
    }
    for (const [x, d] of [...dist].sort((a, b) => a[0] - b[0])) {
      if (!land.isLand(x)) continue;
      const fall = 1 - d / 5;
      land.ash[x] = Math.max(land.ash[x] as number, fall);
      land.soil[x] = Math.min(1, (land.soil[x] as number) + 0.3 * fall);
      land.snowCover[x] = 0;
      if (d === 0) continue;
      const b = land.use[x] === Use.Building ? this.buildings[land.ref[x] as number] : undefined;
      if (b?.alive) {
        if (d <= 1) this.scorchBuilding(x);
        b.wear = Math.min(1, b.wear + 0.4 * fall);
        b.soot = Math.min(1, b.soot + 0.6 * fall);
      } else if (d <= 3 && land.use[x] === Use.Free) {
        const f = land.feature[x];
        if ((f === Feature.Tree || f === Feature.Shrub || f === Feature.Field) && (mix32(x, this.tick) & 3) !== 0) this.ecology.ignite(x);
        else if (d === 2 && f === Feature.None && (mix32(x, this.tick ^ 0xb5) & 7) === 0) {
          // Glassy bombs land and set: obsidian boulders.
          land.feature[x] = Feature.Rock;
          land.amount[x] = 4;
          land.variety[x] = x & 3;
          land.featureVersion++;
        }
      }
    }
    land.ashVersion++;
    for (const o of this.ownersNear(t, 6)) {
      this.notify(o, "A vent has erupted! Ash has fallen; it will enrich the soil once it weathers in.");
      this.culture.discover(o, "eruption");
    }
  }

  // ------------------------------------------------------------------ main step

  step(tick: number): void {
    this.tick = tick;
    if (tick % SUPPLY_INTERVAL === 0) {
      this.supply();
      if (tick % EMPTY_INTERVAL === 0) this.emptyStores();
      this.dispatch();
      for (const g of this.goods) if (g.alive && g.dest < 0 && g.carrier < 0) this.assignDestination(g);
    }
    for (const s of this.settlers) if (s.alive) this.stepSettler(s);
    this.stepNature();
    this.ecology.step(tick, tick % CLIMATE_STEP === 0);
    this.stepLife();
    this.stepSieges();
    if (tick % 50 === 0) {
      this.stepStranded();
      this.standDown();
    }
    if (tick % 100 === 0) this.stepVictory();
    this.stepFrontiers(tick);
    this.adversity.step(tick);
    this.wanderers.step(tick);
    if (this.climate) this.climate.coldSnap = this.adversity.cold;
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
    for (const r of this.roads) if (r.alive && r.helpers.length) h.int(r.id).int(r.helpers.length);
    let wear = 0;
    for (let t = 0; t < this.land.wear.length; t += 13) wear += this.land.wear[t] as number;
    h.int(wear);
    for (const b of this.buildings) if (b.alive) h.int(b.consumed).int(b.output).int(b.residents).int(b.garrison.length).int(b.lit ? 1 : 0);
    let owned = 0;
    for (let t = 0; t < this.land.territory.length; t++) owned = (owned + (this.land.territory[t] as number) * (t % 97 + 1)) | 0;
    h.int(owned).int(this.winner);
    for (const b of this.buildings) if (b.alive) h.int(b.stranded).int(b.siege.length).int(b.owner).int(b.dig).int(b.mode);
    for (const u of this.rotateUntil) h.int(u ?? -1);
    for (const p of this.people) if (p.alive) h.int(p.rank).int(p.arms).int(p.owner);
    for (const b of this.buildings) if (b.alive) h.int(Math.round(b.wear * 1000)).int(b.burn).int(b.fuelUntil);
    let vents = 0;
    for (const t of this.vents()) vents = (vents * 31 + (this.land.amount[t] as number)) | 0;
    h.int(vents);
    let coast = 0;
    for (let t = 0; t < this.land.sand.length; t += 7) coast = (coast * 31 + Math.round((this.land.sand[t] as number) * 100) + (this.land.causeway[t] as number) * 7 + (this.land.shell[t] as number)) | 0;
    h.int(coast).int(this.storms.length);
    for (const i of this.islands) h.int(i.at).int(i.stone);
    this.ecology.hash(h);
    this.culture.hash(h);
    this.adversity.hash(h);
    this.diplomacy.hash(h);
    this.wanderers.hash(h);
  }
}
