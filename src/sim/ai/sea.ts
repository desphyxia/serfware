import { BUILDINGS, buildingType, goodId, type BuildingDef } from "../econ/defs";
import type { Building } from "../econ/economy";
import { placeOn } from "../econ/planner";
import type { AiContext } from "./brain";
import type { Personality } from "./personality";

/** A free shore is worth settling if at least this much unclaimed land lies around it. */
const MIN_SCORE = 10;
/** Quays a settlement keeps ferrying from, at most, before it stops founding more. */
const MAX_FOOTHOLDS = 4;

/**
 * The scripted AI's dealings with water: a boatyard to chart the sea, a quay on its own shore, and
 * footholds on free shores a ferry can reach (a harbour if they are further), then a lantern beside each
 * so the new land is held and grows like the home settlement does. It only gives the orders a player can.
 */
export class SeaPlanner {
  constructor(
    private readonly player: number,
    private readonly personality: Personality,
    /** How many buildings it wants before it looks beyond its own shore. */
    private readonly wantBuilt: number,
  ) {}

  private def(id: string): BuildingDef {
    return BUILDINGS[buildingType(id)] as BuildingDef;
  }

  /** Whether the AI is ready to look to the sea: grown enough, or with no border left to push out. */
  ready(ctx: AiContext, built: number, landLocked: boolean): boolean {
    return landLocked || built >= this.wantBuilt;
  }

  /** One step toward the sea. Returns true if an order was given. */
  step(ctx: AiContext): boolean {
    const eco = ctx.eco;
    const land = ctx.world.land;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    const stock = eco.storageTotals(pl);
    const have = (id: string, n = 1) => (stock[goodId(id)] ?? 0) >= n;
    const kind = (id: string) => mine.filter((b) => b.def.id === id);
    const waterworks = mine.filter((b) => b.def.ferry !== undefined || b.def.job === "explore" || b.def.sight);
    if (waterworks.some((b) => !b.built)) return false;
    // Never at the cost of the home economy: it needs planks in hand, and no more than one site going.
    if (!have("plank", 10) || mine.filter((b) => !b.built).length > 1) return false;
    const coast = () => {
      const out: number[] = [];
      for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === pl + 1 && land.isLand(t) && land.isCoast(t)) out.push(t);
      return out;
    };

    // A boatyard charts the sea; point it far.
    const yard = kind("boatyard")[0];
    if (!yard) {
      if (have("plank", 4) && placeOn(ctx.world, "boatyard", coast(), pl, true, 30) >= 0) return true;
      return false;
    }
    if (yard.built && yard.reach !== 2 && ctx.act({ t: "explore", building: yard.id, reach: 2 }).ok) return true;

    // A quay on the home shore to ferry from.
    const quays = mine.filter((b) => b.built && b.def.ferry !== undefined);
    if (!quays.length) {
      if (kind("quay").length) return false;
      if (have("plank", 3) && placeOn(ctx.world, "quay", coast(), pl, true, 30) >= 0) return true;
      return false;
    }

    // Land held across the water gets a lantern, so it is claimed and can grow.
    for (const q of quays) {
      const flag = eco.flags[q.flag];
      if (!flag || land.territory[q.tile] === 0) continue;
      const lit = mine.some((b) => b.def.slots && land.ring(q.tile, 5).includes(b.tile));
      if (!lit && this.isForeign(ctx, q) && placeOn(ctx.world, "lantern", land.ring(q.tile, 4).filter((t) => land.territory[t] === pl + 1 && land.isLand(t)), pl, true, 20) >= 0) return true;
    }

    // New footholds, a few at a time.
    if (this.footholds(ctx, quays) >= MAX_FOOTHOLDS) return false;
    const target = this.bestShore(ctx, quays, false);
    if (target) {
      if (!have("plank", 6)) return false;
      return ctx.act({ t: "build", type: "quay", tile: target.tile, flagTile: target.flag }).ok;
    }
    // Nothing a quay can reach: a harbour reaches further.
    const far = this.bestShore(ctx, quays, true);
    const old = quays.find((q) => q.def.id === "quay");
    if (far && old && have("plank", 4) && have("stone", 3)) return ctx.act({ t: "upgrade", building: old.id }).ok;
    return false;
  }

  /** A quay of mine on ground that was free when it went up (a foothold across the water). */
  private isForeign(ctx: AiContext, q: Building): boolean {
    const eco = ctx.eco;
    const keep = eco.buildings[eco.keeps[this.player] ?? -1];
    if (!keep) return false;
    // Footholds are the quays whose ferry is the only way home.
    return eco.roads.some((r) => r.alive && r.ferry && (r.a === q.flag || r.b === q.flag)) && !eco.land.ring(keep.tile, 9).includes(q.tile);
  }

  private footholds(ctx: AiContext, quays: Building[]): number {
    return quays.filter((q) => this.isForeign(ctx, q)).length;
  }

  /**
   * The free, explored shore with the most room around it that one of my quays' ferries can reach (or any
   * quay as a harbour, with `asHarbour`), clear of rivals.
   */
  private bestShore(ctx: AiContext, quays: Building[], asHarbour: boolean): { tile: number; flag: number; score: number } | null {
    const eco = ctx.eco;
    const land = ctx.world.land;
    const pl = this.player;
    const grid = land.planet.grid;
    const seen = eco.explored[pl] as Uint8Array | undefined;
    if (!seen) return null;
    const quayDef = this.def("quay");
    const harbourReach = this.def("harbour").ferry ?? 14;
    let best: { tile: number; flag: number; score: number } | null = null;
    const done = new Set<number>();
    for (const q of quays) {
      for (const t of land.ring(q.tile, asHarbour ? harbourReach + 3 : (q.def.ferry ?? 8) + 3)) {
        if (done.has(t)) continue;
        done.add(t);
        if (!seen[t] || land.territory[t] !== 0 || !land.isLand(t) || !land.isCoast(t)) continue;
        const flag = land.bestFlagTile(t, pl, true);
        if (flag < 0 || !land.canBuildDef(t, flag, quayDef, pl)) continue;
        // Room: free land around it; rivals nearby cost; a Star Well is worth a detour.
        let free = 0;
        let foreign = 0;
        let wells = 0;
        for (const n of land.ring(t, 5)) {
          if (land.isLand(n) && land.territory[n] === 0) free++;
          else if ((land.territory[n] as number) > 0 && land.territory[n] !== pl + 1) foreign++;
          if (grid.degree(n) === 5 && land.territory[n] === 0) wells++;
        }
        const score = free - foreign * 3 + wells * 10;
        if (score < MIN_SCORE || (best && score <= best.score)) continue;
        if (!asHarbour && eco.footholdSource(flag, pl) === undefined) continue;
        if (asHarbour) {
          // Only worth a harbour if one of my quays is not too far for it.
          const reach = eco.ferryRoute((eco.flags[q.flag] as { tile: number }).tile, flag, harbourReach);
          if (!reach) continue;
        }
        best = { tile: t, flag, score };
      }
    }
    return best;
  }
}
