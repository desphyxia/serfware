import { FLAG_CAPACITY, type Building, type CommandResult, type Economy, type Good, type Settler } from "../../src/sim/econ/economy";
import { Feature, Use, fellable } from "../../src/sim/econ/landuse";
import { frontierTiles } from "../../src/sim/econ/planner";
import { aiStats, aiWhy } from "../../src/sim/ai/builder";
import type { World } from "../../src/sim/world";
import type { Person } from "../../src/sim/econ/people";
import { BUILDINGS, GOODS, goodId, goodsArray, goodsFor } from "../../src/sim/econ/defs";

/**
 * Instrumentation for the balance games: what is made, used and lost (item 1), why workplaces stand idle
 * (2), when buildings go up and what delays them (3), how goods queue and roads fill (4), people and food
 * (5), and the war record (6). It only reads the economy and wraps a few of its methods from outside, the way
 * the harness already wraps `capture`; every wrapper calls the original with the same arguments, so a game
 * plays out exactly as it does without the probe (checked by comparing World.checksum()).
 *
 * Indexing: "rival" arrays index rival seats (rival 0 is player 1; player 0 is the steward seat and is not
 * measured, as in the daily samples). The war log uses player ids as the engine does. Goods are indexed as in
 * GameRecord.goods.
 *
 * Days: the world advances the tick first and then runs the daily work (closing the day's books, meals,
 * upkeep) at every multiple of `dayTicks`. A game is not at a multiple when the harness starts sampling
 * (the world has already run `startTick` ticks, 4770 of 7500 on the maps tried), so "day d" in the per-day
 * arrays is the window (startTick + d*dayTicks, startTick + (d+1)*dayTicks]: exactly one daily close and one
 * meal fall inside it, but they fall `dayTicks - startTick % dayTicks` ticks into it, not at its end. Anything
 * read at the end of the window (food stock, people) is therefore part way through the cycle between two
 * meals; use `foodBefore` and `mealNeed`, recorded at the meal itself, for hunger. A moment (building rows,
 * war log) is the absolute game time, tick / dayTicks with two decimals.
 */

/** Samples per game day for the state snapshots (workplaces, building sites, flags). */
export const SAMPLES_PER_DAY = 4;
/** Snapshot counts are summed over blocks of this many days, so a record stays small. */
export const BUCKET_DAYS = 10;
/** Age bands for goods waiting on flags, in game hours: under 1, 1-3, 3-6, 6-12, 12-24, over 24. */
export const AGE_BANDS_HOURS = [1, 3, 6, 12, 24] as const;
/** Goods waiting at least this many game hours on a flag count as stuck, per good. */
const STUCK_HOURS = 6;
/** Most buildings and war events kept per game; the rest are counted in `*Dropped`. */
const MAX_BUILDINGS = 1500;
const MAX_WAR = 2000;
const MAX_QUARRIES = 400;

/** Per rival per day, in this order (see ProbeData.seatDay). */
export const SEAT_DAY_FIELDS = [
  "alive", // 1 until the seat has fallen
  "kids",
  "adults",
  "elders",
  "capacity", // room for people: berths plus houses
  "idleAdults", // adults with no job: mean of the day's snapshots (an end-of-day count would catch new adults before they are given work)
  "jobs", // finished workplaces: mean of the day's snapshots
  "unfilled", // workplaces with no worker (not exhausted or stranded): mean of the day's snapshots
  "hungry", // 1 if the day's meals were not covered
  "foodStock", // food in the warehouses at the end of the window (part way between two meals, see Days above)
  "births",
  "arrivals", // newcomers and welcomed settlers
  "deaths",
  "meals", // food units eaten at the day's meal
  "wardens",
  "attackers", // wardens out on an attack
  "lit", // lit lanterns (territory)
  "resolve", // x100
  "morale", // x100
  "foodBefore", // food in the warehouses just before the day's meal
  "mealNeed", // food units the people needed at the meal (0.45 a head, rounded up); hungry when foodBefore < mealNeed
  "mealPeople", // people at the meal
  "territory", // land tiles inside the border at the end of the window
  "frontier", // own tiles `frontierTiles` offers a lantern (8+ free land tiles and 12+ own within 5)
  "aiThoughts", // from here, running counts since the start (AiBuilder aiStats): thoughts past the pace check
  "aiCapped", // stopped at the sites cap
  "aiNoIdle", // no idle hands
  "aiBorderWanted", // thoughts that wanted the border pushed out
  "aiBorderTried", // `expand` calls
  "aiNoFrontier", // `expand` calls with no frontier tile
  "aiBorderPlaced", // lanterns placed
  "aiChoseBeacon", // `expand` calls that chose a beacon tower
  "aiChoseLamphouse", // ... a lamp house
  "aiPlaceFailed", // calls with frontier tiles that placed nothing
  "aiBorderCuts", // woodcutters built to clear the way for the border (`clear`)
] as const;

