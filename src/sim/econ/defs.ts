import content from "../data/content.json";

/** Game content loaded from data. Goods and building types are referred to by index at runtime. */

export interface GoodDef {
  id: string;
  name: string;
}

export type JobKind = "fell" | "plant" | "quarry" | "craft";

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  large?: boolean;
  storage?: boolean;
  buildable?: boolean;
  /** Construction materials by good id. */
  cost: Record<string, number>;
  job?: JobKind;
  radius?: number;
  workTicks?: number;
  restTicks?: number;
  produces?: string;
  /** Inputs consumed per unit of output. */
  inputs?: Record<string, number>;
  /** How many of each input the building keeps in stock. */
  inputStock?: number;
}

export const GOODS: readonly GoodDef[] = content.goods;
export const BUILDINGS: readonly BuildingDef[] = content.buildings as BuildingDef[];
export const START = content.start as { settlers: number; stock: Record<string, number>; territoryRadius: number };

export const GOOD_INDEX = new Map(GOODS.map((g, i) => [g.id, i]));
export const BUILDING_INDEX = new Map(BUILDINGS.map((b, i) => [b.id, i]));

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

/** Map a { goodId: count } record to a dense array indexed by good. */
export function goodsArray(rec: Record<string, number> | undefined): number[] {
  const out = new Array<number>(GOODS.length).fill(0);
  if (rec) for (const [k, v] of Object.entries(rec)) out[goodId(k)] = v;
  return out;
}
