import { goodId } from "../econ/defs";
import { placeConnected } from "../econ/planner";
import { MIN_FOUNDERS } from "../system/voyages";
import type { AiContext } from "./brain";

const SETTLERS = 12;
/**
 * Goods a Hearthship takes besides its founders (mass 3 each): materials, the tools the first trades need (a colony
 * with no hammer builds nothing), and some bread. The stores must hold them first.
 */
const CARGO = { plank: 12, stone: 8, log: 6, hammer: 2, axe: 2, pick: 1, saw: 1, shovel: 1, scythe: 1, bread: 8 };

/**
 * The scripted AI's voyages, for any seat (people's, a steward's, or an AI rival's): a launch
 * rail, probes to survey the other worlds, a Hearthship to the best surveyed one, the landing site, and a
 * skyship route of bread to the colony while home can spare it. It never founds a colony from a small
 * settlement, because the colony is not managed once it lands.
 */
export class VoyagePlanner {
  /** A colony is founded only from a settlement this grown, with this many idle hands to spare (tests lower it). */
  static found = { population: 70, idle: 14 };

  constructor(private readonly player: number) {}

  private readonly rest = new Map<string, number>();
  private thoughts = 0;

  private can(key: string): boolean {
    return (this.rest.get(key) ?? 0) <= this.thoughts;
  }

  private wait(key: string, thoughts: number): void {
    this.rest.set(key, this.thoughts + thoughts);
  }

  /** Whether this seat can give voyage orders at all. */
  static allowed(ctx: AiContext): boolean {
    return !!ctx.world.voyages && ctx.player < ctx.world.players;
  }

  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const w = ctx.world;
    const voyages = w.voyages;
    if (!voyages || !VoyagePlanner.allowed(ctx)) return false;
    const eco = ctx.eco;
    const pl = this.player;
    const sys = w.system;
    const home = sys.home;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const stock = eco.storageTotals(pl);
    const have = (id: string, n: number) => (stock[goodId(id)] ?? 0) >= n;

    // The launch rail comes first.
    const rail = voyages.railOf(pl, home);
    if (!rail) {
      if (mine.some((b) => b.def.rail || !b.built) || !this.can("rail")) return false;
      if (mine.filter((b) => b.built).length < 30 || !have("iron", 6) || !have("plank", 8) || !have("stone", 10)) return false;
      this.wait("rail", 15);
      return placeConnected(w, "launchrail", { minDist: 2, maxDist: 9, player: pl, splitRoads: true });
    }

    const inFlight = (kind: string, to: number) => voyages.list.some((v) => v.owner === pl && v.kind === kind && v.to === to && v.state !== "done");

    // A Hearthship in orbit waits for a landing site.
    for (const v of voyages.list) {
      if (v.owner !== pl || v.kind !== "hearthship" || v.state !== "orbit") continue;
      const tile = this.site(w.colonize(v.to));
      return tile >= 0 && ctx.act({ t: "land", voyage: v.id, tile }).ok;
    }

    // Probes to every world with ground that nobody has surveyed.
    if (this.can("probe") && have("iron", 2) && have("plank", 2)) {
      const target = sys.planets.find((p) => p.surface && p.index !== home && !voyages.isSurveyed(pl, p.index) && !inFlight("probe", p.index));
      this.wait("probe", 10);
      if (target && ctx.act({ t: "probe", from: home, to: target.index }).ok) return true;
    }

    // A colony, from a grown settlement with hands to spare, on the surveyed world nearest home's gravity.
    const pop = eco.population(pl);
    const people = pop.idle + pop.working;
    if (this.can("hearthship") && people >= VoyagePlanner.found.population && pop.idle >= VoyagePlanner.found.idle && have("plank", 30) && have("stone", 12) && have("log", 10) && have("iron", 6) && Object.entries(CARGO).every(([g, n]) => have(g, n))) {
      const g = sys.planets[home]!.gravity;
      const target = sys.planets
        .filter((p) => p.surface && p.index !== home && voyages.isSurveyed(pl, p.index) && w.economyAt(p.index)?.keeps[pl] === undefined && !inFlight("hearthship", p.index))
        .sort((a, b) => Math.abs(a.gravity - g) - Math.abs(b.gravity - g) || a.index - b.index)[0];
      this.wait("hearthship", 40);
      if (target && ctx.act({ t: "hearthship", from: home, to: target.index, settlers: Math.max(MIN_FOUNDERS, SETTLERS), cargo: CARGO }).ok) return true;
    }

    // Skyships carry bread to a colony while home has some to spare; the route stops when home runs short.
    if (this.can("route")) {
      this.wait("route", 8);
      for (const p of sys.planets) {
        if (p.index === home || w.economyAt(p.index)?.keeps[pl] === undefined) continue;
        const route = voyages.routes.find((r) => r.owner === pl && r.active && r.to === p.index);
        if (!route && have("bread", 12) && ctx.act({ t: "route", from: home, to: p.index, good: "bread", amount: 8 }).ok) return true;
        if (route && !have("bread", 3) && ctx.act({ t: "unroute", route: route.id }).ok) return true;
      }
    }
    return false;
  }

  /** The flattest, most temperate landing tile on a world (the way a player's eye picks one). */
  private site(eco: ReturnType<AiContext["world"]["colonize"]>): number {
    const grid = eco.land.planet.grid;
    let best = -1;
    let bestScore = -Infinity;
    for (let t = 0; t < grid.count; t++) {
      if (eco.landingProblem(t)) continue;
      const flat = eco.land.ring(t, 5).filter((n) => eco.land.isLand(n) && eco.land.slope(n) < 1.2).length;
      const score = flat - Math.abs(grid.center[t * 3 + 1] as number) * 40;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}
