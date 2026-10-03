import { BUILDINGS, GOODS, TOOLS } from "../econ/defs";
import { Feature } from "../econ/landuse";
import { clearForest, frontierTiles, placeConnected, placeOn } from "../econ/planner";
import { goodId } from "../econ/defs";
import type { Rng } from "../rng";
import type { World } from "../world";
import type { TreatyKind } from "../econ/diplomacy";
import { AI_LEVELS, type AiLevel, type Personality } from "./personality";
import type { AiContext, Brain } from "./brain";
import { SeaPlanner } from "./sea";

const LANTERNS = new Set(BUILDINGS.filter((b) => b.slots).map((b) => b.id));

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
  ) {
    this.sea = new SeaPlanner(player, personality);
  }

  private readonly sea: SeaPlanner;
  private started = false;
  private thoughts = 0;
  /** Wishes that found no site lately, and the thought they may be tried again. */
  private readonly resting = new Map<string, number>();

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
        if (odds < AI_LEVELS[this.level].odds) continue;
        const held = eco.defendersOf(t).length;
        if (!best || held < best.held || (held === best.held && odds > best.odds)) best = { t, count: Math.min(pool, n + 1), held, odds };
        break;
      }
    }
    return best ? w.command({ t: "attack", target: best.t.id, count: best.count, player: pl }).ok : false;
  }

  /** Tools in demand for the buildings it has or is building, and their stock: set the toolsmith's priorities to match. */
  private tools(w: World): void {
    const eco = w.economy;
    const pl = this.player;
    const stock = eco.storageTotals(pl);
    const need = new Map<string, number>();
    for (const b of eco.buildings) if (b.alive && b.owner === pl && b.def.tool && (!b.built || b.worker < 0)) need.set(b.def.tool, (need.get(b.def.tool) ?? 0) + 1);
    const prefs = eco.prefs[pl];
    if (!prefs) return;
    for (const t of TOOLS) {
      const id = GOODS[t]?.id ?? "";
      const have = stock[t] ?? 0;
      const wanted = need.get(id) ?? 0;
      // Short of a tool somebody is waiting for: make it first. Out of a basic tool: keep one in hand.
      const value = wanted > have ? 1 : have < 1 ? 0.4 : 0.1;
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

  think(ctx: AiContext): void {
    const w = ctx.world;
    const eco = w.economy;
    const pl = this.player;
    if (!this.started) {
      // Lighter garrisons than a cautious player: this rival would rather grow.
      this.started = true;
      // Wardens hold the border in full and the interior thin, as Settlers 2's AI does; the others keep lighter garrisons.
      const [frontier, inland] = this.personality === "warden" ? [1, 0.25] : this.personality === "trader" ? [0.3, 0.15] : [0.4, 0.2];
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
    if (this.thoughts % 6 === 3) this.talk(w);
    if (this.thoughts % 4 === 1) this.tools(w);
    if (this.thoughts % 10 === 5) this.tidy(w);
    // Wardens look for a fight often, Traders seldom, Builders hardly ever.
    const temper = this.personality === "warden" ? 3 : this.personality === "trader" ? 8 : 12;
    if (this.thoughts % temper === 0 && this.attack(w)) return;
    if (sites >= lv.sites || (sites >= 1 && plank < 2)) return;
    // Keep enough hands free: when nobody is idle, build homes before anything else.
    const idle = eco.population(pl).idle;
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const lanterns = mine.filter((b) => LANTERNS.has(b.def.id)).length;
    const people = eco.peopleOf(pl).length;
    const wants: { key: string; fn: () => boolean }[] = [];
    const want = (cond: boolean, w: { key: string; fn: () => boolean }) => {
      if (cond) wants.push(w);
    };
    const near = (type: string, feature?: Feature, max = 9) => ({ key: type, fn: () => placeConnected(w, type, { minDist: 2, maxDist: max, near: feature, player: pl, center: this.center(w), splitRoads: true }) });
    const grow = () => ({ key: "expand", fn: () => this.expand(w, plank, stone) });
    // Try the wishes in order; one that finds no site steps aside for a while, so a cramped spot
    // (no room for a sawmill, say) never stops everything after it, such as pushing the border out.
    const attempt = (list: typeof wants, tries: number) => {
      for (const x of list) {
        if ((this.resting.get(x.key) ?? 0) > this.thoughts) continue;
        if (x.fn()) return true;
        this.resting.set(x.key, this.thoughts + 6);
        if (--tries <= 0) return false;
      }
      return false;
    };
    want(idle < 2 && plank >= 4 && count("house") < 2 + Math.floor(people / 6), near("house"));
    if (idle < 1) {
      attempt(wants, wants.length);
      return;
    }
    want(count("woodcutter") < 1, near("woodcutter", Feature.Tree));
    want(count("quarry") < 1, near("quarry", Feature.Rock));
    want(count("sawmill") < 1, near("sawmill"));
    want(count("forester") < 1, near("forester", Feature.Tree));
    want(lanterns < 1 + Math.floor(mine.length / 5), grow());
    want(count("house") < Math.floor(people / 7) && plank >= 5, near("house"));
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
    want(count("toolsmith") < 1 && count("sawmill") > 0 && count("quarry") > 0 && mine.length >= 8, near("toolsmith"));
    want(count("pasture") < 1 && count("farm") > 1, near("pasture"));
    want(count("butcher") < 1 && count("pasture") > 0, near("butcher"));
    // Temperament: Builders make their town pleasant; Wardens arm.
    want(this.personality === "builder" && count("flowerbed") < Math.floor(mine.length / 10), near("flowerbed"));
    want(this.personality === "builder" && count("bench") < Math.floor(mine.length / 14), near("bench"));
    want(this.personality === "warden" && count("toolsmith") > 0 && count("weaponsmith") < 1, near("weaponsmith"));
    // Idle hands and no room to grow: more woodcutters and quarries clear the forest and rocks that box a
    // settlement in, and give those hands work.
    want(idle >= 6 && count("woodcutter") < 2 + Math.floor(idle / 8), near("woodcutter", Feature.Tree));
    want(idle >= 6 && count("quarry") < 2 + Math.floor(idle / 12), near("quarry", Feature.Rock));
    want(lanterns < 3 + Math.floor(mine.length / 3), grow());
    // Nothing could be placed with hands idle: perhaps forest or rock has boxed the settlement in.
    if (!attempt(wants, lv.wants) && idle >= 6 && (this.resting.get("clear") ?? 0) <= this.thoughts) {
      const did = clearForest(w, pl);
      if (!did) this.resting.set("clear", this.thoughts + 12);
      // With a forester taken down, no new one until the way is clear.
      if (did === "forester") {
        this.resting.set("forester", this.thoughts + 60);
        this.resting.set("clear", this.thoughts + 12);
      }
    }
  }

  /** Diplomacy: offer what this temperament wants, and get its prisoners home. */
  private talk(w: World): void {
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
  private expand(w: World, plank: number, stone: number): boolean {
    const pl = this.player;
    const type = plank >= 6 && stone >= 9 ? "beacon" : plank >= 3 && stone >= 3 ? "lamphouse" : "lantern";
    return placeOn(w, type, frontierTiles(w, pl, () => this.rng.next() * 3).slice(0, 40), pl, true, 12) >= 0;
  }
}
