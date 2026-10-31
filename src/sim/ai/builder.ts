import { BUILDINGS, buildingType, GOODS, TOOLS } from "../econ/defs";
import { Feature } from "../econ/landuse";
import { clearForBorder, clearForest, connectKeepFlag, flagSides, frontierTiles, landmassOf, placeConnected, placeOn, rejoinCutOff } from "../econ/planner";
import { goodId, goodsFor } from "../econ/defs";
import type { Rng } from "../rng";
import type { World } from "../world";
import type { TreatyKind } from "../econ/diplomacy";
import { AI_LEVELS, baselineTuning, temperAllows, type AiLevel, type Personality, type Tuning } from "./personality";
import type { AiContext, Brain } from "./brain";
import type { WorldCommand } from "../world";
import { BiomePlanner } from "./biome";
import { diagnoseBorder } from "./borderwhy";
import { EconPlanner } from "./economy";
import { SeaPlanner } from "./sea";
import { TerraPlanner } from "./terra";
import { cargoTools, spareTools, VoyagePlanner } from "./voyage";
import { WarPlanner } from "./war";
import { WorksPlanner } from "./works";
import { aiOptions } from "./options";

const LANTERNS = new Set(BUILDINGS.filter((b) => b.slots).map((b) => b.id));

export { aiOptions };
/** With `toolsByDemand`: tools of which one is kept in the stores even when no building waits for it. */
const SPARE_TOOLS = new Set(["hammer", "axe", "pick", "scythe", "rod"]);
/**
 * Counts per player for the balance probe, which reads them (they change no decision): thoughts that got past the
 * pace check, thoughts that stopped at the sites cap, thoughts with no idle hands, thoughts where the border was
 * wanted, border tries, tries with no frontier tile, lanterns placed, tries that chose a beacon, tries that chose a lamp
 * house, tries with frontier tiles that placed nothing, woodcutters built to clear the way (`borderClear`).
 */
export const aiStats: number[][] = [];
/**
 * A read-only record of the wants each thought listed, rested, failed and placed, kept only while `aiTrace.on` (a harness sets it;
 * see soak/balance/stallwhy.ts). It changes no decision.
 */
export interface TraceRow {
  pl: number;
  tick: number;
  stage: string;
  listed: string;
  rested: string;
  failed: string;
  placed: string;
  tries: number;
}
export const aiTrace: TraceRow[] & { on?: boolean } = [];
/** Per player, running: what stood in the way in a sample of the border tries that placed nothing (see `diagnoseBorder`). */
export const aiWhy: Record<string, number>[] = [];
const tally = (player: number, i: number): void => {
  const row = (aiStats[player] ??= Array.from({ length: 11 }, () => 0));
  row[i] = (row[i] as number) + 1;
};
/** With `woodByNeed`: planks (and logs) in the stores under which wood is short, finished buildings from which it is looked at, thoughts between two orders, and one woodcutter more for every this many finished buildings. */
const WOOD_SHORT = 4;
const WOOD_FROM = 12;
const WOOD_GAP = 30;
const WOOD_PER_BUILT = 12;
/** With `keepRoads`: the roads a keep flag should have, the buildings a seat needs before it is looked at, and thoughts between two tries. */
const KEEP_ROADS = 3;
const KEEP_ROADS_FROM = 8;
const KEEP_ROADS_EVERY = 4;
/** With `rejoinRoads`: thoughts between two looks for buildings cut off from the Hearthship's roads. */
const REJOIN_EVERY = 4;
/** With `borderCandidates`: frontier tiles looked at for a lantern, and the ones that fit that are tried. */
const BORDER_SCAN = 400;
const BORDER_TRY = 40;
/** With `borderReach`: free tiles of the Hearthship's land a frontier tile must have within 5 steps. */
const BORDER_FREE = 6;
/** With `borderClear`: woodcutters built to clear the way for the border, and thoughts (about a day: 7500 ticks / 120) between two. */
const BORDER_CUTS = 3;
const BORDER_CUT_GAP = 60;
/** Wants that `stonePriority` drops while stone is short. */
const STONE_HUNGRY = new Set(["well", "flowerbed", "bench", "sea", "works", "biome", "terra", "weaponsmith"]);
/** Stone in the warehouses under which it counts as short. */
const STONE_SHORT = 6;
/** Room for this many more people than there are counts as housed. */
const ROOM_SPARE = 6;
/** Food in the warehouses, as a multiple of a day's need (0.45 a head), averaged over about a third of a day: under this the seat is short. */
const FOOD_SHORT = 1;
const FOOD_SMOOTH = 0.03;
/** Buildings that make food; one unfinished among them holds back the next. */
const FOOD_BUILDINGS = new Set(["fisher", "hunter", "orchard", "farm", "mill", "bakery", "apiary", "pasture", "butcher"]);
const FOODS = goodsFor("food");
/** The rock inside the border counts as nearly used up below this much material (about five days of quarrying). */
const ROCK_LOW = 15;
/** How far from the settlement's centre a quarry is looked for: normally 14 tiles, 22 with `relocateQuarries`. */
const QUARRY_FAR = 22;
/** Looks at a quarry that found no rock in reach, in a row, before it is pulled down. */
const QUARRY_DEAD_LOOKS = 3;
/** With `releaseStalled`: days a site may go with no material delivered or used before a seat at its cap pulls it down, and days that kind then waits. */
/** With `toolsmithAnyway`: stone in the stores that lets a seat without a standing quarry build its toolsmith (it costs 2). */
const TOOLSMITH_STONE = 4;
const STALL_DAYS = 4;
const SHUN_DAYS = 3;

