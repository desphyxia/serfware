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

export const AI_LEVELS: Record<AiLevel, { name: string; /** Thinks once per this many periods. */ every: number; sites: number; odds: number; wants: number }> = {
  easy: { name: "Easy", every: 2, sites: 2, odds: 0.85, wants: 3 },
  normal: { name: "Normal", every: 1, sites: 3, odds: 0.7, wants: 5 },
  hard: { name: "Hard", every: 1, sites: 4, odds: 0.6, wants: 7 },
};

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