/**
 * What lies on the ground, counted over the whole map and again inside each rival's border (ProbeData.mapDay, resDay).
 * Rock: tiles with material left and the material (one stone a unit). Trees: all, and those fit to fell (the logs
 * available now; trees grow back). Ore: loads left in the deposits under the ground, whether or not a geologist has
 * found them (a mine takes a load a time). Fish: stock in the water.
 */
export const RESOURCE_FIELDS = ["rockTiles", "rockUnits", "trees", "fellable", "coal", "ironore", "goldore", "granite", "fish"] as const;
/**
 * A rival's land tiles by what is on them (ProbeData.landDay), in this order of precedence: buildings, roads, flags,
 * ground kept clear beside a large building (`blocked`), fields, trees, rock, other growth or ruins that stop building
 * (hedges, giants, vents, spires, glowcaps, ruins), free ground too steep to road (`steep`), and the rest, free and open.
 */
export const LAND_FIELDS = ["land", "building", "road", "flag", "blocked", "field", "tree", "rock", "other", "steep", "open"] as const;

export interface LogBucket {
  /** Seat-samples taken in this block (rivals still standing x samples). */
  samples: number;
  /** Flags, goods lying on them, flags at capacity, goods with no reachable destination. */
  flags: number;
  goods: number;
  fullFlags: number;
  noDest: number;
  /** Goods waiting on flags by age band (AGE_BANDS_HOURS). */
  age: number[];
  /** Goods waiting at least STUCK_HOURS, by good. */
  stuck: number[];
}

export interface ProbeData {
  dayTicks: number;
  /** The world's tick when the probe was installed: the window of "day d" starts at startTick + d * dayTicks. */
  startTick: number;
  samplesPerDay: number;
  bucketDays: number;
  /** Building type ids, indexed as `buildings` rows refer to them. */
  buildingIds: string[];
  /**
   * Item 1. [day][rival] -> sparse [good, count, good, count, ...]: units made by workers; used as
   * inputs (crafts, miners' rations); used up building (the cost of each building finished); eaten at
   * meals; used for upkeep (planks, stone); used up as arms or other goods taken from storage; destroyed on the road.
   */
  produced: number[][][];
  usedInput: number[][][];
  usedBuild: number[][][];
  usedFood: number[][][];
  usedUpkeep: number[][][];
  /** Consumed: arms given to wardens, and non-tool goods taken from storage (ferry boats, causeway stones, hedgerow logs). Tools are not here: they come back to the keep. */
  usedGear: number[][][];
  /** Tools taken from storage to start a job (a builder's hammer on every building started, a worker's tool). Taking is not consuming: the tool returns when the worker goes home. */
  toolTaken: number[][][];
  /** Tool goods owned at the end of each window, in storage or in a worker's hand: [day][rival] -> sparse [good, count, ...]. `toolsStart` is the same when the probe was installed. */
  tools: number[][][];
  toolsStart: number[][];
  /** Food eaten by miners at their mines (rations), kept apart from `usedInput`. */
  usedMine: number[][][];
  lost: number[][][];
  /** Units made over the whole game, by building type id, per rival; and craft cycles started. */
  producedBy: Record<string, number>[];
  cycles: Record<string, number>[];
  /** Items 5 and 6: [day][rival][field], fields as SEAT_DAY_FIELDS. */
  seatDayFields: string[];
  seatDay: number[][][];
  /** Item 3: one row per building a rival placed: [type, rival, placed, finished or -1, ended or -1, how (0 standing, 1 gone, 2 captured)]. */
  buildings: number[][];
  buildingsDropped: number;
  /** Item 2. Per block of days: "buildingId|reason" -> workplace-samples. Reasons: working, no_worker, no_tool, stranded, exhausted, input:<key>[+<key>], output_blocked, other:<settler state>. */
  idle: Record<string, number>[];
  /**
   * Per block: "buildingId" -> [searches for a job target, searches that found none] by gatherers (woodcutters,
   * quarries, farms, fishers, hunters, ...). A worker that finds none rests 60 ticks and tries again.
   * The idle reasons `no_target` (a search found nothing in the last 60 ticks) and `no_path` (a target was found
   * but no walkable route to it) split what used to be an undifferentiated `other:rest`.
   */
  search: Record<string, number[]>[];
  /**
   * Item 3. Per block: "buildingId|reason" -> site-samples. Reasons: dig, building, finishing,
   * no_builder:<cause> (materials are on site but no builder was assigned: no_hammer in any warehouse,
   * no_person with no adult free for a job, else no_route: no road from a home to the site),
   * wait_transit:<good> (the biggest missing material is on its way), wait_none:<good> (nothing sent yet).
   */
  sites: Record<string, number>[];
  /** Per block: "buildingId" -> [sum of yesterday's worked share, workplaces counted] (average = first / second). */
  util: Record<string, number[]>[];
  /** Item 4. */
  logistics: LogBucket[];
  /** Per block: roads by yesterday's carrier load, under 25%, 25-50, 50-75, 75% and over. */
  roads: number[][];
  /**
   * Rock for the quarries. One row per quarry a rival placed: [rival, placed, rock tiles in reach at placement, their
   * material, rock tiles in the seat's territory at placement, first sampled with none in reach or -1, rock tiles in
   * reach at its last sample, ended or -1]. "In reach" is what its worker can use: Feature.Rock with material left within the
   * quarry's radius. A quarry that starts with none was misplaced; one that ran out was used up.
   */
  quarries: number[][];
  /** Per rival per day: rock tiles with material left inside the seat's territory, and the material. Taken at the first snapshot of the window. */
  rockDay: number[][][];
  /** Per day per rival, running: why tiles were passed over in border tries that placed nothing (reason -> tiles, see `placeOn`). */
  borderWhy: Record<string, number>[][];
  /**
   * Resources and land use. Index 0 is the state when the probe was installed, index d + 1 the end of day d.
   * `mapDay[i]`: the whole map as RESOURCE_FIELDS. `resDay[i][rival]`: inside that rival's border, the same fields.
   * `landDay[i][rival]`: that rival's land tiles as LAND_FIELDS. Both have one row more than there are rivals: the last is
   * player 0, the steward seat, whose land and resources the map counts too.
   * `landTiles`: all the land on the map.
   */
  landTiles: number;
  resourceFields: string[];
  landFields: string[];
  mapDay: number[][];
  resDay: number[][][];
  landDay: number[][][];
  /** Item 6: [day, kind, a, b, x]. attack: attacker, defender, wardens asked for; capture: new owner, old owner, building type; fall: loser, victor; hurt: loser, winner (-1 if not a duel), 1 if mortal. */
  war: (number | string)[][];
  warDropped: number;
}

