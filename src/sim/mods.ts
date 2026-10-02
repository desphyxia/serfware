import { BUILDINGS, BUILDING_INDEX, COMBAT, GOOD_INDEX, GOODS, START, TOOLS, type BuildingDef, type Category, type GoodDef, type JobKind } from "./econ/defs";
import type { StateHasher } from "./hash";

/**
 * Mods: packs of data that add goods and buildings, change existing ones, rename and retune the
 * warden ranks (the game's units) and change the start. A pack is plain JSON, so it travels in
 * saves, multiplayer starts and the Steam Workshop. Mods only ever append goods and buildings,
 * so the base game's indices (and every save without mods) are unchanged.
 */
export interface ModPack {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  goods?: GoodDef[];
  /** New buildings. `looks` borrows the model of an existing building (else a house). */
  buildings?: BuildingDef[];
  /** Changes to existing goods and buildings by id (costs, work times, light, beauty...). */
  changes?: { goods?: Record<string, Partial<GoodDef>>; buildings?: Record<string, Partial<BuildingDef>> };
  /** Wardens: rank names from lowest to highest (2 to 8 ranks) and combat numbers. */
  units?: { ranks?: string[]; reach?: number; duelTicks?: number; woundedDays?: number; strandedDays?: number };
  /** The start: settlers and goods in the Hearthship. */
  start?: { settlers?: number; stock?: Record<string, number> };
}

const CATEGORIES: readonly Category[] = ["storage", "materials", "food", "metal", "lantern", "terra", "decor"];
const JOBS: readonly JobKind[] = ["fell", "plant", "quarry", "craft", "farm", "fish", "mine", "hunt", "orchard", "bees", "shellfish", "fungus", "peat", "ropeway", "excavate"];
/** Fields a mod may change on a base building (placement rules and special roles stay fixed). */
const BUILDING_FIELDS = new Set(["name", "description", "cost", "workTicks", "restTicks", "inputs", "inputStock", "foodPer", "light", "warmth", "slots", "beauty", "radius", "fireRisk", "buildable"]);
const GOOD_FIELDS = new Set(["name"]);
const ID = /^[a-z][a-z0-9_-]{1,31}$/;

// The base game, kept to undo mods.
const BASE = {
  goods: GOODS.length,
  buildings: BUILDINGS.length,
  goodDefs: GOODS.map((g) => structuredClone(g)),
  buildingDefs: BUILDINGS.map((b) => structuredClone(b)),
  tools: [...TOOLS],
  combat: structuredClone(COMBAT),
  start: structuredClone(START),
};

let active: ModPack[] = [];

/** The mods in effect now. */
export function activeMods(): readonly ModPack[] {
  return active;
}

