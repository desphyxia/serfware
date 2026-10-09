import { BUILDINGS, buildingType, DEFAULT_DISTRIBUTION, goodId } from "../econ/defs";
import { DEFAULT_TRANSPORT, GOOD_COLLECT, STORE_OUT, type Building } from "../econ/economy";
import { Feature, Use } from "../econ/landuse";
import { placeConnected, placeOn } from "../econ/planner";
import type { AiContext } from "./brain";
import { aiOptions } from "./options";
import type { Personality } from "./personality";

/** The mine each geologist sign (deposit + 1) calls for. */
const MINE_FOR_SIGN: Record<number, string> = { 2: "coalmine", 3: "ironmine", 4: "goldmine", 5: "granitemine" };
const MINES = new Set(Object.values(MINE_FOR_SIGN));
const FOODS = ["bread", "fish", "meat", "fruit", "honey", "shellfish"];
/** Hedgerow tiles planted round a farm, at most, and logs kept back for them. */
const HEDGES_PER_FARM = 6;
/** With `oreMines`: one more coal and one more iron mine for every this many finished buildings. */
const ORE_PER_BUILT = 50;
/** With `oreMines`: hammers in the stores that let a geologist go before any toolsmith stands (builders need them too). */
const GEOLOGIST_HAMMERS = 2;
/** With `oreMines`: how far from a sign (a mine digs within two steps of itself) a mine may stand. */
const MINE_REACH = 2;
/** With `forgeRoom`: lit lanterns tried as the centre when the ring round the Hearthship has no room. */
const FORGE_CENTRES = 3;
/** With `surveyAgain`: failed tries to place a kind of mine, in a row, before its remembered signs are forgotten. */
const SURVEY_FAILS = 3;
/** With `surveyAgain`: thoughts (about 2 days) before the signs of a kind may be forgotten again. */
const SURVEY_REST = 120;
/** The geologist sign (deposit + 1) each kind of mine digs. */
const SIGN_FOR: Record<string, number> = { coalmine: 2, ironmine: 3, goldmine: 4, granitemine: 5 };

/**
 * The scripted AI's land use and settings: it sends geologists where mountains stand, opens mines on
 * what they find and smelts it, plants hedgerows round farms, raises causeways under roads on tidal
 * flats, stages materials in a forward storehouse, sets distribution and transport priorities from what
 * is short, and rotates its wardens when a border is threatened. Every order is one a player can give;
 * each step gives at most one, and each family waits a while after it acts.
 */
export class EconPlanner {
  constructor(
    private readonly player: number,
    private readonly personality: Personality,
  ) {}

  /** The thought at which each kind of order may be given again. */
  private readonly rest = new Map<string, number>();
  private thoughts = 0;
  private surveys = 0;
  /** With `oreMines`: the kinds of mine that have stood finished (an exhausted one is pulled down, but its smelting goes on). */
  private readonly hadMine = new Set<string>();
  /** With `surveyAgain`: failed tries to place a kind of mine (by sign) since the last success or the last forgetting. */
  private readonly misses = new Map<number, number>();

  private can(key: string): boolean {
    return (this.rest.get(key) ?? 0) <= this.thoughts;
  }

  private wait(key: string, thoughts: number): void {
    this.rest.set(key, this.thoughts + thoughts);
  }

  /** Settings that are cheap and never place anything: priorities, storage and wardens. Called often. */
  settings(ctx: AiContext, thoughts: number): void {
    this.thoughts = thoughts;
    const eco = ctx.eco;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const sites = mine.filter((b) => !b.built).length;
    const stock = eco.storageTotals(pl);
    const plank = stock[goodId("plank")] ?? 0;
    const prefs = eco.prefs[pl];
    if (!prefs) return;

    // Planks go to the building sites first while they are short; otherwise the defaults stand.
    const short = sites >= 2 && plank < 4;
    for (const [target, base] of Object.entries(DEFAULT_DISTRIBUTION.plank ?? {})) {
      if (target === "site") continue;
      const want = short ? Math.min(base, 0.1) : base;
      if (Math.abs((prefs.dist.plank?.[target] ?? base) - want) > 0.01) ctx.act({ t: "prio", key: "plank", target, value: want });
    }

    // Food to the mines first when one stands idle for want of it; otherwise building materials lead.
    const hungry = mine.some((b) => b.built && MINES.has(b.def.id) && !b.exhausted && b.food <= 0);
    const front = hungry ? FOODS[0] : DEFAULT_TRANSPORT[0];
    if (prefs.transport[0] !== front && this.can("transport")) {
      if (hungry) for (const f of FOODS.slice(0, 3).reverse()) ctx.act({ t: "transport", good: f, to: 0 });
      else for (const [i, g] of DEFAULT_TRANSPORT.slice(0, 2).entries()) ctx.act({ t: "transport", good: g, to: i });
      this.wait("transport", 15);
    }

    // Wardens: when a lantern near a border is under threat, call the strongest to it for half a day.
    const threatened = mine.some((b) => b.built && b.lit && b.def.slots && b.threat >= 2);
    if (threatened && this.can("rotate")) {
      ctx.act({ t: "rotate" });
      this.wait("rotate", Math.ceil(eco.dayTicks / 120) + 2);
    }

    this.stores(ctx, mine);
  }