/**
 * AI rival, version 1: grows a settlement much like a careful player would. It keeps a small
 * number of construction sites going, builds the material and food chains, houses its people and
 * pushes its border outward with lanterns. It only issues ordinary commands, and runs inside the
 * simulation step, so every peer computes the same moves.
 */
export class AiBuilder implements Brain {
  /** Ticks between decisions. */
  static readonly PERIOD = 120;
  readonly period = AiBuilder.PERIOD;

  constructor(
    readonly player: number,
    private readonly rng: Rng,
    readonly personality: Personality = "builder",
    readonly level: AiLevel = "normal",
    private readonly tuning: Tuning = baselineTuning(personality, level),
  ) {
    this.sea = new SeaPlanner(player, personality, tuning.seaReady);
    this.econ = new EconPlanner(player, personality);
    this.war = new WarPlanner(player, personality, level);
    this.works = new WorksPlanner(player, personality);
    this.terra = new TerraPlanner(player);
    this.biome = new BiomePlanner(player);
    this.voyage = new VoyagePlanner(player);
  }

  private readonly sea: SeaPlanner;
  private readonly econ: EconPlanner;
  private readonly war: WarPlanner;
  private readonly works: WorksPlanner;
  private readonly terra: TerraPlanner;
  private readonly biome: BiomePlanner;
  private readonly voyage: VoyagePlanner;
  private started = false;
  /** Foresters taken down in a row without the way opening. */
  private cuts = 0;
  private thoughts = 0;
  /** With `woodByNeed`: the thought a woodcutter or forester was last ordered for want of wood. */
  private woodAt = -WOOD_GAP;
  /** Wishes that found no site lately, and the thought they may be tried again. */
  private readonly resting = new Map<string, number>();
  /** With `releaseStalled`: per unfinished site, the goods delivered and used so far and the tick that changed. */
  private readonly progress = new Map<number, { sum: number; since: number }>();
  /** With `releaseStalled`: kinds of building not placed again before this tick. */
  private readonly shun = new Map<string, number>();

  /**
   * With `releaseStalled`: the site that has made no progress for longest (at least STALL_DAYS), pulled down so the cap opens.
   * Called while the seat is at its cap; `watchSites` keeps the clock on every thought.
   */
  private releaseStalled(w: World, sites: readonly { id: number; tile: number; def: { id: string } }[]): boolean {
    const eco = w.economy;
    let worst: { id: number; tile: number; def: { id: string } } | null = null;
    let since = w.tick - STALL_DAYS * eco.dayTicks;
    for (const b of sites) {
      const p = this.progress.get(b.id);
      if (p && p.since <= since) {
        worst = b;
        since = p.since;
      }
    }
    if (!worst || !w.command({ t: "demolish", tile: worst.tile, player: this.player }).ok) return false;
    this.shun.set(worst.def.id, w.tick + SHUN_DAYS * eco.dayTicks);
    this.progress.delete(worst.id);
    return true;
  }

  /** With `releaseStalled`: note which unfinished sites received or used material since the last look. */
  private watchSites(w: World, sites: readonly { id: number; delivered: number[]; consumed: number }[]): void {
    const live = new Set<number>();
    for (const b of sites) {
      live.add(b.id);
      const sum = b.delivered.reduce((a, n) => a + n, 0) + b.consumed;
      const p = this.progress.get(b.id);
      if (!p || p.sum !== sum) this.progress.set(b.id, { sum, since: w.tick });
    }
    for (const id of [...this.progress.keys()]) if (!live.has(id)) this.progress.delete(id);
  }