/** Check a pack read from a file or the Workshop. Returns the problems found (empty if fine). */
export function validateMod(data: unknown): string[] {
  const errors: string[] = [];
  const m = data as Partial<ModPack> | null;
  if (!m || typeof m !== "object") return ["A mod is a JSON object."];
  if (typeof m.id !== "string" || !ID.test(m.id)) errors.push("id: 2 to 32 lower-case letters, digits, - or _.");
  if (typeof m.name !== "string" || !m.name.trim()) errors.push("name is missing.");
  if (typeof m.version !== "string") errors.push("version is missing.");
  const goods = new Set(BASE.goodDefs.map((g) => g.id));
  const groups = new Set(BASE.goodDefs.map((g) => g.group).filter(Boolean) as string[]);
  const buildings = new Set(BASE.buildingDefs.map((b) => b.id));
  for (const g of m.goods ?? []) {
    if (!g || typeof g.id !== "string" || !ID.test(g.id)) errors.push(`goods: bad id ${JSON.stringify(g?.id)}.`);
    else if (goods.has(g.id)) errors.push(`goods: ${g.id} already exists.`);
    else goods.add(g.id);
    if (typeof g?.name !== "string") errors.push(`goods: ${g?.id} has no name.`);
    if (g?.group) groups.add(g.group);
  }
  const known = (k: string) => goods.has(k) || groups.has(k);
  const goodsOk = (where: string, rec: Record<string, number> | undefined) => {
    for (const [k, v] of Object.entries(rec ?? {})) {
      if (!known(k)) errors.push(`${where}: unknown good ${k}.`);
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 999) errors.push(`${where}: ${k} must be a number from 0 to 999.`);
    }
  };
  for (const b of m.buildings ?? []) {
    const where = `buildings: ${b?.id}`;
    if (!b || typeof b.id !== "string" || !ID.test(b.id)) {
      errors.push(`buildings: bad id ${JSON.stringify(b?.id)}.`);
      continue;
    }
    if (buildings.has(b.id)) errors.push(`${where} already exists.`);
    buildings.add(b.id);
    if (typeof b.name !== "string" || typeof b.description !== "string") errors.push(`${where} needs a name and a description.`);
    if (!CATEGORIES.includes(b.category)) errors.push(`${where}: category must be one of ${CATEGORIES.join(", ")}.`);
    if (b.job && !JOBS.includes(b.job)) errors.push(`${where}: job must be one of ${JOBS.join(", ")}.`);
    if (b.job === "craft" && (!b.produces || !b.inputs)) errors.push(`${where}: a craft building needs produces and inputs.`);
    if (b.produces && b.produces !== "tool" && !goods.has(b.produces)) errors.push(`${where}: unknown good ${b.produces}.`);
    if (b.tool && !goods.has(b.tool)) errors.push(`${where}: unknown tool ${b.tool}.`);
    if (b.looks && !BASE.buildingDefs.some((d) => d.id === b.looks)) errors.push(`${where}: looks must name a base building.`);
    if (b.terra || b.rail || b.storage) errors.push(`${where}: terraforming works, launch rails and stores can't be added by mods.`);
    goodsOk(`${where} cost`, b.cost);
    goodsOk(`${where} inputs`, b.inputs);
  }
  for (const [id, patch] of Object.entries(m.changes?.buildings ?? {})) {
    if (!buildings.has(id)) errors.push(`changes: unknown building ${id}.`);
    for (const k of Object.keys(patch ?? {})) if (!BUILDING_FIELDS.has(k)) errors.push(`changes: ${id}.${k} can't be changed.`);
    goodsOk(`changes: ${id} cost`, patch?.cost);
    goodsOk(`changes: ${id} inputs`, patch?.inputs);
  }
  for (const [id, patch] of Object.entries(m.changes?.goods ?? {})) {
    if (!goods.has(id)) errors.push(`changes: unknown good ${id}.`);
    for (const k of Object.keys(patch ?? {})) if (!GOOD_FIELDS.has(k)) errors.push(`changes: ${id}.${k} can't be changed.`);
  }
  const u = m.units;
  if (u?.ranks && (!Array.isArray(u.ranks) || u.ranks.length < 2 || u.ranks.length > 8 || u.ranks.some((r) => typeof r !== "string"))) errors.push("units: ranks is a list of 2 to 8 names.");
  for (const k of ["reach", "duelTicks", "woundedDays", "strandedDays"] as const) if (u?.[k] !== undefined && !(typeof u[k] === "number" && u[k]! > 0 && u[k]! < 1000)) errors.push(`units: ${k} must be a positive number.`);
  if (m.start?.settlers !== undefined && !(Number.isInteger(m.start.settlers) && m.start.settlers >= 1 && m.start.settlers <= 200)) errors.push("start: settlers from 1 to 200.");
  goodsOk("start stock", m.start?.stock);
  return errors;
}

/**
 * Put these mods in effect (in order), undoing any before. Called when a world is made, so every
 * peer and every replay of a save runs with the same content.
 */
