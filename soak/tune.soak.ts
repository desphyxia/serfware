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
 * TUNE_GENS (default 8), TUNE_CHILDREN (3), TUNE_MATCHES (6 per candidate per generation), TUNE_CHECK (12) and
 * SOAK_DAYS (12) size it.
 */
const GENS = Number(process.env.TUNE_GENS ?? 8);
const CHILDREN = Number(process.env.TUNE_CHILDREN ?? 3);
const MATCHES = Number(process.env.TUNE_MATCHES ?? 6);
const CHECK = Number(process.env.TUNE_CHECK ?? 12);
const DAYS = Number(process.env.SOAK_DAYS ?? 12);
const TRAIN_SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808", "ember-sky-31", "birch-ford-12", "slate-owl-640"];
const CHECK_SEEDS = ["mist-reed-77", "copper-vale-9", "quill-moor-303", "fable-glen-58", "salt-wren-21", "dune-lark-8", "heath-fox-101", "pine-sedge-67", "cairn-tern-14", "flint-vole-290", "wren-ash-45", "marl-pike-33"];

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

/** Mean of (the candidate's score minus the mean of the other two) over a candidate's matches. */
function fitnessOf(results: { scores: number[] }[], seeds: string[]): number {
  let sum = 0;
  results.forEach((r, m) => {
    const seat = m % 3;
    const others = r.scores.filter((_, i) => i !== seat);
    sum += (r.scores[seat] as number) - others.reduce((a, b) => a + b, 0) / others.length;
  });
  return sum / seeds.length;
}

/** Judge several candidates at once (all their matches run together) and return each one's fitness. */
async function judge(candidates: Tuning[], seeds: string[]): Promise<number[]> {
  const results = await runMatches(candidates.flatMap((t) => jobsFor(t, seeds)));
  return candidates.map((_, c) => fitnessOf(results.slice(c * seeds.length, (c + 1) * seeds.length), seeds));
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
    const checked = await judge([found, base], CHECK_SEEDS.slice(0, CHECK));
    const learnedFit = checked[0] as number;
    const handFit = checked[1] as number;
    const wins = learnedFit > handFit;
    console.log(`unseen check (${CHECK} matches each): searched ${learnedFit.toFixed(1)} vs hand-set ${handFit.toFixed(1)} points above the other two seats; ${wins ? "kept" : "NOT kept"}`);
    if (wins) writeFileSync("src/sim/data/learned-ai.json", JSON.stringify({ warden: found }, null, 1) + "\n");
    writeFileSync("soak-tune.json", JSON.stringify({ gens: GENS, children: CHILDREN, matches: MATCHES, days: DAYS, log, found, check: { matches: CHECK, searched: learnedFit, handSet: handFit, kept: wins } }, null, 1));
  }, 6 * 3_600_000);
});