  /**
   * Attack the enemy lantern or Hearthship it can take with good odds, using as few wardens as
   * it can. As in Settlers 2's AI, an undefended target comes first, then the weakest garrison,
   * then the surest odds.
   */
  private attack(w: World): boolean {
    const eco = w.economy;
    const pl = this.player;
    if (w.tick < eco.peaceUntil) return false;
    const targets = eco.buildings.filter((b) => b.alive && b.built && b.owner !== pl && b.def.light && !eco.defeated[b.owner] && !eco.attackBlocked(pl, b));
    let best: { t: (typeof targets)[number]; count: number; held: number; odds: number } | null = null;
    for (const t of targets) {
      const pool = eco.attackersFor(pl, t).length;
      if (pool < 2) continue;
      for (let n = 2; n <= pool; n++) {
        const odds = eco.attackOdds(pl, t, n);
        if (odds < this.tuning.attackOdds) continue;
        const held = eco.defendersOf(t).length;
        if (!best || held < best.held || (held === best.held && odds > best.odds)) best = { t, count: Math.min(pool, n + 1), held, odds };
        break;
      }
    }
    return best ? w.command({ t: "attack", target: best.t.id, count: best.count, player: pl }).ok : false;
  }

  /** Tools in demand for the buildings it has or is building, and their stock: set the toolsmith's priorities to match. */
  /** A Hearthship tool was short at the last look at the tools (see `tools`). */
  private cargoShort = false;
  private tools(w: World): void {
    const eco = w.economy;
    const pl = this.player;
    const stock = eco.storageTotals(pl);
    const need = new Map<string, number>();
    for (const b of eco.buildings) if (b.alive && b.owner === pl && b.def.tool && (!b.built || b.worker < 0)) need.set(b.def.tool, (need.get(b.def.tool) ?? 0) + 1);
    // A seat with a launch rail wants the Hearthship's tools in the stores too: the voyage planner orders the ship only when its
    // cargo is there, and with `toolsByDemand` nobody else waits for a shovel or a saw, so none was ever made (#184).
    // Those tools in a toolsmith's tray or on the roads count as had: they reach the stores hours after they are made, and until the
    // first one did the toolsmith kept making them (6 shovels and 4 saws where the cargo takes one of each). While one is short this
    // runs every thought, not every fourth: the toolsmith makes one in less time, and 3 shovels came of the gap.
    const afoot = new Map<number, number>();
    this.cargoShort = false;
    const cargo = cargoTools(w, pl);
    if (cargo.size) {
      for (const [t, n] of cargo) {
        const id = GOODS[t]?.id ?? "";
        need.set(id, (need.get(id) ?? 0) + n);
        afoot.set(t, 0);
      }
      const count = (t: number): void => void (afoot.has(t) && afoot.set(t, (afoot.get(t) ?? 0) + 1));
      for (const b of eco.buildings) if (b.alive && b.owner === pl && b.def.produces === "tool") for (const t of b.outputTypes) count(t);
      for (const g of eco.goods) if (g.alive && eco.flags[g.flag]?.owner === pl) count(g.type);
      for (const s of eco.settlers) if (s.alive && s.owner === pl && s.carrying >= 0) count(s.carrying);
    }
    const prefs = eco.prefs[pl];
    if (!prefs) return;
    for (const t of TOOLS) {
      const id = GOODS[t]?.id ?? "";
      const have = (stock[t] ?? 0) + (afoot.get(t) ?? 0);
      const wanted = need.get(id) ?? 0;
      if (afoot.has(t) && wanted > have) this.cargoShort = true;
      // Short of a tool somebody is waiting for: make it first. Out of a basic tool: keep one in hand.
      let value = wanted > have ? 1 : have < 1 ? 0.4 : 0.1;
      // With `toolsByDemand`, iron goes only to tools that someone waits for, plus one spare of the tools that man the food,
      // wood, stone and building trades; the toolsmith otherwise tops every kind up to the same stock.
      if (aiOptions.toolsByDemand && wanted <= have) value = SPARE_TOOLS.has(id) && have < 1 ? 0.4 : 0;
      if (Math.abs((prefs.tools[id] ?? 0) - value) > 0.05) w.command({ t: "toolprio", tool: id, value, player: pl });
    }
  }

  /** Flags and roads that lead nowhere, and sites no road reaches: given a while, then cleared away. */
  private readonly strays = new Map<string, number>();
  private tidy(w: World): void {
    const eco = w.economy;
    const pl = this.player;
    const keep = eco.buildings[eco.keeps[pl] ?? -1];
    if (!keep) return;
    const seen = new Set<string>();
    const stale = (key: string) => {
      seen.add(key);
      const n = (this.strays.get(key) ?? 0) + 1;
      this.strays.set(key, n);
      return n >= 3;
    };
    for (const f of eco.flags) {
      if (!f.alive || f.owner !== pl || f.building >= 0) continue;
      const roads = f.roads.filter((r) => (eco.roads[r] as { alive: boolean }).alive);
      if (roads.length === 1 && stale(`flag${f.id}`)) w.command({ t: "demolish", tile: f.tile, player: pl });
    }
    for (const b of eco.buildings) {
      if (!b.alive || b.owner !== pl || b.built || b.def.storage) continue;
      if (eco.route(keep.flag, b.flag).dist === Infinity && stale(`site${b.id}`)) w.command({ t: "demolish", tile: b.tile, player: pl });
    }
    for (const k of [...this.strays.keys()]) if (!seen.has(k)) this.strays.delete(k);
  }

