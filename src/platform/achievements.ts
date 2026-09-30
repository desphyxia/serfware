import { YEAR_DAYS } from "../sim/climate/climate";
import { Feature } from "../sim/econ/landuse";
import type { World } from "../sim/world";

export interface Achievement {
  /** Id as configured in Steamworks (API name). */
  id: string;
  name: string;
  description: string;
  test(w: World, player: number): boolean;
}

const built = (w: World, player: number, id: string) => w.economy.buildings.some((b) => b.alive && b.built && b.owner === player && b.def.id === id);

/** Milestones in play. The same list drives Steam achievements and the web build's toasts. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "FIRST_ROAD", name: "First Steps", description: "Build a road between two flags.", test: (w, p) => w.economy.roads.some((r) => r.alive && r.owner === p) },
  { id: "FIRST_HOUSE", name: "A Place to Live", description: "Build a house.", test: (w, p) => built(w, p, "house") },
  { id: "FIRST_LIGHT", name: "First Light", description: "Light a lantern and push your border out.", test: (w, p) => w.economy.buildings.some((b) => b.alive && b.lit && b.owner === p && b.def.slots && !w.economy.keeps.includes(b.id)) },
  { id: "BREAD", name: "Daily Bread", description: "Run a farm, a mill and a bakery.", test: (w, p) => built(w, p, "farm") && built(w, p, "mill") && built(w, p, "bakery") },
  { id: "TOOLS", name: "Smith's Craft", description: "Forge tools at a toolsmith.", test: (w, p) => built(w, p, "toolsmith") && w.economy.buildings.some((b) => b.alive && b.owner === p && b.def.id === "toolsmith" && b.output > 0) },
  { id: "WELL", name: "Bucket Line", description: "Dig a well to guard against fire.", test: (w, p) => built(w, p, "well") },
  { id: "VILLAGE", name: "Village", description: "Grow to fifty people.", test: (w, p) => w.economy.peopleOf(p).length >= 50 },
  { id: "FORESTER", name: "Keeper of the Woods", description: "Have a hundred trees on your land.", test: (w, p) => {
    const land = w.land;
    let n = 0;
    for (let t = 0; t < land.feature.length && n < 100; t++) if (land.feature[t] === Feature.Tree && land.territory[t] === p + 1) n++;
    return n >= 100;
  } },
  { id: "FULL_YEAR", name: "A Full Year", description: "See all four seasons turn.", test: (w) => w.tick >= w.economy.dayLength * YEAR_DAYS },
  { id: "VICTORY", name: "Last Light Standing", description: "Win a game.", test: (w, p) => w.economy.winner === p },
];

/** Achievements newly earned (not yet in `have`), in list order. */
export function newlyEarned(w: World, player: number, have: ReadonlySet<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.test(w, player));
}