export function applyMods(mods: readonly ModPack[]): void {
  if (sameMods(mods, active)) return;
  const goods = GOODS as GoodDef[];
  const buildings = BUILDINGS as BuildingDef[];
  // Undo: back to the base game, keeping the same objects (buildings hold their def).
  goods.length = BASE.goods;
  buildings.length = BASE.buildings;
  goods.forEach((g, i) => reset(g, BASE.goodDefs[i]!));
  buildings.forEach((b, i) => reset(b, BASE.buildingDefs[i]!));
  reset(COMBAT, BASE.combat);
  reset(START, BASE.start);
  for (const m of mods) {
    for (const g of m.goods ?? []) goods.push(structuredClone(g));
    for (const b of m.buildings ?? []) buildings.push({ buildable: true, ...structuredClone(b) });
    for (const [id, patch] of Object.entries(m.changes?.buildings ?? {})) {
      const b = buildings.find((d) => d.id === id);
      if (b) for (const [k, v] of Object.entries(patch)) if (BUILDING_FIELDS.has(k)) (b as unknown as Record<string, unknown>)[k] = structuredClone(v);
    }
    for (const [id, patch] of Object.entries(m.changes?.goods ?? {})) {
      const g = goods.find((d) => d.id === id);
      if (g && patch.name) g.name = patch.name;
    }
    const u = m.units;
    if (u?.ranks) COMBAT.ranks = [...u.ranks];
    for (const k of ["reach", "duelTicks", "woundedDays", "strandedDays"] as const) if (u?.[k] !== undefined) COMBAT[k] = u[k]!;
    if (m.start?.settlers) START.settlers = m.start.settlers;
    if (m.start?.stock) START.stock = { ...START.stock, ...m.start.stock };
  }
  GOOD_INDEX.clear();
  goods.forEach((g, i) => GOOD_INDEX.set(g.id, i));
  BUILDING_INDEX.clear();
  buildings.forEach((b, i) => BUILDING_INDEX.set(b.id, i));
  const tools = TOOLS as number[];
  tools.length = 0;
  goods.forEach((g, i) => g.tool && tools.push(i));
  active = mods.map((m) => structuredClone(m));
}

function reset<T extends object>(target: T, base: T): void {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
  Object.assign(target, structuredClone(base));
}

function sameMods(a: readonly ModPack[], b: readonly ModPack[]): boolean {
  return a.length === b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]));
}

/** Mods are part of a world's state: the same seed with other mods is another world. */
export function hashMods(h: StateHasher, mods: readonly ModPack[]): void {
  for (const m of mods) h.str(m.id).str(m.version).int(m.goods?.length ?? 0).int(m.buildings?.length ?? 0);
}

/** A small example pack (shown in the mods panel and used by the tests). */
export const EXAMPLE_MOD: ModPack = {
  id: "cider-press",
  name: "Cider and Kilns",
  version: "1.0.0",
  author: "Seedfall",
  description: "A cider press that turns fruit into cider (a food), a brick kiln, cheaper houses, and a sixth warden rank.",
  goods: [
    { id: "cider", name: "Cider", group: "food" },
    { id: "brick", name: "Brick" },
  ],
  buildings: [
    { id: "ciderpress", name: "Cider press", description: "Presses fruit into cider, a food that keeps.", category: "food", cost: { plank: 2, stone: 1 }, job: "craft", produces: "cider", inputs: { fruit: 2 }, inputStock: 6, workTicks: 140, restTicks: 60, looks: "mill" },
    { id: "brickkiln", name: "Brick kiln", description: "Fires stone and coal into bricks.", category: "materials", cost: { plank: 2, stone: 3 }, job: "craft", produces: "brick", inputs: { stone: 1, coal: 1 }, inputStock: 4, workTicks: 160, restTicks: 60, forge: true, looks: "smelter" },
  ],
  changes: { buildings: { house: { cost: { plank: 2, stone: 1 } } } },
  units: { ranks: ["Watcher", "Warden", "Sentinel", "Captain", "Flamekeeper", "Lanternlord"] },
};