  /**
   * A storehouse nearer the border than the Hearthship collects building materials, so they wait where
   * sites rise; the oldest storehouse inland empties itself toward it once there are several.
   */
  private stores(ctx: AiContext, mine: Building[]): void {
    if (!this.can("stores")) return;
    const eco = ctx.eco;
    const pl = this.player;
    const stores = mine.filter((b) => b.built && b.def.id === "storehouse");
    if (!stores.length) return;
    const grid = ctx.world.planet.grid;
    const keep = eco.buildings[eco.keeps[pl] ?? -1];
    if (!keep) return;
    const c = grid.center;
    const away = (b: Building) => (c[b.tile * 3]! - c[keep.tile * 3]!) ** 2 + (c[b.tile * 3 + 1]! - c[keep.tile * 3 + 1]!) ** 2 + (c[b.tile * 3 + 2]! - c[keep.tile * 3 + 2]!) ** 2;
    const far = stores.slice().sort((a, b) => away(b) - away(a) || a.id - b.id);
    const forward = far[0] as Building;
    for (const g of ["plank", "stone"]) {
      const t = goodId(g);
      if (forward.goodMode[t] !== GOOD_COLLECT) {
        ctx.act({ t: "storeGood", building: forward.id, good: g, mode: GOOD_COLLECT });
        this.wait("stores", 2);
        return;
      }
    }
    const inland = far[far.length - 1] as Building;
    if (far.length >= 2 && inland.mode !== STORE_OUT) {
      ctx.act({ t: "storeMode", building: inland.id, mode: STORE_OUT });
      this.wait("stores", 2);
      return;
    }
    this.wait("stores", 8);
  }

  /**
   * Stone is what a settlement runs out of first (the rocks are few). With the stores bare, granite is the way on:
   * a geologist to find it, then a granite mine (which costs no stone) as soon as the signs show. Called before the
   * builder's site throttle, because sites waiting for stone are what hold the throttle shut.
   */
  relieveStone(ctx: AiContext, thoughts: number, rockLow = false): boolean {
    this.thoughts = thoughts;
    const eco = ctx.eco;
    const land = ctx.world.land;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const built = mine.filter((b) => b.built);
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const stone = eco.storageTotals(pl)[goodId("stone")] ?? 0;
    const stock = eco.storageTotals(pl);
    const unbuilt = mine.length - built.length;
    const sign = (s: number) => {
      const out: number[] = [];
      for (let t = 0; t < land.sign.length; t++) if (land.sign[t] === s && land.territory[t] === pl + 1 && land.use[t] === Use.Free && !land.signSmall[t]) out.push(t);
      return out;
    };
    const manned = (type: string) => {
      const tool = BUILDINGS[buildingType(type)]?.tool;
      return !tool || (stock[goodId(tool)] ?? 0) >= 1;
    };
    const stoneShort = stone < 6 && built.length >= 8;
    // The rock is nearly used up (`rockLow`, only ever set when the builder's option is on): start on granite before the stores are bare, one mine and a few surveys.
    const early = rockLow && !stoneShort && built.length >= 8;
    const fedAtAll = count("farm") + count("fisher") + count("butcher") + count("hunter") > 0;
    if ((!stoneShort && !early) || !fedAtAll) return false;
    const granite = sign(5);
    if (granite.length && count("granitemine") < (early ? 1 : 2) && this.can("granitemine") && manned("granitemine")) {
      this.wait("granitemine", 6);
      if (placeOn(ctx.world, "granitemine", aiOptions.oreMines ? this.mineTiles(ctx, granite, "granitemine") : granite, pl, true, 16) >= 0) return true;
    }
    if (!granite.length && unbuilt < 6 && this.can("geologist") && (!early || this.surveys < 6)) {
      const flags = eco.flags.filter((f) => f.alive && f.owner === pl && f.building < 0 && eco.check({ t: "geologist", flagTile: f.tile, player: pl }) === null);
      const done = ctx.act({ t: "geologist", flagTile: (flags[this.thoughts % Math.max(1, flags.length)] ?? { tile: -1 }).tile });
      this.wait("geologist", done.ok ? 10 : 8);
      if (early && done.ok) this.surveys++;
      return done.ok;
    }
    return false;
  }

