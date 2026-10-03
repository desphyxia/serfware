import { BUILDINGS, buildingType, goodId } from "../econ/defs";
import { placeOn } from "../econ/planner";
import { Region } from "../biomes/regions";
import type { AiContext } from "./brain";

/** One building a region's land calls for, and when this settlement wants it. */
interface Call {
  type: string;
  /** The region whose tiles it stands on (or "coast" for shore sites). */
  where: Region | "coast";
  /** How many the settlement of `built` buildings wants, given what it has. */
  want: (have: (id: string) => number, built: number) => number;
  /** Housing is not a luxury: wanted before the toolsmith stands. */
  early?: boolean;
}

const CALLS: Call[] = [
  // Canopy Deeps: houses in the giants.
  { type: "treehouse", where: Region.CanopyDeeps, want: (_, b) => Math.floor(b / 6), early: true },
  // Rimefall Tundra: a heated waystation for the cold.
  { type: "waystation", where: Region.RimefallTundra, want: (_, b) => 1 + Math.floor(b / 25) },
  // Emberglass Steppe: a greenhouse on the vents once farms feed the town.
  { type: "greenhouse", where: Region.EmberglassSteppe, want: (h) => (h("farm") > 0 ? 1 : 0) },
  // Saltglass Flats: salt, glass, and water from the air.
  { type: "saltworks", where: Region.SaltglassFlats, want: () => 1 },
  { type: "solarkiln", where: Region.SaltglassFlats, want: (h) => (h("saltworks") > 0 ? 1 : 0) },
  { type: "dewcondenser", where: Region.SaltglassFlats, want: (_, b) => 1 + Math.floor(b / 25) },
  // Tidewater Reach: a tide mill beside the mill's grain, and shellfish.
  { type: "tidemill", where: Region.TidewaterReach, want: (h) => (h("mill") > 0 ? 1 : 0) },
  { type: "shellfisher", where: Region.TidewaterReach, want: () => 1 },
  // Lumen Mire: glowcap farms for food, and peat for fuel.
  { type: "glowcapfarm", where: Region.LumenMire, want: () => 1 },
  { type: "peatcutter", where: Region.LumenMire, want: (h) => (h("smelter") + h("goldsmith") > 0 ? 1 : 0) },
  // Skyreef: ropeways bring down the skystone.
  { type: "ropeway", where: Region.Skyreef, want: (_, b) => 1 + Math.floor(b / 20) },
  // Any shore: a lighthouse once a boatyard stands, to see further over the water.
  { type: "lighthouse", where: "coast", want: (h) => (h("boatyard") > 0 ? 1 : 0) },
];

/**
 * The scripted AI's answer to the land it holds: the buildings only some regions have a use for. It looks at
 * what its own territory contains, wants each region's building when it can use it, and lets the site rules
 * decide where it goes. One order at most per step, and a kind that finds no room waits a while.
 */
export class BiomePlanner {
  constructor(private readonly player: number) {}

  private readonly rest = new Map<string, number>();
  private thoughts = 0;

  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const w = ctx.world;
    const eco = ctx.eco;
    const land = w.land;
    const pl = this.player;
    const mine = eco.buildings.filter((b) => b.alive && b.owner === pl);
    if (mine.filter((b) => !b.built).length > 1) return false;
    const built = mine.filter((b) => b.built).length;
    const have = (id: string) => mine.filter((b) => b.def.id === id).length;
    // Only once the basics stand, a toolsmith among them (housing excepted).
    const basics = have("toolsmith") >= 1;
    const stock = eco.storageTotals(pl);
    const keep = eco.buildings[eco.keeps[pl] ?? -1];
    const c = land.planet.grid.center;
    const away = (t: number) => (c[t * 3]! - c[(keep?.tile ?? t) * 3]!) ** 2 + (c[t * 3 + 1]! - c[(keep?.tile ?? t) * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[(keep?.tile ?? t) * 3 + 2]!) ** 2;
    const own: number[] = [];
    for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === pl + 1 && land.isLand(t)) own.push(t);
    for (const call of CALLS) {
      if ((!basics && !call.early) || (this.rest.get(call.type) ?? 0) > this.thoughts || have(call.type) >= call.want(have, built)) continue;
      const def = BUILDINGS[buildingType(call.type)];
      if (!def || !Object.entries(def.cost).every(([g, n]) => (stock[goodId(g)] ?? 0) >= (n as number) + 1)) continue;
      if (def.tool && (stock[goodId(def.tool)] ?? 0) < 1) continue;
      const tiles = own.filter((t) => (call.where === "coast" ? land.isCoast(t) : land.region[t] === call.where)).sort((a, b) => away(a) - away(b) || a - b);
      this.rest.set(call.type, this.thoughts + (tiles.length ? 30 : 120));
      if (tiles.length && placeOn(w, call.type, tiles, pl, true, 30) >= 0) return true;
    }
    return false;
  }
}
