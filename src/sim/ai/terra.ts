import { BUILDINGS, buildingType, goodId } from "../econ/defs";
import { placeOn } from "../econ/planner";
import { BLOOM } from "../climate/atmosphere";
import type { AiContext } from "./brain";

/**
 * The scripted AI's terraforming: on a world whose air, warmth, water or life fall short of a living
 * world's, it raises the works that mend what is short (mirrors for cold, stacks for thin air, comet
 * catchers and basins for water, seed houses for cover) and, where native life stands, a gene bank and a
 * reserve to keep it. On a world that is already alive it has nothing to do. Only buildings, so only
 * orders a player can give; the materials must already be in its stores.
 */
export class TerraPlanner {
  constructor(private readonly player: number) {}

  private readonly rest = new Map<string, number>();
  private thoughts = 0;

  private can(key: string): boolean {
    return (this.rest.get(key) ?? 0) <= this.thoughts;
  }

  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const w = ctx.world;
    const eco = ctx.eco;
    const pl = this.player;
    // Works are for colonies that have taken root; a home world already blooms and refuses them.
    if (!eco.colony || !eco.rooted[pl]) return false;
    const atm = w.atmosphere;
    const check = atm.check();
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    // Works are begun between other sites, never a third at once.
    if (mine.filter((b) => !b.built).length > 1) return false;
    const count = (id: string) => mine.filter((b) => b.def.id === id).length;
    const stock = eco.storageTotals(pl);
    const affordable = (type: string) => {
      const def = BUILDINGS[buildingType(type)];
      return !!def && Object.entries(def.cost).every(([g, n]) => (stock[goodId(g)] ?? 0) >= (n as number) + 2) && (!def.tool || (stock[goodId(def.tool)] ?? 0) >= 1);
    };
    const wants: [boolean, string][] = [
      [!check.temp && atm.meanTemp() < BLOOM.temp[0] && count("mirrorworks") < 2, "mirrorworks"],
      [!check.pressure && atm.pressure < BLOOM.pressure[0] && count("greenhouseworks") < 2, "greenhouseworks"],
      [!check.water && count("cometcatcher") < 1, "cometcatcher"],
      [!check.water && count("lakebasin") < 2, "lakebasin"],
      [!check.water && count("cloudseeder") < 1, "cloudseeder"],
      [!check.life && count("seedhouse") < 2, "seedhouse"],
      [atm.native && !atm.banked && count("genebank") < 1, "genebank"],
      [atm.native && count("reserve") < 2, "reserve"],
    ];
    for (const [cond, type] of wants) {
      if (!cond || !this.can(type) || !affordable(type)) continue;
      this.rest.set(type, this.thoughts + 12);
      // Works need room (the big ones a level site), so look across the whole settlement, nearest first.
      const keep = eco.buildings[eco.keeps[pl] ?? -1];
      const land = w.land;
      const tiles = land.ring(keep?.tile ?? 0, 16).filter((t) => land.territory[t] === pl + 1 && land.isLand(t));
      if (placeOn(w, type, tiles, pl, true, 40) >= 0) return true;
    }
    return false;
  }
}