const WORKING = new Set(["out", "work", "back", "craft", "mining", "drop", "enter", "sail", "scan", "sailback"]);
const FOOD = goodsFor("food");
const HAMMER = goodId("hammer");
const PLANK = goodId("plank");
const STONE = goodId("stone");

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const grid = (rows: number, cols: number): number[][] => Array.from({ length: rows }, () => zeros(cols));
const sparse = (a: readonly number[]): number[] => {
  const out: number[] = [];
  a.forEach((v, i) => {
    if (v) out.push(i, v);
  });
  return out;
};
const bump = (m: Record<string, number>, k: string, by = 1): void => {
  m[k] = (m[k] ?? 0) + by;
};
const at = <T>(a: T[], i: number, make: () => T): T => {
  while (a.length <= i) a.push(make());
  return a[i] as T;
};

interface Day {
  produced: number[][];
  usedInput: number[][];
  usedBuild: number[][];
  usedFood: number[][];
  usedUpkeep: number[][];
  usedGear: number[][];
  usedMine: number[][];
  toolTaken: number[][];
  lost: number[][];
  births: number[];
  arrivals: number[];
  deaths: number[];
  meals: number[];
  foodBefore: number[];
  mealNeed: number[];
  mealPeople: number[];
}

/** The private economy methods the probe wraps. */
interface Hooks {
  produce(b: Building, type: number): void;
  consumeInputs(b: Building): boolean;
  feedMiner(b: Building): boolean;
  takeTool(owner: number, type: number): number;
  findJobTarget(b: Building, s: Settler): number;
  equip(s: Settler, b: Building): void;
  dailyLife(owner: number): void;
  weather(): void;
  destroyGood(g: Good): void;
  addPerson(owner: number, first: string, family: string, born: number, r: unknown): Person;
  farewell(p: Person): void;
  createBuilding(type: number, tile: number, flagId: number, owner: number): Building;
  capture(b: Building, owner: number): void;
  fall(loser: number, victor: number): void;
  hurt(s: Settler, how: string, captor?: number): void;
  resolveDuel(b: Building): void;
  cmdAttack(targetId: number, count: number, p: number, order?: "strongest" | "weakest"): CommandResult;
  hungry: boolean[];
}

export class Probe {
  private readonly eco: Economy;
  private readonly rivals: number;
  private readonly hooks: Hooks;
  private readonly goods = GOODS.length;
  private day = 0;
  private acc: Day;
  /** Per rival, today's snapshot sums of idle adults, workplaces and workplaces with no worker, and the snapshot count. */
  private labour: { idle: number; jobs: number; unfilled: number; n: number }[] = [];
  private duel: { def: number; att: number } | null = null;
  /** Building id -> [tick of its worker's last job search, 1 if it found a target]. */
  private readonly searched = new Map<number, [number, number]>();
  /** Quarry building id -> index into data.quarries. */
  private readonly quarryRows = new Map<number, number>();
  /** Building id -> index into data.buildings, plus the owner it was placed for. */
  private readonly rows = new Map<number, { row: number; owner: number }>();
  readonly data: ProbeData;

