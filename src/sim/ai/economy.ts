import { BUILDINGS, buildingType, DEFAULT_DISTRIBUTION, goodId } from "../econ/defs";
import { DEFAULT_TRANSPORT, GOOD_COLLECT, STORE_OUT, type Building } from "../econ/economy";
import { Feature, Use } from "../econ/landuse";
import { placeConnected, placeOn } from "../econ/planner";
import type { AiContext } from "./brain";
import type { Personality } from "./personality";

/** The mine each geologist sign (deposit + 1) calls for. */
const MINE_FOR_SIGN: Record<number, string> = { 2: "coalmine", 3: "ironmine", 4: "goldmine", 5: "granitemine" };
const MINES = new Set(Object.values(MINE_FOR_SIGN));
const FOODS = ["bread", "fish", "meat", "fruit", "honey", "shellfish"];
/** Hedgerow tiles planted round a farm, at most, and logs kept back for them. */
const HEDGES_PER_FARM = 6;

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
   * Land use: one order at most. Returns true if it placed something or gave an order, so the builder
   * counts the thought as spent.
   */
  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const eco = ctx.eco;
    const land = ctx.world.land;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const built = mine.filter((b) => b.built);
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const stock = eco.storageTotals(pl);
    const stone = stock[goodId("stone")] ?? 0;
    const log = stock[goodId("log")] ?? 0;
    const sign = (s: number) => {
      const out: number[] = [];
      for (let t = 0; t < land.sign.length; t++) if (land.sign[t] === s && land.territory[t] === pl + 1 && land.use[t] === Use.Free && !land.signSmall[t]) out.push(t);
      return out;
    };
    // Nothing new while a site waits (it holds the builder's attention and the settlement's growth), and
    // nothing whose worker's tool is not in the stores: such a site would never be manned.
    const unbuilt = mine.filter((b) => !b.built).length;
    const manned = (type: string) => {
      const tool = BUILDINGS[buildingType(type)]?.tool;
      return !tool || (stock[goodId(tool)] ?? 0) >= 1;
    };
    const open = (type: string, tiles: number[]) => tiles.length > 0 && placeOn(ctx.world, type, tiles, pl, true, 16) >= 0;

    // Hedgerows round farms (they take logs), tidal causeways under roads (they take stones).
    if (this.can("hedge")) {
      for (const f of built.filter((b) => b.def.id === "farm")) {
        const planted = land.ring(f.tile, 4).filter((t) => land.feature[t] === Feature.Hedge).length;
        if (planted >= HEDGES_PER_FARM) continue;
        const spare = land.ring(f.tile, 4).filter((t) => !land.ring(f.tile, 2).includes(t));
        for (const t of spare) if (ctx.act({ t: "hedge", tile: t }).ok) return true;
      }
      this.wait("hedge", log >= 3 ? 20 : 6);
    }
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

    // Geologists, once a toolsmith has made a hammer, until the signs show where ore lies.
    const usable = [2, 3, 4, 5].some((s) => sign(s).length > 0);
    if (count("toolsmith") > 0 && built.length >= 10 && !usable && this.can("geologist")) {
      const flags = eco.flags.filter((f) => f.alive && f.owner === pl && f.building < 0 && eco.check({ t: "geologist", flagTile: f.tile, player: pl }) === null);
      const done = ctx.act({ t: "geologist", flagTile: (flags[this.thoughts % Math.max(1, flags.length)] ?? { tile: -1 }).tile });
      // Signs that show nothing usable are not worth endless surveys: fewer after the first dozen.
      if (done.ok) this.surveys++;
      this.wait("geologist", done.ok ? (this.surveys > 30 ? 90 : 30) : 12);
      if (done.ok) return true;
    }

    // A forward storehouse once the settlement is big, so materials wait where sites rise.
    if (built.length >= 20 && count("storehouse") < 1 + Math.floor(built.length / 40) && stone >= 6 && (stock[goodId("plank")] ?? 0) >= 8 && this.can("storehouse") && unbuilt === 0) {
      const keep = eco.buildings[eco.keeps[pl] ?? -1];
      const c = ctx.world.planet.grid.center;
      const from = (t: number) => (c[t * 3]! - c[(keep?.tile ?? t) * 3]!) ** 2 + (c[t * 3 + 1]! - c[(keep?.tile ?? t) * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[(keep?.tile ?? t) * 3 + 2]!) ** 2;
      const tiles = land.ring(keep?.tile ?? 0, 14).filter((t) => land.territory[t] === pl + 1).sort((a, b) => from(b) - from(a) || a - b).slice(0, 200);
      if (placeOn(ctx.world, "storehouse", tiles, pl, true, 16) >= 0) return true;
      this.wait("storehouse", 15);
    }

    // Mines on what they found, fed by the farms; then smelting, gold, and the Warden's arms.
    const fed = count("farm") > 0 && (count("bakery") > 0 || count("fisher") > 0 || count("butcher") > 0) && built.length >= 12;
    // Sites wait for stone, so none is begun while the stores are bare.
    if (fed && stone >= 4 && unbuilt <= 1 && this.can("mine")) {
      const coal = sign(2);
      const iron = sign(3);
      const gold = sign(4);
      const granite = sign(5);
      const tries: [boolean, string, number[]][] = [
        [count("coalmine") < 1, "coalmine", coal],
        [count("ironmine") < 1, "ironmine", iron],
        [count("smelter") < 1 && count("coalmine") > 0 && count("ironmine") > 0, "smelter", []],
        [count("granitemine") < 1 && stone < 8, "granitemine", granite],
        [count("goldmine") < 1 && count("smelter") > 0 && this.personality !== "warden", "goldmine", gold],
        [count("goldsmith") < 1 && count("goldmine") > 0 && count("smelter") > 0, "goldsmith", []],
        [count("bowyer") < 1 && this.personality === "warden" && count("weaponsmith") > 0, "bowyer", []],
        [count("stable") < 1 && this.personality === "warden" && count("pasture") > 0 && count("weaponsmith") > 0, "stable", []],
      ];
      for (const [cond, type, tiles] of tries) {
        if (!cond || !this.can(type) || !manned(type)) continue;
        const placed = MINES.has(type) ? open(type, tiles) : placeConnected(ctx.world, type, { minDist: 2, maxDist: 9, player: pl, splitRoads: true });
        if (placed) return true;
        this.wait(type, 10);
      }
      this.wait("mine", 2);
    }
    return false;
  }
}