  /**
   * With `oreMines`: the tiles a mine may stand on for the signs of one kind, the ones with the most signs within reach
   * first: the sign tiles and the tiles within MINE_REACH of them that a mine may stand on (mountain, free, ours). A mine
   * digs within two steps of itself, and the sign tile is often not mountain, or too steep, to build on. Only the signs
   * are used, as a player has only them.
   */
  private mineTiles(ctx: AiContext, signs: readonly number[], type: string): number[] {
    const land = ctx.world.land;
    const pl = this.player;
    const marked = new Set(signs);
    // A second mine of a kind digs somewhere else: not within reach of one that still works.
    const dug = new Set<number>();
    for (const b of ctx.eco.buildings) if (b.alive && b.owner === pl && b.def.id === type && !b.exhausted) for (const t of [b.tile, ...land.ring(b.tile, MINE_REACH)]) dug.add(t);
    const seen = new Set<number>();
    const scored: [number, number][] = [];
    for (const s of signs) {
      for (const t of [s, ...land.ring(s, MINE_REACH)]) {
        if (seen.has(t) || dug.has(t)) continue;
        seen.add(t);
        if (land.territory[t] !== pl + 1 || land.use[t] !== Use.Free || !land.isMountain(t)) continue;
        let near = marked.has(t) ? 1 : 0;
        for (const x of land.ring(t, MINE_REACH)) if (marked.has(x)) near++;
        scored.push([-near, t]);
      }
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.slice(0, 60).map(([, t]) => t);
  }

  /** With `oreMines`: the sign tiles seen so far, by sign (deposit + 1): a signpost stands for 6000 ticks, the mine comes later. */
  private readonly known = new Map<number, Set<number>>();

  /**
   * With `surveyAgain`: a try to place a mine on the remembered signs of its kind failed. After SURVEY_FAILS in a row the signs
   * are forgotten (except those within reach of a mine that still works), so the geologists see the kind as lacking and
   * survey again; not again for SURVEY_REST thoughts, so the same tiles are not tried in a tight loop.
   */
  private missed(ctx: AiContext, type: string): void {
    const s = SIGN_FOR[type];
    const set = s === undefined ? undefined : this.known.get(s);
    if (s === undefined || !set?.size) return;
    const n = (this.misses.get(s) ?? 0) + 1;
    this.misses.set(s, n);
    if (n < SURVEY_FAILS || !this.can(`forget${s}`)) return;
    const land = ctx.world.land;
    const dug = new Set<number>();
    for (const b of ctx.eco.buildings) if (b.alive && b.owner === this.player && b.def.id === type && !b.exhausted) for (const t of [b.tile, ...land.ring(b.tile, MINE_REACH)]) dug.add(t);
    for (const t of [...set]) if (!dug.has(t)) set.delete(t);
    this.misses.delete(s);
    this.wait(`forget${s}`, SURVEY_REST);
  }

  /**
   * Land use: one order at most. Returns true if it placed something or gave an order, so the builder
   * counts the thought as spent.
   */
  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const ore = aiOptions.oreMines;
    const eco = ctx.eco;
    const land = ctx.world.land;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const built = mine.filter((b) => b.built);
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    /** With `oreMines` an exhausted mine does not count: its quota is open again. */
    const live = (id: string) => mine.filter((b) => b.def.id === id && !b.exhausted).length;
    for (const b of built) if (MINES.has(b.def.id)) this.hadMine.add(b.def.id);
    const stock = eco.storageTotals(pl);
    const stone = stock[goodId("stone")] ?? 0;
    const log = stock[goodId("log")] ?? 0;
    const visible = (s: number) => {
      const out: number[] = [];
      for (let t = 0; t < land.sign.length; t++) if (land.sign[t] === s && land.territory[t] === pl + 1 && land.use[t] === Use.Free && !land.signSmall[t]) out.push(t);
      return out;
    };
    // With `oreMines` the signs seen are remembered (the posts themselves stand under a day), and forgotten where a mine has run out.
    const sign = (s: number): number[] => {
      const now = visible(s);
      if (!ore) return now;
      const set = this.known.get(s) ?? this.known.set(s, new Set()).get(s)!;
      for (const t of now) set.add(t);
      return [...set].filter((t) => land.territory[t] === pl + 1 && land.use[t] === Use.Free).sort((a, b) => a - b);
    };
    // Nothing new while a site waits (it holds the builder's attention and the settlement's growth), and
    // nothing whose worker's tool is not in the stores: such a site would never be manned.
    const unbuilt = mine.filter((b) => !b.built).length;
    const manned = (type: string) => {
      const tool = BUILDINGS[buildingType(type)]?.tool;
      return !tool || (stock[goodId(tool)] ?? 0) >= 1;
    };
    const open = (type: string, tiles: number[]) => tiles.length > 0 && placeOn(ctx.world, type, tiles, pl, true, 16) >= 0;
    /** Coal and iron mines allowed at once: one, and with `oreMines` one more for every ORE_PER_BUILT buildings. */
    const quota = ore ? 1 + Math.floor(built.length / ORE_PER_BUILT) : 1;
    const have = (id: string) => (ore ? live(id) : count(id));

    // An exhausted mine is pulled down (its miner and pick go back to the pool).
    const retire = (): boolean => {
      if (!ore) return false;
      for (const b of built) {
        if (!MINES.has(b.def.id) || !b.exhausted) continue;
        // What this mine could reach is dug out: its signs say nothing now.
        const reach = new Set([b.tile, ...land.ring(b.tile, MINE_REACH)]);
        for (const set of this.known.values()) for (const t of reach) set.delete(t);
        if (ctx.act({ t: "demolish", tile: b.tile }).ok) return true;
      }
      return false;
    };

    // Hedgerows round farms (they take logs), tidal causeways under roads (they take stones).
    const hedges = (): boolean => {
      if (this.can("hedge")) {
        for (const f of built.filter((b) => b.def.id === "farm")) {
          const planted = land.ring(f.tile, 4).filter((t) => land.feature[t] === Feature.Hedge).length;
          if (planted >= HEDGES_PER_FARM) continue;
          const spare = land.ring(f.tile, 4).filter((t) => !land.ring(f.tile, 2).includes(t));
          for (const t of spare) if (ctx.act({ t: "hedge", tile: t }).ok) return true;
        }
        this.wait("hedge", log >= 3 ? 20 : 6);
      }
      return false;
    };
    const causeways = (): boolean => {
      if (stone >= 8 && this.can("causeway")) {
        for (let t = 0; t < land.tidal.length; t++) {
          if (!land.tidal[t] || land.causeway[t] || land.use[t] !== Use.Road || land.territory[t] !== pl + 1) continue;
          if (ctx.act({ t: "causeway", tile: t }).ok) {
            this.wait("causeway", 6);
            return true;
          }
        }
        this.wait("causeway", 10);
      }
      return false;
    };

    // Geologists, once a toolsmith has made a hammer, until the signs show where ore lies.
    const geologists = (): boolean => {
      const usable = [2, 3, 4, 5].some((s) => sign(s).length > 0);
      // With `oreMines`: until every kind the settlement wants has a usable sign, with a hammer to spare instead of a toolsmith.
      const wants: [boolean, number][] = [
        [have("coalmine") < quota, 2],
        [have("ironmine") < quota, 3],
        [count("smelter") > 0 && have("goldmine") < 1 && this.personality !== "warden", 4],
        [stone < 8 && have("granitemine") < 1, 5],
      ];
      const lacking = ore ? wants.some(([need, s]) => need && sign(s).length === 0) : !usable;
      const hammers = stock[goodId("hammer")] ?? 0;
      const skilled = count("toolsmith") > 0 || (ore && hammers >= GEOLOGIST_HAMMERS);
      if (skilled && built.length >= 10 && lacking && this.can("geologist")) {
        let flags = eco.flags.filter((f) => f.alive && f.owner === pl && f.building < 0 && eco.check({ t: "geologist", flagTile: f.tile, player: pl }) === null);
        if (ore) {
          // From the flags with the most ground nobody has sampled yet.
          const spots = (tile: number) => land.ring(tile, 4).filter((t) => land.sign[t] === 0 && land.surveyable(t)).length;
          flags = flags.map((f) => [spots(f.tile), f] as const).sort((a, b) => b[0] - a[0] || a[1].id - b[1].id).slice(0, 3).map(([, f]) => f);
        }
        const done = ctx.act({ t: "geologist", flagTile: (flags[this.thoughts % Math.max(1, flags.length)] ?? { tile: -1 }).tile });
        // Signs that show nothing usable are not worth endless surveys: fewer after the first dozen.
        if (done.ok) this.surveys++;
        this.wait("geologist", done.ok ? (this.surveys > 30 ? (ore ? 60 : 90) : ore ? 20 : 30) : 12);
        if (done.ok) return true;
      }
      return false;
    };

    // A forward storehouse once the settlement is big, so materials wait where sites rise.
    const storehouse = (): boolean => {
      if (built.length >= 20 && count("storehouse") < 1 + Math.floor(built.length / 40) && stone >= 6 && (stock[goodId("plank")] ?? 0) >= 8 && this.can("storehouse") && unbuilt === 0) {
        const keep = eco.buildings[eco.keeps[pl] ?? -1];
        const c = ctx.world.planet.grid.center;
        const from = (t: number) => (c[t * 3]! - c[(keep?.tile ?? t) * 3]!) ** 2 + (c[t * 3 + 1]! - c[(keep?.tile ?? t) * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[(keep?.tile ?? t) * 3 + 2]!) ** 2;
        const tiles = land.ring(keep?.tile ?? 0, 14).filter((t) => land.territory[t] === pl + 1).sort((a, b) => from(b) - from(a) || a - b).slice(0, 200);
        if (placeOn(ctx.world, "storehouse", tiles, pl, true, 16) >= 0) return true;
        this.wait("storehouse", 15);
      }
      return false;
    };

    /**
     * The smelter, goldsmith, bowyer and stable: within 9 steps of the Hearthship (placeConnected's default centre). With
     * `forgeRoom`, when that ring is full, within 9 steps of up to FORGE_CENTRES of the lit lanterns, a different few each try.
     */
    const forge = (type: string): boolean => {
      const opts = { minDist: 2, maxDist: 9, player: pl, splitRoads: true };
      if (placeConnected(ctx.world, type, opts)) return true;
      if (!aiOptions.forgeRoom) return false;
      const lanterns = built.filter((b) => b.lit && b.def.slots).map((b) => b.tile).sort((a, b) => a - b);
      for (let i = 0; i < Math.min(FORGE_CENTRES, lanterns.length); i++) {
        if (placeConnected(ctx.world, type, { ...opts, center: lanterns[(this.thoughts + i) % lanterns.length] as number })) return true;
      }
      return false;
    };

    // Mines on what they found, fed by the farms; then smelting, gold, and the Warden's arms.
    const mines = (): boolean => {
      const fed = count("farm") > 0 && (count("bakery") > 0 || count("fisher") > 0 || count("butcher") > 0) && built.length >= 12;
      if (fed && unbuilt <= 1 && this.can("mine")) {
        const coal = sign(2);
        const iron = sign(3);
        const gold = sign(4);
        const granite = sign(5);
        // With `oreMines` the smelter does not wait for mines that have since run out.
        const mined = (id: string) => (ore ? this.hadMine.has(id) : count(id) > 0);
        const tries: [boolean, string, number[]][] = [
          [have("coalmine") < quota, "coalmine", coal],
          [have("ironmine") < quota, "ironmine", iron],
          [count("smelter") < 1 && mined("coalmine") && mined("ironmine"), "smelter", []],
          [have("granitemine") < 1 && stone < 8, "granitemine", granite],
          [have("goldmine") < 1 && count("smelter") > 0 && this.personality !== "warden", "goldmine", gold],
          [count("goldsmith") < 1 && mined("goldmine") && count("smelter") > 0, "goldsmith", []],
          [count("bowyer") < 1 && this.personality === "warden" && count("weaponsmith") > 0, "bowyer", []],
          [count("stable") < 1 && this.personality === "warden" && count("pasture") > 0 && count("weaponsmith") > 0, "stable", []],
        ];
        for (const [cond, type, tiles] of tries) {
          // A building that costs stone waits for some; granite mines and the like do not.
          if (!cond || !this.can(type) || !manned(type) || ((BUILDINGS[buildingType(type)]?.cost.stone ?? 0) > 0 && stone < 4)) continue;
          const placed = MINES.has(type) ? open(type, ore ? this.mineTiles(ctx, tiles, type) : tiles) : forge(type);
          if (placed) {
            if (aiOptions.surveyAgain) this.misses.delete(SIGN_FOR[type] ?? 0);
            return true;
          }
          if (aiOptions.surveyAgain && ore && tiles.length > 0) this.missed(ctx, type);
          this.wait(type, 10);
        }
        this.wait("mine", 2);
      }
      return false;
    };

    // With `oreMines` the mine family goes first: hedgerows are many (six a farm) and each gives an order, which kept
    // the geologists and mines from ever being reached.
    const order = ore ? [retire, geologists, mines, hedges, causeways, storehouse] : [hedges, causeways, geologists, storehouse, mines];
    for (const family of order) if (family()) return true;
    return false;
  }
}
