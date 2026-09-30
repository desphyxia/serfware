import { Biome } from "../planet/terrain";

/**
 * Regions: the game's biomes (Meadowlands, Canopy Deeps, …), each a family of terrain classes
 * with its own flora, fauna, palette and rules. Terrain biomes (planet/terrain.ts) describe the
 * ground; a region says which world it belongs to and what grows and lives there. Every land tile
 * belongs to exactly one region; water tiles to none (0).
 */
export enum Region {
  None = 0,
  Meadowlands = 1,
  CanopyDeeps = 2,
  RimefallTundra = 3,
  EmberglassSteppe = 4,
  SaltglassFlats = 5,
  TidewaterReach = 6,
  LumenMire = 7,
  Skyreef = 8,
}

export interface RegionRules {
  /** Field growth speed (1 = normal). */
  fieldGrowth: number;
  /** Tree growth speed (1 = normal). */
  treeGrowth: number;
  /** Wildlife the land carries (multiplier on the terrain's). */
  game: number;
  /** Chance a wild tree is an ancient giant (Canopy Deeps). */
  giants: number;
  /** Extra field growth next to a hedgerow. */
  hedgeBonus: number;
}

export interface RegionDef {
  id: Region;
  key: string;
  name: string;
  /** One line for the Almanac and the tile panel. */
  blurb: string;
  /** Built in which batch (regions from later batches use neutral rules until then). */
  batch: number;
  rules: RegionRules;
  /** Wildlife that lives here (render species ids). */
  fauna: readonly string[];
}

const NEUTRAL: RegionRules = { fieldGrowth: 1, treeGrowth: 1, game: 1, giants: 0, hedgeBonus: 0.15 };

export const REGIONS: Readonly<Record<Region, RegionDef>> = {
  [Region.None]: { id: Region.None, key: "none", name: "Open water", blurb: "", batch: 0, rules: NEUTRAL, fauna: [] },
  [Region.Meadowlands]: {
    id: Region.Meadowlands,
    key: "meadowlands",
    name: "Meadowlands",
    blurb: "Rolling grass, hedgerows and orchards: kind soil and a gentle start.",
    batch: 13,
    rules: { ...NEUTRAL, fieldGrowth: 1.1, hedgeBonus: 0.3 },
    fauna: ["deer", "sheep", "cow", "bees", "butterflies"],
  },
  [Region.CanopyDeeps]: {
    id: Region.CanopyDeeps,
    key: "canopy",
    name: "Canopy Deeps",
    blurb: "Ancient giants over a dark, mossy floor. Timber without end, if you dare to take it.",
    batch: 13,
    rules: { ...NEUTRAL, fieldGrowth: 0.75, treeGrowth: 1.3, game: 1.25, giants: 0.3 },
    fauna: ["deer", "fireflies", "gliders"],
  },
  [Region.RimefallTundra]: { id: Region.RimefallTundra, key: "rimefall", name: "Rimefall Tundra", blurb: "Frozen plains and a short growing season.", batch: 14, rules: { ...NEUTRAL, fieldGrowth: 0.7 }, fauna: ["deer"] },
  [Region.EmberglassSteppe]: { id: Region.EmberglassSteppe, key: "emberglass", name: "Emberglass Steppe", blurb: "Dry grass and ore-rich, warm ground.", batch: 14, rules: { ...NEUTRAL, fieldGrowth: 0.85 }, fauna: ["deer"] },
  [Region.SaltglassFlats]: {
    id: Region.SaltglassFlats,
    key: "saltglass",
    name: "Saltglass Flats",
    blurb: "Salt pans and crystal spires under a hard sun. Work by night, water by dew, and watch for sandstorms.",
    batch: 15,
    rules: { ...NEUTRAL, fieldGrowth: 0.5, treeGrowth: 0.6, game: 0.5 },
    fauna: [],
  },
  [Region.TidewaterReach]: {
    id: Region.TidewaterReach,
    key: "tidewater",
    name: "Tidewater Reach",
    blurb: "Beaches and tidal flats the moons flood twice a day. Causeways, stilts and shellfish.",
    batch: 15,
    rules: NEUTRAL,
    fauna: ["gulls"],
  },
  [Region.LumenMire]: {
    id: Region.LumenMire,
    key: "lumen",
    name: "Lumen Mire",
    blurb: "Glowing fens of reed and peat in the twilight. Light is scarce: grow glowcaps, and they light the way.",
    batch: 16,
    rules: { ...NEUTRAL, fieldGrowth: 0.8, game: 1.1 },
    fauna: ["fireflies"],
  },
  [Region.Skyreef]: {
    id: Region.Skyreef,
    key: "skyreef",
    name: "Skyreef",
    blurb: "The highest peaks, where buoyant stone lifts off into the sky and drifts on the high winds.",
    batch: 16,
    rules: { ...NEUTRAL, fieldGrowth: 0.6, treeGrowth: 0.7 },
    fauna: ["gliders"],
  },
};

/**
 * Which region a land tile belongs to, from its terrain class, temperature (°C), moisture (0..1)
 * and whether it is on the coast.
 */
export function regionFor(biome: Biome, temperature: number, moisture: number, coastal: boolean, height = 0): Region {
  // The highest peaks, where buoyant stone lifts off the mountains into the sky.
  if (height > 0.7 && (biome === Biome.Rock || biome === Biome.Snow)) return Region.Skyreef;
  switch (biome) {
    case Biome.DeepSea:
    case Biome.Sea:
    case Biome.Shallows:
      return Region.None;
    case Biome.DeepForest:
      return temperature >= 10 && moisture > 0.66 ? Region.CanopyDeeps : Region.Meadowlands;
    case Biome.Snow:
    case Biome.Tundra:
      return Region.RimefallTundra;
    case Biome.Desert:
      return Region.SaltglassFlats;
    case Biome.Steppe:
      return temperature > 16 ? Region.EmberglassSteppe : Region.Meadowlands;
    case Biome.Rock:
      return temperature < 4 ? Region.RimefallTundra : Region.EmberglassSteppe;
    case Biome.Marsh:
      return Region.LumenMire;
    case Biome.Beach:
      return coastal ? Region.TidewaterReach : Region.Meadowlands;
    default:
      return Region.Meadowlands;
  }
}
