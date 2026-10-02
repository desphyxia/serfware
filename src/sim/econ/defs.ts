import content from "../data/content.json";

/** Game content loaded from data. Goods and building types are referred to by index at runtime. */

export interface GoodDef {
  id: string;
  name: string;
  /** Interchangeable group, e.g. bread, fish and meat are all "food". */
  group?: string;
  tool?: boolean;
  /** Carried by wardens: blade, bow, mount. */
  arms?: boolean;
}

export type JobKind = "fell" | "plant" | "quarry" | "craft" | "farm" | "fish" | "mine" | "hunt" | "orchard" | "bees" | "shellfish" | "fungus" | "peat" | "ropeway" | "excavate" | "explore";
export type Category = "storage" | "materials" | "food" | "metal" | "lantern" | "terra" | "decor";
/** Terraforming works: what one work cycle does to a planet (see sim/climate/atmosphere). */
export type TerraKind = "mirror" | "greenhouse" | "comet" | "seeding" | "basin" | "life" | "bank";

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: Category;
  large?: boolean;
  storage?: boolean;
  buildable?: boolean;
  /** Construction materials by good id. */
  cost: Record<string, number>;
  job?: JobKind;
  /** Tool the worker needs (and keeps while employed). */
  tool?: string;
  /** Placement rule beyond flat land. */
  terrain?: "mountain" | "coast" | "aquifer" | "giant" | "vent" | "saltpan" | "skyreef";
  /** Mines: which deposit they dig. */
  resource?: "coal" | "iron" | "gold" | "granite";
  radius?: number;
  /** Sight over land and sea, in steps, without holding territory (a lighthouse). */
  sight?: number;
  workTicks?: number;
  restTicks?: number;
  /** A good id, or "tool" for the toolsmith (chosen by tool priority). */
  produces?: string;
  /** Inputs consumed per unit of output. Keys may be a good id or a group ("food"). */
  inputs?: Record<string, number>;
  /** How many of each input the building keeps in stock. */
  inputStock?: number;
  /** Mines: outputs per food eaten. */
  foodPer?: number;
  /** Lantern buildings: light radius in tiles once a warden is inside. */
  light?: number;
  /** Houses people (treehouses count as houses). */
  home?: boolean;
  /** Wells: quench fires and protect buildings within this many steps. */
  well?: boolean;
  /** Burns coal or wood at work: soot on the walls, embers up the chimney. */
  forge?: boolean;
  /** Keeps people warm within this many steps (a hearth; a waystation only while it burns fuel). */
  warmth?: number;
  /** Burns a unit of fuel (log or coal) every few hours in the cold to keep its warmth. */
  heated?: boolean;
  /** Lantern buildings: warden places. */
  slots?: number;
  /** Works only while the sun is up (solar kilns, salt pans). */
  daylight?: boolean;
  /** Dew condensers: water for fields within three steps (and quenching, like a well). */
  dew?: boolean;
  /** Tide mills: grind only while the tide runs (not at the slack of high or low water). */
  tidal?: boolean;
  /** Decorations: beauty they add to Glow. */
  beauty?: number;
  /** Terraforming works: each work cycle feeds the planet's atmosphere or life. Colonies only. */
  terra?: TerraKind;
  /** Reserves: native life within this many steps is left as it is, whatever the air becomes. */
  reserve?: number;
  /** Launch rails: a mass driver that loads cargo for voyages to other planets. */
  rail?: boolean;
  /** Solar kilns: now and then the focused heat sets dry growth next door alight. */
  fireRisk?: number;
  /** Mod buildings: which base building's model to borrow. */
  looks?: string;
}

export const GOODS: readonly GoodDef[] = content.goods as GoodDef[];
export const BUILDINGS: readonly BuildingDef[] = content.buildings as BuildingDef[];
export const START = content.start as { settlers: number; stock: Record<string, number>; territoryRadius: number; garrison: { frontier: number; inland: number } };
export const COMBAT = content.combat as {
  ranks: string[];
  reach: number;
  duelTicks: number;
  strandedDays: number;
  woundedDays: number;
  peaceDays: number;
  wellsToWin: number;
  wellHoldDays: number;
};
export const DEFAULT_DISTRIBUTION = content.distribution as Record<string, Record<string, number>>;
export const DEFAULT_TOOL_PRIORITY = content.toolPriority as Record<string, number>;

export const GOOD_INDEX = new Map(GOODS.map((g, i) => [g.id, i]));
export const BUILDING_INDEX = new Map(BUILDINGS.map((b, i) => [b.id, i]));
export const TOOLS: readonly number[] = GOODS.map((g, i) => (g.tool ? i : -1)).filter((i) => i >= 0);

export function goodId(id: string): number {
  const i = GOOD_INDEX.get(id);
  if (i === undefined) throw new Error(`Unknown good ${id}`);
  return i;
}

export function buildingType(id: string): number {
  const i = BUILDING_INDEX.get(id);
  if (i === undefined) throw new Error(`Unknown building ${id}`);
  return i;
}

/** Map a { goodId: count } record to a dense array indexed by good. Group keys are skipped. */
export function goodsArray(rec: Record<string, number> | undefined): number[] {
  const out = new Array<number>(GOODS.length).fill(0);
  if (rec) for (const [k, v] of Object.entries(rec)) if (GOOD_INDEX.has(k)) out[goodId(k)] = v;
  return out;
}

/** Goods that satisfy an input key: the good itself, or every member of a group. */
export function goodsFor(key: string): number[] {
  if (GOOD_INDEX.has(key)) return [goodId(key)];
  return GOODS.map((g, i) => (g.group === key ? i : -1)).filter((i) => i >= 0);
}

/** The input key (good id or group) a good type satisfies for a building, if any. */
export function inputKeyFor(def: BuildingDef, type: number): string | null {
  if (!def.inputs) return null;
  const g = GOODS[type];
  if (!g) return null;
  if (g.id in def.inputs) return g.id;
  if (g.group && g.group in def.inputs) return g.group;
  return null;
}

/** Distribution key for a good: its group if it has one (food), else its id. */
export function distributionKey(type: number): string {
  const g = GOODS[type];
  return g?.group ?? g?.id ?? "";
}
