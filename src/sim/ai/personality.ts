import { mix32, hashString } from "../rng";
import type { Proposal } from "../econ/diplomacy";
import type { Economy } from "../econ/economy";

/**
 * Rival temperaments. A Builder wants to be left alone to grow and keeps its word; a Trader
 * looks for pacts and open roads; a Warden trusts strength, garrisons heavily and attacks when
 * the odds are good. The level sets how sharp any of them plays.
 */
export type Personality = "builder" | "trader" | "warden";
export type AiLevel = "easy" | "normal" | "hard";

export const PERSONALITIES: Record<Personality, { name: string; note: string }> = {
  builder: { name: "Builder", note: "Grows quietly, welcomes truces, rarely attacks." },
  trader: { name: "Trader", note: "Seeks trade pacts and shared roads; fights only when cornered." },
  warden: { name: "Warden", note: "Garrisons heavily and attacks when the odds are good." },
};

/**
 * What each temperament will not do, whatever its planners suggest: a Builder keeps the peace (no raids, camps
 * or broken treaties); a Trader fights only when cornered (no camps, no broken treaties) and spares itself
 * the arms trades; a Warden never leaves home (no voyages) and has no time for pleasures. A hard limit on the
 * orders (and the buildings) a seat can give, so the temperaments differ in what they do, not only in how often.
 */
export const TEMPERS: Record<Personality, { commands: readonly string[]; buildings: readonly string[] }> = {
  builder: { commands: ["raid", "camp", "break"], buildings: ["weaponsmith", "bowyer", "stable"] },
  trader: { commands: ["camp", "break"], buildings: ["weaponsmith", "bowyer", "stable"] },
  warden: { commands: ["probe", "hearthship", "land", "route", "unroute"], buildings: ["maypole", "fountain", "flowerbed", "bench", "statue", "launchrail"] },
};

/** Whether a temperament may give an order. */
export function temperAllows(p: Personality, cmd: { t: string; type?: string }): boolean {
  const limits = TEMPERS[p];
  return !limits.commands.includes(cmd.t) && !(cmd.t === "build" && cmd.type !== undefined && limits.buildings.includes(cmd.type));
}

export const AI_LEVELS: Record<AiLevel, { name: string; /** Thinks once per this many periods. */ every: number; sites: number; odds: number; wants: number }> = {
  easy: { name: "Easy", every: 2, sites: 2, odds: 0.85, wants: 3 },
  normal: { name: "Normal", every: 1, sites: 3, odds: 0.7, wants: 5 },
  hard: { name: "Hard", every: 1, sites: 4, odds: 0.6, wants: 7 },
};

/**
 * The numbers that set how a scripted seat plays: how good the odds must be to attack and how often it looks
 * for a fight, how full it keeps the border and the interior, how many sites it runs at once and how many
 * wishes it tries a thought, and how large it grows before it looks to the sea. `baselineTuning` is the
 * hand-set play of a temperament and level; a tuned policy (see `tuned.ts`) searches around it.
 */
export interface Tuning {
  attackOdds: number;
  temper: number;
  frontier: number;
  inland: number;
  sites: number;
  wants: number;
  seaReady: number;
}

export function baselineTuning(personality: Personality, level: AiLevel): Tuning {
  const lv = AI_LEVELS[level];
  const [frontier, inland] = personality === "warden" ? [1, 0.25] : personality === "trader" ? [0.3, 0.15] : [0.4, 0.2];
  return {
    attackOdds: lv.odds,
    temper: personality === "warden" ? 3 : personality === "trader" ? 8 : 12,
    frontier,
    inland,
    sites: lv.sites,
    wants: lv.wants,
    seaReady: { trader: 18, builder: 26, warden: 36 }[personality],
  };
}

const TOWNS = ["Ashford", "Brindlemoor", "Copperwell", "Duskmere", "Elderhithe", "Fernwick", "Greystrand", "Harrowgate", "Ivyholt", "Juniper Vale", "Kestrel Down", "Larkspur"];

/** The seed decides each rival's temperament and its settlement's name, unless set. */
export function rivalFor(seed: string, player: number): { personality: Personality; name: string } {
  const h = mix32(hashString(seed), player) >>> 0;
  const kinds: Personality[] = ["builder", "trader", "warden"];
  return { personality: kinds[h % 3]!, name: TOWNS[(h >>> 8) % TOWNS.length]! };
}

/** How a rival answers an offer: its temperament, the offerer's name, and the balance of arms. */
export function answerOffer(eco: Economy, me: Personality, p: number, prop: Proposal): boolean {
  const rep = eco.diplomacy.rep(prop.from);
  if (prop.kind === "prisoners") return true;
  if (rep < 30) return false;
  const strength = (q: number) => eco.people.filter((x) => x.alive && x.owner === q && x.rank > 0).length + eco.buildings.filter((b) => b.alive && b.owner === q && b.def.slots).length;
  const weaker = strength(p) < strength(prop.from);
  switch (me) {
    case "builder":
      return prop.kind === "truce" || (prop.kind === "trade" && rep >= 40) || (prop.kind === "roads" && rep >= 55);
    case "trader":
      return prop.kind !== "truce" || rep >= 40 || weaker;
    case "warden":
      return prop.kind === "truce" ? weaker : prop.kind === "trade" && rep >= 60;
  }
}
