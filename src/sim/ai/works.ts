import { BUILDINGS, buildingType, goodId } from "../econ/defs";
import { Feature, LandUse } from "../econ/landuse";
import { landmassOf, placeConnected, placeOn } from "../econ/planner";
import type { AiContext } from "./brain";
import type { Personality } from "./personality";

/** Land a pocket must hold before it is worth a bridge. */
const MIN_POCKET = 8;
/** Longest bridge, in tiles. */
const MAX_SPAN = 3;

/**
 * The scripted AI's public works: bridges that join pockets of its own land cut off by shallow water, the
 * pleasures that make a town (a maypole, a fountain, statues once relics are dug up, digsites at ruins), and
 * gifts of planks and stone to a poorer ally. Each step gives at most one order (a bridge is a few).
 */
export class WorksPlanner {
  constructor(
    private readonly player: number,
    private readonly personality: Personality,
  ) {}

  private readonly rest = new Map<string, number>();
  private thoughts = 0;

  private can(key: string): boolean {
    return (this.rest.get(key) ?? 0) <= this.thoughts;
  }

  private wait(key: string, thoughts: number): void {
    this.rest.set(key, this.thoughts + thoughts);
  }

  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const eco = ctx.eco;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const built = mine.filter((b) => b.built).length;
    const stock = eco.storageTotals(pl);
    const plank = stock[goodId("plank")] ?? 0;
    const stone = stock[goodId("stone")] ?? 0;
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const unbuilt = mine.filter((b) => !b.built).length;

    if (this.can("send") && this.send(ctx)) return true;
    if (plank >= 6 && this.can("bridge") && this.bridge(ctx)) return true;

    // Pleasures and digs, one site at a time, once the town has grown.
    if (unbuilt > 0 || built < 18) return false;
    const manned = (type: string) => {
      const tool = BUILDINGS[buildingType(type)]?.tool;
      return !tool || (stock[goodId(tool)] ?? 0) >= 1;
    };
    const sites: [boolean, string][] = [
      [this.personality !== "warden" && count("maypole") < 1 && plank >= 6, "maypole"],
      [this.personality !== "warden" && count("fountain") < 1 + Math.floor(built / 40) && stone >= 6 && plank >= 4, "fountain"],
      [count("statue") < Math.min(3, stock[goodId("relic")] ?? 0) && stone >= 6, "statue"],
      [count("digsite") < 1 && plank >= 6 && manned("digsite"), "digsite"],
    ];
    for (const [cond, type] of sites) {
      if (!cond || !this.can(type)) continue;
      this.wait(type, 20);
      const placed = type === "digsite" ? this.dig(ctx) : placeConnected(ctx.world, type, { minDist: 2, maxDist: 9, player: pl, splitRoads: true });
      if (placed) return true;
    }
    return false;
  }

  /** A digsite beside a ruin on my own land. */
  private dig(ctx: AiContext): boolean {
    const land = ctx.world.land;
    const pl = this.player;
    const ruins: number[] = [];
    for (let t = 0; t < land.feature.length; t++) if (land.feature[t] === Feature.Ruin && land.territory[t] === pl + 1) ruins.push(t);
    const near = ruins.flatMap((r) => land.ring(r, 3).filter((t) => land.territory[t] === pl + 1 && land.isLand(t)));
    return near.length > 0 && placeOn(ctx.world, "digsite", near, pl, true, 20) >= 0;
  }

  /** Planks and stone to an ally that is short of them while I have plenty. */
  private send(ctx: AiContext): boolean {
    const eco = ctx.eco;
    const pl = this.player;
    const mine = eco.storageTotals(pl);
    for (const q of eco.keeps.keys()) {
      if (q === pl || eco.keeps[q] === undefined || eco.defeated[q] || !eco.allied(pl, q)) continue;
      const theirs = eco.storageTotals(q);
      for (const [good, rich, poor] of [["plank", 30, 6], ["stone", 15, 3]] as const) {
        const id = goodId(good);
        if ((mine[id] ?? 0) >= rich && (theirs[id] ?? 0) < poor && ctx.act({ t: "send", to: q, good, count: 10 }).ok) {
          this.wait("send", 12);
          return true;
        }
      }
    }
    this.wait("send", 6);
    return false;
  }

  /**
   * Bridges over shallow water inside my border that join a pocket of my own land to the Hearthship's:
   * the shortest span of at most MAX_SPAN tiles, laid from the home shore outward.
   */
  private bridge(ctx: AiContext): boolean {
    const eco = ctx.eco;
    const land = ctx.world.land;
    const grid = land.planet.grid;
    const pl = this.player;
    this.wait("bridge", 10);
    const keep = eco.buildings[eco.keeps[pl] ?? -1];
    if (!keep) return false;
    const home = landmassOf(ctx.world, keep.tile);
    const pocketOf = (t: number) => landmassOf(ctx.world, t);
    // Breadth-first over open water from the home shore, in order, to a tile that touches other land of mine.
    const parent = new Map<number, number>();
    let front: number[] = [];
    for (const t of home) {
      if (land.territory[t] !== pl + 1) continue;
      for (const n of grid.neighborsOf(t)) {
        if (parent.has(n) || !this.span(ctx, n)) continue;
        parent.set(n, -1);
        front.push(n);
      }
    }
    for (let depth = 1; depth <= MAX_SPAN && front.length; depth++) {
      const next: number[] = [];
      for (const w of front) {
        for (const n of grid.neighborsOf(w)) {
          if (home.has(n) || land.territory[n] !== pl + 1 || !land.isLand(n)) continue;
          if (pocketOf(n).size < MIN_POCKET) continue;
          // Found: lay the bridge from the shore outward.
          const path: number[] = [];
          for (let x = w; x !== -1; x = parent.get(x) as number) path.unshift(x);
          let laid = 0;
          for (const tile of path) {
            if (!ctx.act({ t: "bridge", tile }).ok) break;
            laid++;
          }
          return laid > 0;
        }
        for (const n of grid.neighborsOf(w)) {
          if (parent.has(n) || !this.span(ctx, n)) continue;
          parent.set(n, w);
          next.push(n);
        }
      }
      front = next;
    }
    return false;
  }

  /** Open shallow water on my own land's border that a bridge could cross. */
  private span(ctx: AiContext, t: number): boolean {
    const land = ctx.world.land;
    return !land.isLand(t) && !land.isIce(t) && land.bridge[t] !== 1 && land.territory[t] === this.player + 1 && (land.planet.terrain.elevation[t] as number) >= LandUse.BRIDGE_DEPTH && land.planet.grid.degree(t) !== 5;
  }
}
