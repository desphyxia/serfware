import type { Rng } from "../rng";

/** The people of a settlement: names, families, ages, skills and memories. */

export type LifeStage = "child" | "adult" | "elder";

export interface Person {
  id: number;
  owner: number;
  first: string;
  family: string;
  /** Tick of birth (negative for founders, who arrive grown up). */
  born: number;
  stage: LifeStage;
  /** Skill per trade (building id), 0..1. */
  skills: Record<string, number>;
  /** Work cycles completed per trade, for milestones. */
  done: Record<string, number>;
  /** House this person lives in, or -1 (sleeps in the Hearthship). */
  house: number;
  /** Active settler entity while out working, else -1. */
  settler: number;
  /** Tick at which this person will pass away of old age. */
  lifespan: number;
  journal: string[];
  /** Wardens: rank 0..4, experience toward the next, arms carried (see ARM_*). */
  rank: number;
  xp: number;
  arms: number;
  /** Tick until which this person is recovering from a wound (can't work or fight). */
  woundedUntil: number;
  alive: boolean;
}

export const ARM_BLADE = 1;
export const ARM_BOW = 2;
export const ARM_MOUNT = 4;

const FIRST = [
  "Ada", "Arlo", "Bea", "Bram", "Cleo", "Dara", "Eben", "Edda", "Elin", "Fenn", "Gus", "Hana", "Ilse", "Ivo", "Jun", "Kai",
  "Lark", "Lena", "Mae", "Milo", "Nell", "Nico", "Oda", "Otto", "Pia", "Quill", "Rhea", "Rui", "Sana", "Sol", "Tove", "Uma",
  "Vale", "Wren", "Yara", "Zeno", "Ines", "Tariq", "Amara", "Kofi", "Mei", "Ravi", "Leif", "Noor", "Emeka", "Sigrid", "Tomas", "Aiko",
];

const FAMILY = [
  "Ashdown", "Barley", "Brightwater", "Cobb", "Delling", "Emberly", "Fairweather", "Fenwick", "Galloway", "Hearth", "Holloway",
  "Ivers", "Juniper", "Kettle", "Lindqvist", "Marsh", "Mbeki", "Nakamura", "Oakes", "Pellow", "Quarrie", "Reyes", "Sowerby",
  "Tallis", "Umber", "Varga", "Wilde", "Yoon", "Zamora", "Achebe", "Novak", "Okafor",
];

export function randomFirst(r: Rng): string {
  return r.pick(FIRST);
}

export function randomFamily(r: Rng): string {
  return r.pick(FAMILY);
}

export function fullName(p: Person): string {
  return `${p.first} ${p.family}`;
}

export function note(p: Person, text: string): void {
  p.journal.push(text);
  if (p.journal.length > 10) p.journal.shift();
}

const TRADES: Record<string, string> = {
  carrier: "carrier", builder: "builder", geologist: "geologist", woodcutter: "woodcutter", forester: "forester",
  quarry: "stonecutter", sawmill: "sawyer", farm: "farmer", mill: "miller", bakery: "baker", fisher: "fisher",
  pasture: "herder", butcher: "butcher", coalmine: "miner", ironmine: "miner", goldmine: "miner", granitemine: "miner",
  smelter: "smelter", goldsmith: "goldsmith", toolsmith: "toolsmith",
};

/** Name of the person practising a trade (building id or role). */
export function tradeName(trade: string): string {
  return TRADES[trade] ?? trade;
}

/** Titles by skill, shown in the settler card. */
export function title(skill: number): string {
  if (skill >= 0.8) return "Master";
  if (skill >= 0.45) return "Journeyman";
  if (skill > 0.02) return "Apprentice";
  return "Novice";
}

/** Work-time factor from skill: masters work about a third faster than novices. */
export function skillSpeed(skill: number): number {
  return 1.2 - 0.4 * skill;
}

export interface GlowParts {
  nourishment: number;
  shelter: number;
  belonging: number;
  beauty: number;
  rest: number;
}

export const GLOW_WEIGHTS: GlowParts = { nourishment: 0.32, shelter: 0.2, belonging: 0.18, beauty: 0.15, rest: 0.15 };

export function glowValue(p: GlowParts): number {
  let s = 0;
  for (const k of Object.keys(GLOW_WEIGHTS) as (keyof GlowParts)[]) s += GLOW_WEIGHTS[k] * Math.max(0, Math.min(1, p[k]));
  return Math.round(s * 100);
}

/** Work-speed factor from Glow: a happy town works about 20 % faster, an unhappy one 20 % slower. */
export function glowSpeed(glow: number): number {
  return 1.2 - (glow / 100) * 0.4;
}