  /** `startTick` is the world's tick now (the economy's own tick stays 0 until its first step). */
  constructor(eco: Economy, rivals: number, startTick = eco.tick) {
    this.eco = eco;
    this.rivals = rivals;
    this.hooks = eco as unknown as Hooks;
    this.acc = this.newDay();
    this.data = {
      dayTicks: eco.dayTicks,
      startTick,
      samplesPerDay: SAMPLES_PER_DAY,
      bucketDays: BUCKET_DAYS,
      buildingIds: BUILDINGS.map((b) => b.id),
      produced: [],
      usedInput: [],
      usedBuild: [],
      usedFood: [],
      usedUpkeep: [],
      usedGear: [],
      toolTaken: [],
      tools: [],
      toolsStart: this.toolPool().map(sparse),
      usedMine: [],
      lost: [],
      producedBy: Array.from({ length: rivals }, () => ({})),
      cycles: Array.from({ length: rivals }, () => ({})),
      seatDayFields: [...SEAT_DAY_FIELDS],
      seatDay: [],
      buildings: [],
      buildingsDropped: 0,
      idle: [],
      search: [],
      sites: [],
      util: [],
      logistics: [],
      roads: [],
      quarries: [],
      rockDay: [],
      borderWhy: [],
      landTiles: 0,
      resourceFields: [...RESOURCE_FIELDS],
      landFields: [...LAND_FIELDS],
      mapDay: [],
      resDay: [],
      landDay: [],
      war: [],
      warDropped: 0,
    };
    this.install();
    this.surveyLand();
  }

  /** The resources on the map and inside each rival's border, and each rival's land by use: one entry in each of mapDay, resDay and landDay. */
  private surveyLand(): void {
    const land = this.eco.land;
    const n = land.territory.length;
    const rivals = this.rivals;
    const map = zeros(RESOURCE_FIELDS.length);
    const res = grid(rivals + 1, RESOURCE_FIELDS.length);
    const use = grid(rivals + 1, LAND_FIELDS.length);
    const first = this.data.mapDay.length === 0;
    for (let t = 0; t < n; t++) {
      if (first && land.isLand(t)) this.data.landTiles++;
      const f = land.feature[t] as number;
      const kind = land.deposit[t] as number;
      const stock = land.fish[t] as number;
      const owner = land.territory[t] as number;
      // Row of the owner: the rivals in order (player 1 is row 0), then player 0 last.
      const seat = owner === 1 ? rivals : owner - 2;
      const mine = owner >= 1 && owner - 1 <= rivals ? (res[seat] as number[]) : null;
      const add = (i: number, by: number): void => {
        (map[i] as number) += by;
        if (mine) (mine[i] as number) += by;
      };
      if (f === Feature.Rock && (land.amount[t] as number) > 0) {
        add(0, 1);
        add(1, land.amount[t] as number);
      } else if (f === Feature.Tree) {
        add(2, 1);
        if (fellable(land, t)) add(3, 1);
      }
      if (kind > 0) add(3 + kind, land.depositAmount[t] as number);
      if (stock > 0) add(8, stock);
      // Land use: only the rivals' own land tiles.
      if (!mine || !land.isLand(t)) continue;
      const row = use[seat] as number[];
      row[0]!++;
      const u = land.use[t];
      let cat: number;
      if (u === Use.Building) cat = 1;
      else if (u === Use.Road) cat = 2;
      else if (u === Use.Flag) cat = 3;
      else if (u === Use.Blocked) cat = 4;
      else if (f === Feature.Field) cat = 5;
      else if (f === Feature.Tree) cat = 6;
      else if (f === Feature.Rock) cat = 7;
      else if (f === Feature.Hedge || f === Feature.Giant || f === Feature.Vent || f === Feature.Spire || f === Feature.Glowcap || f === Feature.Ruin) cat = 8;
      else cat = land.slope(t) >= 2.2 ? 9 : 10;
      row[cat]!++;
    }
    this.data.mapDay.push(map);
    this.data.resDay.push(res);
    this.data.landDay.push(use);
  }

  private newDay(): Day {
    const g = this.goods;
    const r = this.rivals;
    return {
      produced: grid(r, g),
      usedInput: grid(r, g),
      usedBuild: grid(r, g),
      usedFood: grid(r, g),
      usedUpkeep: grid(r, g),
      usedGear: grid(r, g),
      usedMine: grid(r, g),
      toolTaken: grid(r, g),
      lost: grid(r, g),
      births: zeros(r),
      arrivals: zeros(r),
      deaths: zeros(r),
      meals: zeros(r),
      foodBefore: zeros(r),
      mealNeed: zeros(r),
      mealPeople: zeros(r),
    };
  }

  /** Rival index of a player, or -1 for the steward seat and anyone out of range. */
  private rival(owner: number): number {
    const r = owner - 1;
    return r >= 0 && r < this.rivals ? r : -1;
  }

  private now(): number {
    return Math.round((this.eco.tick / this.eco.dayTicks) * 100) / 100;
  }

  private war(kind: string, a: number, b: number, x: number): void {
    if (this.data.war.length >= MAX_WAR) this.data.warDropped++;
    else this.data.war.push([this.now(), kind, a, b, x]);
  }

  // ------------------------------------------------------------------ hooks

