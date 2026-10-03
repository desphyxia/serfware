import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { baselineTuning, type Tuning } from "../src/sim/ai/personality";
import { LEARNED_TUNING } from "../src/sim/ai/tuned";
import { Rng } from "../src/sim/rng";
import type { EntrantSpec } from "./league";
import { runMatches, type MatchJob } from "./pool";

/**
 * Self-play search for the Warden's numbers: a (1+λ) evolution strategy over `Tuning`, each candidate judged by
 * how far its score beats the two scripted opponents it plays (a hand-set Warden and a Trader), over seeds drawn
 * afresh each generation (the parent is re-judged on the same seeds as its children, so the comparison is fair)
 * with the seats rotated. Matches run in parallel, one process per core. The best numbers are then judged
 * against the hand-set Warden on seeds the search never saw, and are written to src/sim/data/learned-ai.json only
 * if they win there; otherwise the file is left alone. Run with `npm run soak -- tune`; writes soak-tune.json.
 * TUNE_GENS (default 8), TUNE_CHILDREN (3), TUNE_MATCHES (16 per candidate per generation), TUNE_CHECK (24) and
 * SOAK_DAYS (14) size it. The first search, at 6 matches per candidate, could not tell candidates apart (the same
 * numbers scored from -24 to +37 between generations); the check now pairs the searched numbers with the hand-set
 * ones on the same seeds and keeps them only if the gain is at least one standard error.
 */
const GENS = Number(process.env.TUNE_GENS ?? 8);
const CHILDREN = Number(process.env.TUNE_CHILDREN ?? 3);
const MATCHES = Number(process.env.TUNE_MATCHES ?? 16);
const CHECK = Number(process.env.TUNE_CHECK ?? 24);
const DAYS = Number(process.env.SOAK_DAYS ?? 14);
const TRAIN_SEEDS = Array.from({ length: 24 }, (_, i) => `tune-train-${i + 1}`);
const CHECK_SEEDS = Array.from({ length: 48 }, (_, i) => `tune-check-${i + 1}`);

const BOUNDS: Record<keyof Tuning, [number, number]> = {
  attackOdds: [0.4, 0.95],
  temper: [2, 16],
  frontier: [0.1, 1],
  inland: [0.05, 0.6],
  sites: [1, 6],
  wants: [2, 9],
  seaReady: [10, 50],
};
const KEYS = Object.keys(BOUNDS) as (keyof Tuning)[];

const hand: EntrantSpec[] = [
  { kind: "scripted", personality: "warden", level: "normal" },
  { kind: "scripted", personality: "trader", level: "normal" },
];
const candidate = (t: Tuning): EntrantSpec => ({ kind: "tuned", name: "candidate", personality: "warden", level: "normal", tuning: t });

/** The jobs that judge one candidate on some seeds, the candidate's seat rotating. */
function jobsFor(t: Tuning, seeds: string[]): MatchJob[] {
  return seeds.map((seed, m) => {
    const field = [...hand];
    field.splice(m % 3, 0, candidate(t));
    return { seed, entrants: field, days: DAYS };
  });
}

/** Per match: the candidate's score minus the mean of the other two. */
function perMatch(results: { scores: number[] }[]): number[] {
  return results.map((r, m) => {
    const seat = m % 3;
    const others = r.scores.filter((_, i) => i !== seat);
    return (r.scores[seat] as number) - others.reduce((a, b) => a + b, 0) / others.length;
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stderr = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length);
};

/** Judge several candidates at once (all their matches run together) and return each one's per-match fitness. */
async function judgeAll(candidates: Tuning[], seeds: string[]): Promise<number[][]> {
  const results = await runMatches(candidates.flatMap((t) => jobsFor(t, seeds)));
  return candidates.map((_, c) => perMatch(results.slice(c * seeds.length, (c + 1) * seeds.length)));
}

async function judge(candidates: Tuning[], seeds: string[]): Promise<number[]> {
  return (await judgeAll(candidates, seeds)).map(mean);
}

describe("tune", () => {
  it("searches the warden's numbers", async () => {
    const rng = new Rng("tune-ai");
    const gauss = () => rng.next() + rng.next() + rng.next() + rng.next() - 2;
    const clip = (k: keyof Tuning, v: number) => Math.max(BOUNDS[k][0], Math.min(BOUNDS[k][1], v));
    const base = baselineTuning("warden", "normal");
    let parent: Tuning = { ...base, ...(LEARNED_TUNING.warden ?? {}) };
    const log: unknown[] = [];
    let sigma = 0.2;
    for (let g = 1; g <= GENS; g++) {
      const seeds = Array.from({ length: MATCHES }, () => TRAIN_SEEDS[Math.floor(rng.next() * TRAIN_SEEDS.length)] as string);
      const children = Array.from({ length: CHILDREN }, () => {
        const child = { ...parent };
        for (const k of KEYS) child[k] = clip(k, parent[k] + gauss() * sigma * (BOUNDS[k][1] - BOUNDS[k][0]));
        return child;
      });
      const fits = await judge([parent, ...children], seeds);
      const best = fits.indexOf(Math.max(...fits));
      if (best > 0) parent = children[best - 1] as Tuning;
      sigma *= 0.88;
      log.push({ gen: g, parentFitness: fits[0], bestFitness: fits[best], moved: best > 0, tuning: parent });
      console.log(`gen ${g}: parent ${(fits[0] as number).toFixed(1)}, best ${(fits[best] as number).toFixed(1)}${best > 0 ? " (moved)" : ""}`);
    }
    const found = Object.fromEntries(KEYS.map((k) => [k, Math.round(parent[k] * 100) / 100])) as unknown as Tuning;
    // Paired on the same seeds and seats: the searched numbers' gain over the hand-set ones, with its standard error.
    const seeds = CHECK_SEEDS.slice(0, CHECK);
    const [mine, theirs] = await judgeAll([found, base], seeds);
    const diffs = (mine as number[]).map((x, i) => x - (theirs as number[])[i]!);
    const gain = mean(diffs);
    const se = stderr(diffs);
    const learnedFit = mean(mine as number[]);
    const handFit = mean(theirs as number[]);
    const wins = gain > 0 && gain > se;
    console.log(`unseen check (${CHECK} paired matches): searched ${learnedFit.toFixed(1)} vs hand-set ${handFit.toFixed(1)}; gain ${gain.toFixed(1)} +/- ${se.toFixed(1)} (1 s.e.); ${wins ? "kept" : "NOT kept"}`);
    if (wins) writeFileSync("src/sim/data/learned-ai.json", JSON.stringify({ warden: found }, null, 1) + "\n");
    writeFileSync("soak-tune.json", JSON.stringify({ gens: GENS, children: CHILDREN, matches: MATCHES, days: DAYS, log, found, check: { matches: CHECK, searched: learnedFit, handSet: handFit, gain, stderr: se, kept: wins } }, null, 1));
  }, 6 * 3_600_000);
});
