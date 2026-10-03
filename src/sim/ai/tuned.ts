import { AiBuilder } from "./builder";
import type { BrainFactory } from "./brain";
import { baselineTuning, type Personality, type Tuning } from "./personality";
import learned from "../data/learned-ai.json";

/**
 * A scripted seat with its numbers searched rather than set by hand. `tunedBrain(tuning)` builds the scripted AI
 * with any of the `Tuning` numbers replaced; `learnedBrain` uses the numbers `npm run soak -- tune` found by
 * self-play search (`src/sim/data/learned-ai.json`; empty until a training run has written it, in which case it
 * plays exactly like the hand-set seat). It is the same planners and the same commands as any seat: only the
 * numbers differ, so it is a tuned opponent, not a different kind of mind.
 */
export function tunedBrain(tuning: Partial<Tuning>): BrainFactory {
  return (seat) => new AiBuilder(seat.player, seat.rng, seat.personality, seat.level, { ...baselineTuning(seat.personality, seat.level), ...tuning });
}

/** The searched numbers for each temperament (a temperament with none plays by the hand-set numbers). */
export const LEARNED_TUNING = learned as Partial<Record<Personality, Partial<Tuning>>>;

export const learnedBrain: BrainFactory = (seat) => tunedBrain(LEARNED_TUNING[seat.personality] ?? {})(seat);
