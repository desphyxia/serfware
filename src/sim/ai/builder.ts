import { BUILDINGS } from "../econ/defs";
import { Feature } from "../econ/landuse";
import { frontierTiles, placeConnected, placeOn } from "../econ/planner";
import { goodId } from "../econ/defs";
import type { Rng } from "../rng";
import type { World } from "../world";

const LANTERNS = new Set(BUILDINGS.filter((b) => b.slots).map((b) => b.id));

/**
 * AI rival, version 1: grows a settlement much like a careful player would. It keeps a small
 * number of construction sites going, builds the material and food chains, houses its people and
 * pushes its border outward with lanterns. It only issues ordinary commands, and runs inside the
 * simulation step, so every peer computes the same moves.
 */
export class AiBuilder {
  /** Ticks between decisions. */
  static readonly PERIOD = 120;

  constructor(
    readonly player: number,
    private readonly rng: Rng,
  ) {}

  private started = false;
  private thoughts = 0;

  /** Attack the nearest enemy lantern it can take with good odds, using as few wardens as it can. */
  private attack(w: World): boolean {
    const eco = w.economy;
    const pl = this.player;
    if (w.tick < eco.peaceUntil) return false;
    const targets = eco.buildings.filter((b) => b.alive && b.built && b.owner !== pl && b.def.light && !eco.defeated[b.owner] && !eco.attackBlocked(pl, b));
    for (const t of targets) {
      const pool = eco.attackersFor(pl, t).length;
      if (pool < 2) continue;
      for (let n = 2; n <= pool; n++) {
        if (eco.attackOdds(pl, t, n) >= 0.7) return w.command({ t: "attack", target: t.id, count: Math.min(pool, n + 1), player: pl }).ok;
      }
    }
    return false;
  }

  think(w: World): void {
    const eco = w.economy;
    const pl = this.player;
    if (!this.started) {
      // Lighter garrisons than a cautious player: this rival would rather grow.
      this.started = true;
      w.command({ t: "garrison", zone: "frontier", value: 0.4, player: pl });
      w.command({ t: "garrison", zone: "inland", value: 0.2, player: pl });
    }
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const sites = mine.filter((b) => !b.built).length;
    const stock = eco.storageTotals(pl);
    const plank = stock[goodId("plank")] ?? 0;
    const stone = stock[goodId("stone")] ?? 0;
    const log = stock[goodId("log")] ?? 0;
    this.thoughts++;
    if (this.thoughts % 4 === 0 && this.attack(w)) return;
    if (sites >= 3 || (sites >= 1 && plank < 2)) return;
    // Keep enough hands free: when nobody is idle, build homes before anything else.
    const idle = eco.population(pl).idle;
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const lanterns = mine.filter((b) => LANTERNS.has(b.def.id)).length;
    const people = eco.peopleOf(pl).length;
    const wants: (() => boolean)[] = [];
    const want = (cond: boolean, fn: () => boolean) => {
      if (cond) wants.push(fn);
    };
    const near = (type: string, feature?: Feature, max = 9) => () => placeConnected(w, type, { minDist: 2, maxDist: max, near: feature, player: pl, center: this.center(w), splitRoads: true });
    want(idle < 2 && plank >= 4 && count("house") < 2 + Math.floor(people / 6), near("house"));
    if (idle < 1) {
      for (const fn of wants) if (fn()) return;
      return;
    }
    want(count("woodcutter") < 1, near("woodcutter", Feature.Tree));
    want(count("quarry") < 1, near("quarry", Feature.Rock));
    want(count("sawmill") < 1, near("sawmill"));
    want(count("forester") < 1, near("forester", Feature.Tree));
    want(lanterns < 1 + Math.floor(mine.length / 5), () => this.expand(w, plank, stone));
    want(count("house") < Math.floor(people / 7) && plank >= 5, near("house"));
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
    want(count("pasture") < 1 && count("farm") > 1, near("pasture"));
    want(count("butcher") < 1 && count("pasture") > 0, near("butcher"));
    want(lanterns < 3 + Math.floor(mine.length / 3), () => this.expand(w, plank, stone));
    for (const fn of wants.slice(0, 5)) if (fn()) return;
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
