import { AiBuilder } from "../src/sim/ai/builder";
import type { BrainFactory } from "../src/sim/ai/brain";
import type { AiLevel, Personality } from "../src/sim/ai/personality";
import { World } from "../src/sim/world";

/** One competitor in a league: a brain with a name, and the temperament and level its seat is given. */
export interface Entrant {
  name: string;
  personality: Personality;
  level: AiLevel;
  brain: BrainFactory;
}

export const scripted = (personality: Personality, level: AiLevel): Entrant => ({
  name: `${personality}-${level}`,
  personality,
  level,
  brain: (seat) => new AiBuilder(seat.player, seat.rng, seat.personality, seat.level),
});

export interface Result {
  seed: string;
  names: string[];
  scores: number[];
  winner: number;
}

/**
 * Play one match: the entrants take seats 1..n of a tiny world (seat 0 is a steward, the same in every match and
 * not scored). A seat's score is what it has built plus a quarter of its people, 25 more for the winner and 25
 * fewer for a seat that has fallen: a composite of how much it grew and whether it survived, nothing finer.
 */
export function playMatch(seed: string, entrants: Entrant[], days: number, peaceDays = 4): Result {
  const w = new World(seed, {
    size: "tiny",
    rivals: entrants.length,
    personalities: entrants.map((e) => e.personality),
    aiLevel: "normal",
    peaceDays,
    brain: (seat) => {
      const e = entrants[seat.player - 1] as Entrant;
      return e.brain({ ...seat, personality: e.personality, level: e.level });
    },
  });
  w.command({ t: "steward", of: 0, on: true });
  const eco = w.economy;
  const end = w.tick + days * eco.dayTicks;
  while (w.tick < end && eco.winner < 0) w.step();
  const scores = entrants.map((_, i) => {
    const p = i + 1;
    const built = eco.buildings.filter((b) => b.alive && b.built && b.owner === p).length;
    const people = eco.people.filter((x) => x.alive && x.owner === p).length;
    return built + people / 4 + (eco.winner === p ? 25 : 0) - (eco.defeated[p] ? 25 : 0);
  });
  return { seed, names: entrants.map((e) => e.name), scores, winner: eco.winner };
}

/** Elo ratings from pairwise results: a score more than `margin` ahead wins the pair, within it draws. */
export function updateElo(ratings: Map<string, number>, result: Result, k = 16, margin = 2): void {
  const n = result.names.length;
  const delta = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = result.names[i] as string;
      const b = result.names[j] as string;
      const ra = ratings.get(a) ?? 1000;
      const rb = ratings.get(b) ?? 1000;
      const diff = (result.scores[i] as number) - (result.scores[j] as number);
      const sa = diff > margin ? 1 : diff < -margin ? 0 : 0.5;
      const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
      delta.set(a, (delta.get(a) ?? 0) + k * (sa - ea));
      delta.set(b, (delta.get(b) ?? 0) - k * (sa - ea));
    }
  }
  for (const [name, d] of delta) ratings.set(name, (ratings.get(name) ?? 1000) + d);
}