  /** Food in the warehouses over a day's need, smoothed. Only kept with `foodByNeed`. */
  private foodCover = 2;
  private trackFood(stock: readonly number[], people: number): void {
    const have = FOODS.reduce((n, g) => n + (stock[g] ?? 0), 0);
    this.foodCover += ((have / Math.max(1, Math.ceil(people * 0.45))) - this.foodCover) * FOOD_SMOOTH;
  }

  /** `rockLow`: the thought it was last worked out at, and the answer. */
  private rockAt = -99;
  private rockIsLow = false;
  private expansions = 0;
  /** Is the rock with material left inside the border nearly used up? Only with `stoneFallback`; looked at every sixth thought. */
  private rockLow(w: World): boolean {
    if (!aiOptions.stoneFallback) return false;
    if (this.thoughts - this.rockAt < 6) return this.rockIsLow;
    const land = w.economy.land;
    let material = 0;
    for (let t = 0; t < land.territory.length; t++) {
      if (land.territory[t] === this.player + 1 && land.feature[t] === Feature.Rock) material += land.amount[t] as number;
    }
    this.rockAt = this.thoughts;
    this.rockIsLow = material < ROCK_LOW;
    return this.rockIsLow;
  }

  /** `homeLand`: the thought it was last worked out at, and the answer. */
  private homeAt = -99;
  private home = new Set<number>();
  /** The tiles the Hearthship's land reaches (by land or bridge), looked at again every sixth thought. */
  private homeLand(w: World): Set<number> {
    if (this.thoughts - this.homeAt < 6) return this.home;
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[this.player] ?? -1];
    this.home = keep ? landmassOf(w, keep.tile) : new Set<number>();
    this.homeAt = this.thoughts;
    return this.home;
  }

  /** Frontier tiles that a road can reach and that have free land of the Hearthship's land beside them (`borderReach`). */
  private reachable(w: World, tiles: number[]): number[] {
    const land = w.economy.land;
    const home = this.homeLand(w);
    return tiles.filter((t) => home.has(t) && land.ring(t, 5).filter((n) => land.territory[n] === 0 && home.has(n)).length >= BORDER_FREE);
  }

  /** Frontier tiles for a lantern, those nearest rock outside every border first. */
  private towardRock(w: World, tiles: number[]): number[] {
    const land = w.economy.land;
    const c = land.planet.grid.center;
    const rocks: number[] = [];
    for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === 0 && land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0 && land.isLand(t)) rocks.push(t);
    if (!rocks.length) return tiles;
    const d2 = (a: number, b: number) => ((c[a * 3] as number) - (c[b * 3] as number)) ** 2 + ((c[a * 3 + 1] as number) - (c[b * 3 + 1] as number)) ** 2 + ((c[a * 3 + 2] as number) - (c[b * 3 + 2] as number)) ** 2;
    return tiles
      .map((t) => [Math.min(...rocks.map((r) => d2(t, r))), t] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, t]) => t);
  }

  /** Quarries seen with no rock left in reach, by building id, and how many looks in a row. */
  private readonly dry = new Map<number, number>();
  /**
   * A quarry only cuts `Feature.Rock` with material left within its radius, and rock does not grow back, so one
   * that finds none stands idle for good and holds a worker and a tool. After a few looks in a row it is pulled
   * down, so the quarry wishes can place a new one where rock is left. Returns the ids pulled down.
   */
  private retireQuarries(w: World, mine: readonly { id: number; tile: number; built: boolean; def: { id: string; radius?: number } }[]): Set<number> {
    const land = w.economy.land;
    const gone = new Set<number>();
    const seen = new Set<number>();
    for (const b of mine) {
      if (b.def.id !== "quarry" || !b.built) continue;
      seen.add(b.id);
      const reach = land.ring(b.tile, b.def.radius ?? 5).some((t) => land.feature[t] === Feature.Rock && (land.amount[t] as number) > 0);
      if (reach) {
        this.dry.delete(b.id);
        continue;
      }
      const looks = (this.dry.get(b.id) ?? 0) + 1;
      this.dry.set(b.id, looks);
      if (looks >= QUARRY_DEAD_LOOKS && w.command({ t: "demolish", tile: b.tile, player: this.player }).ok) gone.add(b.id);
    }
    for (const id of [...this.dry.keys()]) if (!seen.has(id) || gone.has(id)) this.dry.delete(id);
    return gone;
  }

  /** The armed-wardens rule, as seen at the last thought (it is fixed for a match). */
  private armed = false;

  allows(cmd: WorldCommand): boolean {
    return temperAllows(this.personality, cmd as { t: string; type?: string }, this.armed);
  }

  think(ctx: AiContext): void {
    const w = ctx.world;
    this.armed = w.economy.armedWardens;
    const eco = w.economy;
    const pl = this.player;
    if (!this.started) {
      // Lighter garrisons than a cautious player: this rival would rather grow.
      this.started = true;
      // Wardens hold the border in full and the interior thin, as Settlers 2's AI does; the others keep lighter garrisons.
      const { frontier, inland } = this.tuning;
      w.command({ t: "garrison", zone: "frontier", value: frontier, player: pl });
      w.command({ t: "garrison", zone: "near", value: (frontier + inland) / 2, player: pl });
      w.command({ t: "garrison", zone: "inland", value: inland, player: pl });
    }
    const lv = AI_LEVELS[this.level];
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const sites = mine.filter((b) => !b.built).length;
    const stock = eco.storageTotals(pl);
    const plank = stock[goodId("plank")] ?? 0;
    const stone = stock[goodId("stone")] ?? 0;
    const log = stock[goodId("log")] ?? 0;
    this.thoughts++;
    if (this.thoughts % lv.every !== 0) return;
    tally(pl, 0);
    if (this.thoughts % 6 === 3) this.talk(w);
    if (this.thoughts % 4 === 1 || this.cargoShort) this.tools(w);
    if (this.thoughts % 10 === 5) this.tidy(w);
    if (aiOptions.keepRoads && this.thoughts % KEEP_ROADS_EVERY === 2 && mine.length >= KEEP_ROADS_FROM) connectKeepFlag(w, pl, KEEP_ROADS, w.land.lattice ? 12 : 6);
    if (aiOptions.rejoinRoads && this.thoughts % REJOIN_EVERY === 0) rejoinCutOff(w, pl, this.rejoinSkip, eco.dayTicks);
    if (aiOptions.foodByNeed) this.trackFood(stock, eco.peopleOf(pl).length);
    const retired = aiOptions.relocateQuarries ? this.retireQuarries(w, mine) : new Set<number>();
    if (this.thoughts % 3 === 2) this.econ.settings(ctx, this.thoughts);
    // Wardens look for a fight often, Traders seldom, Builders hardly ever.
    const temper = Math.max(1, Math.round(this.tuning.temper));
    if (this.thoughts % temper === 0 && this.attack(w)) return;
    // Palisades, field camps, outriders and breaking truces.
    if (this.thoughts % 5 === 3 && this.war.step(ctx, this.thoughts)) return;
    // Stone gone: geologists and granite mines, which cannot wait behind sites that are waiting for stone.
    if (this.thoughts % 3 === 1 && this.econ.relieveStone(ctx, this.thoughts, this.rockLow(w))) return;
    // Voyages (for a seat the rules let fly) are orders, not sites, so they do not wait for the builders.
    if (this.thoughts % 5 === 4 && VoyagePlanner.allowed(ctx) && mine.filter((b) => b.built).length >= 25 && this.voyage.step(ctx, this.thoughts)) return;
    const unfinished = aiOptions.releaseStalled ? mine.filter((b) => !b.built) : [];
    if (aiOptions.releaseStalled) this.watchSites(w, unfinished);
    if (sites >= Math.round(this.tuning.sites) || (sites >= 1 && plank < 2)) {
      // Sites waiting for planks hold the builder here, and it is the wood that is short: the one order that may go past the cap.
      const woodNow = this.woodOrder(w, mine, stock);
      if (woodNow && woodNow()) return;
      if (aiTrace.on) aiTrace.push({ pl, tick: w.tick, stage: sites >= Math.round(this.tuning.sites) ? "cap" : "noplank", listed: "", rested: "", failed: "", placed: "", tries: 0 });
      tally(pl, 1);
      if (aiOptions.releaseStalled) this.releaseStalled(w, unfinished);
      return;
    }
    // Keep enough hands free: when nobody is idle, build homes before anything else.
    const idle = eco.population(pl).idle;
    const count = (id: string) => mine.filter((b) => b.def.id === id && !retired.has(b.id)).length;
    const lanterns = mine.filter((b) => LANTERNS.has(b.def.id)).length;
    const people = eco.peopleOf(pl).length;
    const wants: { key: string; fn: () => boolean }[] = [];
    const want = (cond: boolean, w: { key: string; fn: () => boolean }) => {
      if (cond) wants.push(w);
    };
    const near = (type: string, feature?: Feature, max = 9) => ({ key: type, fn: () => placeConnected(w, type, { minDist: 2, maxDist: feature === Feature.Rock ? Math.max(max, aiOptions.relocateQuarries ? QUARRY_FAR : 14) : max, near: feature, need: feature === Feature.Rock ? 2 : 0, player: pl, center: this.center(w), splitRoads: true }) });
    const grow = () => ({ key: "expand", fn: () => this.expand(w, plank, stone) });
    // Try the wishes in order; one that finds no site steps aside for a while, so a cramped spot
    // (no room for a sawmill, say) never stops everything after it, such as pushing the border out.
    let stage = "wants";
    const attempt = (list: typeof wants, tries: number) => {
      const rec: TraceRow | null = aiTrace.on ? { pl, tick: w.tick, stage, listed: list.map((x) => x.key).join(","), rested: "", failed: "", placed: "", tries } : null;
      if (rec) aiTrace.push(rec);
      for (const x of list) {
        if ((this.resting.get(x.key) ?? 0) > this.thoughts || (this.shun.get(x.key) ?? 0) > w.tick) {
          if (rec) rec.rested += (rec.rested ? "," : "") + x.key;
          continue;
        }
        if (x.fn()) {
          if (rec) rec.placed = x.key;
          return true;
        }
        if (rec) rec.failed += (rec.failed ? "," : "") + x.key;
        this.resting.set(x.key, this.thoughts + 6);
        if (--tries <= 0) return false;
      }
      return false;
    };
    const housed = aiOptions.stonePriority && eco.capacity(pl) >= people + ROOM_SPARE;
    const triage = (list: typeof wants) => (aiOptions.stonePriority && stone < STONE_SHORT ? list.filter((x) => !STONE_HUNGRY.has(x.key)) : list);
    want(!housed && idle < 2 && plank >= 4 && count("house") < 2 + Math.floor(people / 6), near("house"));
    // Short of food past the opening quotas: one more food building at a time, in the order cheapest first, each type capped by the population.
    const foodShort = aiOptions.foodByNeed && this.foodCover < FOOD_SHORT && mine.filter((b) => b.built).length >= 12 && !mine.some((b) => !b.built && FOOD_BUILDINGS.has(b.def.id));
    const foodWishes = () => {
      want(count("fisher") < 1 + Math.floor(people / 40), near("fisher", undefined, 11));
      want(count("hunter") < 1 + Math.floor(people / 40), near("hunter", Feature.Tree, 10));
      want(count("orchard") < 1 + Math.floor(people / 30), near("orchard"));
      want(count("farm") < 2 + Math.floor(people / 20), near("farm"));
      want(count("mill") < Math.ceil(count("farm") / 3) && count("farm") > 0, near("mill"));
      want(count("bakery") < Math.ceil(count("farm") / 3) && count("mill") > 0, near("bakery"));
    };
    if (idle < 1) {
      tally(pl, 2);
      stage = "noidle";
      // `foodWithoutIdle`: hungry people are not waited on for idle hands.
      if (aiOptions.foodWithoutIdle && foodShort) foodWishes();
      attempt(wants, wants.length);
      return;
    }
    if (foodShort) foodWishes();
    want(count("woodcutter") < 1, near("woodcutter", Feature.Tree));
    want(count("quarry") < 1, near("quarry", Feature.Rock));
    want(count("sawmill") < 1, near("sawmill"));
    want(count("forester") < 1, near("forester", Feature.Tree));
    const woodOrder = this.woodOrder(w, mine, stock);
    if (woodOrder) wants.push({ key: "wood", fn: woodOrder });
    want(lanterns < 1 + Math.floor(mine.length / 5), grow());
    want(!housed && count("house") < Math.floor(people / 7) && plank >= 5, near("house"));
    // Beyond the shore: a boatyard to chart the sea, quays, and footholds on free land across the water.
    const built = mine.filter((b) => b.built).length;
    const landLocked = (this.resting.get("expand") ?? 0) > this.thoughts && built >= 12;
    want(this.thoughts % 3 === 0 && this.sea.ready(ctx, built, landLocked), { key: "sea", fn: () => this.sea.step(ctx) });
    want(count("fisher") < 1, near("fisher", undefined, 11));
    want(count("farm") < 1, near("farm"));
    want(count("mill") < 1 && count("farm") > 0, near("mill"));
    want(count("bakery") < 1 && count("mill") > 0, near("bakery"));
    want(count("woodcutter") < 2 && count("forester") > 0, near("woodcutter", Feature.Tree));
    want(count("sawmill") < 2 && log > 12, near("sawmill"));
    want(count("quarry") < 2 && stone < 10, near("quarry", Feature.Rock));
    want(count("forester") < 2 && count("woodcutter") > 1, near("forester", Feature.Tree));
    want(count("farm") < 2 && count("mill") > 0, near("farm"));
    want(count("hunter") < 1 && count("farm") > 0, near("hunter", Feature.Tree, 10));
    want(count("orchard") < 1 && count("farm") > 0, near("orchard"));
    want(count("apiary") < 1 && count("orchard") > 0, near("apiary"));
    // A well (or more, as the settlement grows) against fire.
    want(count("well") < 1 + Math.floor(mine.length / 14) && mine.length >= 8 && stone >= 3, near("well"));
    // A toolsmith once the first tools are out, so woodcutters and the rest can keep taking up work.
    // With `toolsmithAnyway` a seat whose quarry has run dry (and been pulled down) still builds one when it has stone for it.
    want(count("toolsmith") < 1 && count("sawmill") > 0 && (count("quarry") > 0 || (aiOptions.toolsmithAnyway && stone >= TOOLSMITH_STONE)) && mine.length >= 8, near("toolsmith"));
    // Land use: geologists and mines, hedgerows, causeways, smelting and arms.
    want(built >= 10 && this.thoughts % 2 === 1, { key: "econ", fn: () => this.econ.step(ctx, this.thoughts) });
    // Public works: bridges, pleasures, digs, gifts to allies.
    want(built >= 14 && this.thoughts % 3 === 1, { key: "works", fn: () => this.works.step(ctx, this.thoughts) });
    // Terraforming where the world is not yet alive.
    // What the land it holds calls for: tree houses, waystations, saltworks, tide mills, ropeways and the rest.
    want(built >= 12 && this.thoughts % 4 === 0, { key: "biome", fn: () => this.biome.step(ctx, this.thoughts) });
    want(built >= 12 && this.thoughts % 4 === 2, { key: "terra", fn: () => this.terra.step(ctx, this.thoughts) });
    want(count("pasture") < 1 && count("farm") > 1, near("pasture"));
    want(count("butcher") < 1 && count("pasture") > 0, near("butcher"));
    // Temperament: Builders make their town pleasant; Wardens arm.
    want(this.personality === "builder" && count("flowerbed") < Math.floor(mine.length / 10), near("flowerbed"));
    want(this.personality === "builder" && count("bench") < Math.floor(mine.length / 14), near("bench"));
    want((this.personality === "warden" || this.armed) && count("toolsmith") > 0 && count("weaponsmith") < 1, near("weaponsmith"));
    // Idle hands and no room to grow: more woodcutters and quarries clear the forest and rocks that box a
    // settlement in, and give those hands work.
    want(idle >= 6 && count("woodcutter") < 2 + Math.floor(idle / 8), near("woodcutter", Feature.Tree));
    want(idle >= 6 && count("quarry") < 2 + Math.floor(idle / 12), near("quarry", Feature.Rock));
    want(lanterns < 3 + Math.floor(mine.length / 3), grow());
    if (lanterns < 3 + Math.floor(mine.length / 3)) tally(pl, 3);
    // Nothing could be placed with hands idle: perhaps forest or rock has boxed the settlement in.
    if (!attempt(triage(wants), Math.max(1, Math.round(this.tuning.wants))) && idle >= 6 && (this.resting.get("clear") ?? 0) <= this.thoughts) {
      const did = clearForest(w, pl);
      if (!did) this.resting.set("clear", this.thoughts + 12);
      if (did === "built") this.cuts = 0;
      // With a forester taken down, no new one for a good while. Two take-downs in a row that did not open the way
      // mean the forest is not what boxes it in: leave the foresters be for a long time.
      if (did === "forester") {
        this.resting.set("forester", this.thoughts + 300);
        this.resting.set("clear", this.thoughts + (++this.cuts >= 2 ? 300 : 12));
      }
    }
  }

  /**
   * With `woodByNeed`: when planks and logs are both short, an order to place one more woodcutter (or a forester for every three),
   * or null. One at a time (none while one stands unfinished), WOOD_GAP thoughts apart, up to a number that grows with the
   * finished buildings, and only when the tool for it is in the stores.
   */
  private woodOrder(w: World, mine: readonly { built: boolean; def: { id: string } }[], stock: readonly number[]): (() => boolean) | null {
    if (!aiOptions.woodByNeed) return null;
    const finished = mine.filter((b) => b.built).length;
    if (finished < WOOD_FROM || w.economy.population(this.player).idle < 1 || (stock[goodId("plank")] ?? 0) >= WOOD_SHORT || (stock[goodId("log")] ?? 0) >= WOOD_SHORT || this.thoughts - this.woodAt < WOOD_GAP) return null;
    if (mine.some((b) => !b.built && (b.def.id === "woodcutter" || b.def.id === "forester"))) return null;
    const cutters = mine.filter((b) => b.def.id === "woodcutter").length;
    const planters = mine.filter((b) => b.def.id === "forester").length;
    const cap = 2 + Math.floor(finished / WOOD_PER_BUILT);
    const type = planters * 3 < cutters && planters < Math.ceil(cap / 3) ? "forester" : cutters < cap ? "woodcutter" : "";
    const tool = type ? BUILDINGS[buildingType(type)]?.tool : undefined;
    // The tool is in the stores, or a toolsmith stands to make it (the site then makes the toolsmith's priority follow).
    if (!type || (tool && spareTools(w, this.player, stock, tool) < 1 && !mine.some((b) => b.built && b.def.id === "toolsmith"))) return null;
    return () => {
      const ok = placeConnected(w, type, { minDist: 2, maxDist: 9, near: Feature.Tree, need: 3, player: this.player, center: this.center(w), splitRoads: true });
      if (ok) this.woodAt = this.thoughts;
      return ok;
    };
  }

  /** Diplomacy: offer what this temperament wants, and get its prisoners home. */
  private talk(w: World): void {
    if (!aiOptions.diplomacy) return;
    const eco = w.economy;
    const pl = this.player;
    const dip = eco.diplomacy;
    const offer = (q: number, kind: TreatyKind) => {
      const last = [...dip.proposals].reverse().find((x) => x.from === pl && x.to === q && x.kind === kind);
      if (last && (last.open || w.tick - last.at < 4 * eco.dayTicks)) return false;
      return w.command({ t: "propose", to: q, kind, player: pl }).ok;
    };
    for (let q = 0; q < eco.keeps.length; q++) {
      if (q === pl || eco.keeps[q] === undefined || eco.defeated[q]) continue;
      const held = eco.people.some((x) => x.alive && x.captive !== undefined && ((x.owner === pl && x.captive === q) || (x.owner === q && x.captive === pl)));
      if (held && offer(q, "prisoners")) return;
      if (dip.rep(q) < 30) continue;
      if (this.personality === "trader") {
        if (!dip.between(pl, q, "trade").length && offer(q, "trade")) return;
        if (!dip.between(pl, q, "roads").length && dip.rep(q) >= 45 && offer(q, "roads")) return;
      } else if (this.personality === "builder" && w.tick >= eco.peaceUntil - eco.dayTicks) {
        if (!dip.truce(pl, q) && offer(q, "truce")) return;
      }
    }
  }

  /** Where to build next: home at first, later around a random lit lantern. */
  private center(w: World): number {
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[this.player] ?? -1];
    const lit = eco.buildings.filter((b) => b.alive && b.owner === this.player && b.lit && b.def.slots);
    if (!lit.length || this.rng.chance(0.45)) return keep?.tile ?? 0;
    return (this.rng.pick(lit) as { tile: number }).tile;
  }

  /** Place a lantern near the border where it would light up the most unclaimed land. */
  private failedTries = 0;
  /** `borderClear`: woodcutters built so far, and the thought of the last. */
  private borderCuts = 0;
  private cutAt = -BORDER_CUT_GAP;
  /** `rejoinRoads`: cut-off buildings no road was found for, with the tick before which they are not tried again. */
  private rejoinSkip = new Map<number, number>();

  private expand(w: World, plank: number, stone: number): boolean {
    const pl = this.player;
    const type = plank >= 6 && stone >= 9 ? "beacon" : plank >= 3 && stone >= 3 ? "lamphouse" : "lantern";
    let tiles = frontierTiles(w, pl, () => this.rng.next() * 3);
    if (aiOptions.borderReach) tiles = this.reachable(w, tiles);
    // Every other lantern, while the rock is nearly gone, goes toward rock outside the border.
    if (this.rockLow(w) && this.expansions++ % 2 === 0) tiles = this.towardRock(w, tiles);
    tally(pl, 4);
    if (!tiles.length) tally(pl, 5);
    // With `borderCandidates`: the tiles a lantern fits on, from the first BORDER_SCAN of the list; the whole list still serves `borderClear` and the probe.
    const frontier = tiles;
    if (aiOptions.borderCandidates) {
      const def = BUILDINGS[buildingType(type)];
      const fit: number[] = [];
      for (const t of frontier.slice(0, BORDER_SCAN)) {
        if (def && flagSides(w, t, def, pl).length) fit.push(t);
        if (fit.length >= BORDER_TRY) break;
      }
      tiles = fit;
    }
    let placed = placeOn(w, type, tiles.slice(0, BORDER_TRY), pl, true, 12) >= 0;
    if (placed) tally(pl, 6);
    else if (frontier.length) {
      tally(pl, 9);
      if (aiOptions.borderClear && this.borderCuts < BORDER_CUTS && this.thoughts - this.cutAt >= BORDER_CUT_GAP && clearForBorder(w, pl, frontier)) {
        this.borderCuts++;
        this.cutAt = this.thoughts;
        tally(pl, 10);
        placed = true;
      }
      // One failed try in eight is taken apart for the probe: what stood in the way, tile by tile (a read-only diagnostic).
      if (this.failedTries++ % 8 === 0) {
        const sum = (aiWhy[pl] ??= {});
        sum["tries diagnosed"] = (sum["tries diagnosed"] ?? 0) + 1;
        diagnoseBorder(w, pl, type, frontier.slice(0, 40), (reason) => (sum[reason] = (sum[reason] ?? 0) + 1));
      }
    }
    if (type === "beacon") tally(pl, 7);
    else if (type === "lamphouse") tally(pl, 8);
    return placed;
  }
}