  private install(): void {
    const eco = this.eco;
    const h = this.hooks;

    const produce = h.produce.bind(eco);
    h.produce = (b, type) => {
      const r = this.rival(b.owner);
      if (r >= 0 && type >= 0) {
        (this.acc.produced[r] as number[])[type]!++;
        bump(this.data.producedBy[r] as Record<string, number>, b.def.id);
      }
      produce(b, type);
    };

    const consumeInputs = h.consumeInputs.bind(eco);
    h.consumeInputs = (b) => {
      const r = this.rival(b.owner);
      if (r < 0) return consumeInputs(b);
      const before = b.stock.slice();
      const ok = consumeInputs(b);
      if (ok) {
        this.diff(before, b.stock, this.acc.usedInput[r] as number[]);
        bump(this.data.cycles[r] as Record<string, number>, b.def.id);
      }
      return ok;
    };

    const feedMiner = h.feedMiner.bind(eco);
    h.feedMiner = (b) => {
      const r = this.rival(b.owner);
      if (r < 0) return feedMiner(b);
      const before = b.stock.slice();
      const ok = feedMiner(b);
      this.diff(before, b.stock, this.acc.usedMine[r] as number[]);
      return ok;
    };

    const takeTool = h.takeTool.bind(eco);
    h.takeTool = (owner, type) => {
      const got = takeTool(owner, type);
      const r = this.rival(owner);
      if (r >= 0 && got >= 0) ((GOODS[got]?.tool ? this.acc.toolTaken : this.acc.usedGear)[r] as number[])[got]!++;
      return got;
    };

    const findJobTarget = h.findJobTarget.bind(eco);
    h.findJobTarget = (b, s) => {
      const target = findJobTarget(b, s);
      if (this.rival(b.owner) >= 0) {
        const row = at<Record<string, number[]>>(this.data.search, Math.floor(this.day / BUCKET_DAYS), () => ({}));
        const n = (row[b.def.id] ??= [0, 0]);
        n[0]!++;
        if (target < 0) n[1]!++;
        this.searched.set(b.id, [eco.tick, target < 0 ? 0 : 1]);
      }
      return target;
    };

    const equip = h.equip.bind(eco);
    h.equip = (s, b) => {
      const r = this.rival(b.owner);
      if (r < 0) return equip(s, b);
      const before = b.stock.slice();
      equip(s, b);
      this.diff(before, b.stock, this.acc.usedGear[r] as number[]);
    };

    const dailyLife = h.dailyLife.bind(eco);
    h.dailyLife = (owner) => {
      const r = this.rival(owner);
      if (r < 0) return dailyLife(owner);
      const before = eco.storageTotals(owner);
      const people = eco.people.filter((p) => p.alive && p.owner === owner).length;
      this.acc.foodBefore[r]! += FOOD.reduce((n, g) => n + (before[g] as number), 0);
      this.acc.mealNeed[r]! += Math.ceil(people * 0.45);
      this.acc.mealPeople[r]! += people;
      dailyLife(owner);
      const after = eco.storageTotals(owner);
      for (const g of FOOD) {
        const eaten = (before[g] as number) - (after[g] as number);
        if (eaten > 0) {
          (this.acc.usedFood[r] as number[])[g]! += eaten;
          this.acc.meals[r]! += eaten;
        }
      }
    };

    const weather = h.weather.bind(eco);
    h.weather = () => {
      const before = this.upkeepStock();
      weather();
      const after = this.upkeepStock();
      for (let r = 0; r < this.rivals; r++)
        for (const g of [PLANK, STONE]) {
          const used = ((before[r] as number[])[g] as number) - ((after[r] as number[])[g] as number);
          if (used > 0) (this.acc.usedUpkeep[r] as number[])[g]! += used;
        }
    };

    const destroyGood = h.destroyGood.bind(eco);
    h.destroyGood = (g) => {
      if (g.alive) {
        const r = this.rival(eco.flags[g.flag]?.owner ?? -1);
        if (r >= 0) (this.acc.lost[r] as number[])[g.type]!++;
      }
      destroyGood(g);
    };

    const addPerson = h.addPerson.bind(eco);
    h.addPerson = (owner, first, family, born, r) => {
      const p = addPerson(owner, first, family, born, r);
      const seat = this.rival(owner);
      if (seat >= 0) {
        if (born >= eco.tick - 1) this.acc.births[seat]!++;
        else this.acc.arrivals[seat]!++;
      }
      return p;
    };

    const farewell = h.farewell.bind(eco);
    h.farewell = (p) => {
      const r = this.rival(p.owner);
      if (r >= 0) this.acc.deaths[r]!++;
      farewell(p);
    };

    const createBuilding = h.createBuilding.bind(eco);
    h.createBuilding = (type, tile, flagId, owner) => {
      const b = createBuilding(type, tile, flagId, owner);
      const r = this.rival(owner);
      if (r >= 0) {
        this.register(b, r, this.now(), -1);
        if (b.def.job === "quarry") this.logQuarry(b, r);
      }
      return b;
    };

    const capture = h.capture.bind(eco);
    h.capture = (b, owner) => {
      this.war("capture", owner, b.owner, b.type);
      capture(b, owner);
    };

    const fall = h.fall.bind(eco);
    h.fall = (loser, victor) => {
      this.war("fall", loser, victor, 0);
      fall(loser, victor);
    };

    const resolveDuel = h.resolveDuel.bind(eco);
    h.resolveDuel = (b) => {
      const d = b.duel;
      this.duel = d ? { def: b.owner, att: eco.settlers[d.attacker]?.owner ?? -1 } : null;
      try {
        resolveDuel(b);
      } finally {
        this.duel = null;
      }
    };

    const hurt = h.hurt.bind(eco);
    h.hurt = (s, how, captor) => {
      const winner = this.duel ? (s.owner === this.duel.def ? this.duel.att : this.duel.def) : -1;
      this.war("hurt", s.owner, winner, eco.stakes === "mortal" ? 1 : 0);
      hurt(s, how, captor);
    };

    const cmdAttack = h.cmdAttack.bind(eco);
    h.cmdAttack = (targetId, count, p, order) => {
      const target = eco.buildings[targetId];
      const res = cmdAttack(targetId, count, p, order);
      if (res.ok) this.war("attack", p, target?.owner ?? -1, count);
      return res;
    };
  }

  /** Add what a stock lost between two snapshots to a per-good counter. */
  private diff(before: readonly number[], after: readonly number[], into: number[]): void {
    for (let g = 0; g < this.goods; g++) {
      const d = (before[g] as number) - (after[g] as number);
      if (d > 0) into[g]! += d;
    }
  }

  /** Tool goods each rival owns: in its warehouses plus in the hands of its living workers. [rival][good] */
  private toolPool(): number[][] {
    const out = grid(this.rivals, this.goods);
    for (let r = 0; r < this.rivals; r++) {
      const totals = this.eco.storageTotals(r + 1);
      GOODS.forEach((g, i) => {
        if (g.tool) (out[r] as number[])[i] = totals[i] as number;
      });
    }
    for (const s of this.eco.settlers) {
      const r = this.rival(s.owner);
      if (s.alive && r >= 0 && s.tool >= 0 && GOODS[s.tool]?.tool) (out[r] as number[])[s.tool]!++;
    }
    return out;
  }

  /** Planks and stone held in every finished building, per rival (upkeep draws on these). */
  private upkeepStock(): number[][] {
    const out = grid(this.rivals, this.goods);
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built) continue;
      const r = this.rival(b.owner);
      if (r < 0) continue;
      (out[r] as number[])[PLANK]! += b.stock[PLANK] as number;
      (out[r] as number[])[STONE]! += b.stock[STONE] as number;
    }
    return out;
  }

  /** Rock tiles with material left within a quarry's reach, and their material. */
  private rockReach(b: Building): [number, number] {
    const land = this.eco.land;
    let tiles = 0;
    let amount = 0;
    for (const t of land.ring(b.tile, b.def.radius ?? 5)) {
      if (land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
        tiles++;
        amount += land.amount[t] as number;
      }
    }
    return [tiles, amount];
  }

  /** Rock tiles with material left inside a player's territory, and their material. */
  private rockTerritory(owner: number): [number, number] {
    const land = this.eco.land;
    let tiles = 0;
    let amount = 0;
    for (let t = 0; t < land.feature.length; t++) {
      if (land.territory[t] === owner + 1 && land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0) {
        tiles++;
        amount += land.amount[t] as number;
      }
    }
    return [tiles, amount];
  }

  private logQuarry(b: Building, rival: number): void {
    if (this.data.quarries.length >= MAX_QUARRIES) return;
    const [tiles, amount] = this.rockReach(b);
    this.quarryRows.set(b.id, this.data.quarries.length);
    this.data.quarries.push([rival, this.now(), tiles, amount, this.rockTerritory(b.owner)[0], -1, tiles, -1]);
  }

  /** Follow a quarry's reach: when it first had no rock left, and when the building went. */
  private trackQuarry(b: Building, row: number[]): void {
    if (!b.alive || b.owner !== (row[0] as number) + 1) {
      if (row[7] === -1) row[7] = this.now();
      return;
    }
    if (!b.built) return;
    const [tiles] = this.rockReach(b);
    row[6] = tiles;
    if (tiles === 0 && row[5] === -1) row[5] = this.now();
  }

  private register(b: Building, rival: number, placed: number, finished: number): void {
    if (this.data.buildings.length >= MAX_BUILDINGS) {
      this.data.buildingsDropped++;
      return;
    }
    this.rows.set(b.id, { row: this.data.buildings.length, owner: b.owner });
    this.data.buildings.push([b.type, rival, placed, finished, -1, 0]);
  }

  // ------------------------------------------------------------------ sampling

  beginDay(day: number): void {
    this.day = day;
    this.acc = this.newDay();
    this.labour = Array.from({ length: this.rivals }, () => ({ idle: 0, jobs: 0, unfilled: 0, n: 0 }));
  }

  /** A state snapshot, `slot` 1..SAMPLES_PER_DAY within the game day. */
  sample(slot: number): void {
    const eco = this.eco;
    const bucket = Math.floor(this.day / BUCKET_DAYS);
    const idle = at<Record<string, number>>(this.data.idle, bucket, () => ({}));
    const sites = at<Record<string, number>>(this.data.sites, bucket, () => ({}));
    const util = at<Record<string, number[]>>(this.data.util, bucket, () => ({}));
    const log = at(this.data.logistics, bucket, () => ({ samples: 0, flags: 0, goods: 0, fullFlags: 0, noDest: 0, age: zeros(AGE_BANDS_HOURS.length + 1), stuck: zeros(this.goods) }));
    const roads = at(this.data.roads, bucket, () => zeros(4));
    const hour = Math.max(1, eco.dayTicks / 24);
    const standing: boolean[] = [];
    const noHammer: boolean[] = [];
    const noPerson: boolean[] = [];
    const idleNow: number[] = [];
    const jobsNow = zeros(this.rivals);
    const unfilledNow = zeros(this.rivals);
    for (let r = 0; r < this.rivals; r++) {
      standing[r] = !eco.defeated[r + 1];
      noHammer[r] = !eco.hasTool(r + 1, HAMMER);
      idleNow[r] = eco.population(r + 1).idle;
      noPerson[r] = idleNow[r] === 0;
    }

    for (const b of eco.buildings) {
      if (!b.alive) continue;
      const r = this.rival(b.owner);
      const info = this.rows.get(b.id);
      if (info) this.track(b, info);
      else if (r >= 0 && b.built) this.register(b, r, 0, 0);
      if (r < 0 || !standing[r]) continue;
      if (!b.built) {
        bump(sites, `${b.def.id}|${this.classifySite(b, noHammer[r] as boolean, noPerson[r] as boolean)}`);
      } else if (b.def.job && !b.def.storage) {
        bump(idle, `${b.def.id}|${this.classify(b)}`);
        jobsNow[r]!++;
        if (b.worker < 0 && !b.exhausted && b.stranded < 0) unfilledNow[r]!++;
        if (slot === 1 && this.day >= 1 && b.busyPrev >= 0) {
          const u = (util[b.def.id] ??= [0, 0]);
          u[0]! += b.busyPrev / eco.dayTicks;
          u[1]! += 1;
        }
      }
    }

    for (const [id, row] of this.quarryRows) {
      const b = eco.buildings[id];
      if (b) this.trackQuarry(b, this.data.quarries[row] as number[]);
    }
    if (slot === 1) {
      const rock: number[][] = [];
      for (let r = 0; r < this.rivals; r++) rock.push(standing[r] ? this.rockTerritory(r + 1) : [0, 0]);
      this.data.rockDay[this.day] = rock;
    }

    for (const f of eco.flags) {
      if (!f.alive) continue;
      const r = this.rival(f.owner);
      if (r < 0 || !standing[r]) continue;
      log.flags++;
      if (f.goods.length + f.reserved >= FLAG_CAPACITY) log.fullFlags++;
      for (const id of f.goods) {
        const g = eco.goods[id];
        if (!g || !g.alive) continue;
        log.goods++;
        if (g.dest < 0) log.noDest++;
        const age = (eco.tick - g.since) / hour;
        let band = 0;
        while (band < AGE_BANDS_HOURS.length && age >= (AGE_BANDS_HOURS[band] as number)) band++;
        log.age[band]!++;
        if (age >= STUCK_HOURS) log.stuck[g.type]!++;
      }
    }
    for (let r = 0; r < this.rivals; r++) {
      if (!standing[r]) continue;
      log.samples++;
      const l = this.labour[r] as { idle: number; jobs: number; unfilled: number; n: number };
      l.idle += idleNow[r] as number;
      l.jobs += jobsNow[r] as number;
      l.unfilled += unfilledNow[r] as number;
      l.n++;
    }

    if (slot === 1 && this.day >= 1) {
      for (const road of eco.roads) {
        if (!road.alive || road.busyPrev < 0) continue;
        const r = this.rival(road.owner);
        if (r < 0 || !standing[r]) continue;
        roads[Math.min(3, Math.floor((road.busyPrev / eco.dayTicks) * 4))]!++;
      }
    }
  }

  /** Follow a building a rival placed: when it was finished, and when it was lost. */
  private track(b: Building, info: { row: number; owner: number }): void {
    const row = this.data.buildings[info.row] as number[];
    if (b.owner !== info.owner) {
      if (row[4] === -1) {
        row[4] = this.now();
        row[5] = 2;
      }
      return;
    }
    if (b.built && row[3] === -1) {
      row[3] = this.now();
      const r = row[1] as number;
      const cost = goodsArray(b.def.cost);
      for (let g = 0; g < this.goods; g++) (this.acc.usedBuild[r] as number[])[g]! += cost[g] as number;
    }
  }

  private classify(b: Building): string {
    const eco = this.eco;
    if (b.stranded >= 0) return "stranded";
    if (b.exhausted) return "exhausted";
    if (b.worker < 0) return b.def.tool && !eco.hasTool(b.owner, goodId(b.def.tool)) ? "no_tool" : "no_worker";
    const s = eco.settlers[b.worker];
    if (s && WORKING.has(s.state)) return "working";
    // A gatherer whose search came up empty rests 60 ticks and tries again; one whose target had no walkable route does the same.
    const last = this.searched.get(b.id);
    if (s?.state === "rest" && last && s.timer === 60 - (eco.tick - last[0])) return last[1] ? "no_path" : "no_target";
    if (b.def.inputs && b.food <= 0) {
      const missing = Object.keys(b.def.inputs).filter((k) => goodsFor(k).every((g) => (b.stock[g] as number) === 0));
      if (missing.length) return `input:${missing.join("+")}`;
    }
    const flag = eco.flags[b.flag];
    if (b.output > 0 && flag && flag.goods.length + flag.reserved >= FLAG_CAPACITY) return "output_blocked";
    return `other:${s?.state ?? "none"}`;
  }

  private classifySite(b: Building, noHammer: boolean, noPerson: boolean): string {
    if (b.dig > 0) return "dig";
    const onSite = b.delivered.reduce((a, v) => a + v, 0) - b.consumed;
    if (onSite > 0) return b.builder >= 0 ? "building" : `no_builder:${noHammer ? "no_hammer" : noPerson ? "no_person" : "no_route"}`;
    let want = -1;
    let most = 0;
    for (let g = 0; g < this.goods; g++) {
      const left = (b.cost[g] as number) - (b.delivered[g] as number);
      if (left > most) {
        most = left;
        want = g;
      }
    }
    if (want < 0) return "finishing";
    return `${(b.pending[want] as number) > 0 ? "wait_transit" : "wait_none"}:${(GOODS[want] as { id: string }).id}`;
  }

  /** Close the day: per-rival counters and the day's tallies are stored. */
  endDay(): void {
    const eco = this.eco;
    const d = this.data;
    const a = this.acc;
    d.produced.push(a.produced.map(sparse));
    d.usedInput.push(a.usedInput.map(sparse));
    d.usedBuild.push(a.usedBuild.map(sparse));
    d.usedFood.push(a.usedFood.map(sparse));
    d.usedUpkeep.push(a.usedUpkeep.map(sparse));
    d.usedGear.push(a.usedGear.map(sparse));
    d.usedMine.push(a.usedMine.map(sparse));
    d.toolTaken.push(a.toolTaken.map(sparse));
    d.tools.push(this.toolPool().map(sparse));
    d.lost.push(a.lost.map(sparse));
    const stage = grid(this.rivals, 3);
    for (const p of eco.people) {
      const r = this.rival(p.owner);
      if (!p.alive || r < 0) continue;
      stage[r]![p.stage === "child" ? 0 : p.stage === "elder" ? 2 : 1]!++;
    }
    const row: number[][] = [];
    for (let r = 0; r < this.rivals; r++) {
      const owner = r + 1;
      const standing = !eco.defeated[owner];
      let lit = 0;
      for (const b of eco.buildings) if (b.alive && b.built && b.owner === owner && b.lit) lit++;
      const l = this.labour[r] as { idle: number; jobs: number; unfilled: number; n: number };
      const mean = (sum: number): number => (l.n ? Math.round((sum / l.n) * 10) / 10 : 0);
      let wardens = 0;
      let attackers = 0;
      for (const s of eco.settlers) {
        if (!s.alive || s.owner !== owner) continue;
        if (s.role === "warden") wardens++;
        else if (s.role === "attacker") attackers++;
      }
      const totals = eco.storageTotals(owner);
      const food = FOOD.reduce((n, g) => n + (totals[g] as number), 0);
      const land = eco.land;
      let territory = 0;
      for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === owner + 1 && land.isLand(t)) territory++;
      // frontierTiles only reads the world's land.
      const frontier = standing ? frontierTiles({ land } as unknown as World, owner).length : 0;
      const ai = aiStats[owner] ?? [];
      const k = stage[r] as number[];
      row.push([
        standing ? 1 : 0,
        k[0] as number,
        k[1] as number,
        k[2] as number,
        eco.capacity(owner),
        mean(l.idle),
        mean(l.jobs),
        mean(l.unfilled),
        this.hooks.hungry[owner] ? 1 : 0,
        Math.round(food),
        a.births[r] as number,
        a.arrivals[r] as number,
        a.deaths[r] as number,
        a.meals[r] as number,
        wardens,
        attackers,
        lit,
        Math.round(eco.resolve(owner) * 100),
        Math.round(eco.warMorale(owner) * 100),
        a.foodBefore[r] as number,
        a.mealNeed[r] as number,
        a.mealPeople[r] as number,
        territory,
        frontier,
        ...Array.from({ length: 11 }, (_, i) => ai[i] ?? 0),
      ]);
    }
    d.seatDay.push(row);
    d.borderWhy.push(Array.from({ length: this.rivals }, (_, r) => ({ ...(aiWhy[r + 1] ?? {}) })));
    this.surveyLand();
  }
}
