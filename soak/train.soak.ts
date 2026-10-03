import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { baselineTuning, type Tuning } from "../src/sim/ai/personality";
import { LEARNED_TUNING, tunedBrain } from "../src/sim/ai/tuned";
import { Rng } from "../src/sim/rng";
import { playMatch, scripted, type Entrant } from "./league";

/**
 * Self-play search for the Warden's numbers: a (1+λ) evolution strategy over `Tuning`, each candidate judged by
 * how far its score beats the two scripted opponents it plays (a hand-set Warden and a Trader) over a fixed set
 * of seeds, with the seats rotated. The best numbers are written to src/sim/data/learned-ai.json and a fresh
 * set of seeds then checks them against the hand-set Warden, which is the only claim worth making about the
 * result. Run with `npm run soak -- train`; TRAIN_GENS (default 5), TRAIN_CHILDREN (3), TRAIN_MATCHES (3),
 * SOAK_DAYS (12) and TRAIN_CHECK (9 matches) size it.
 */
const GENS = Number(process.env.TRAIN_GENS ?? 5);
const CHILDREN = Number(process.env.TRAIN_CHILDREN ?? 3);
const MATCHES = Number(process.env.TRAIN_MATCHES ?? 3);
const CHECK = Number(process.env.TRAIN_CHECK ?? 9);
const DAYS = Number(process.env.SOAK_DAYS ?? 12);
const TRAIN_SEEDS = ["russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808"];
const CHECK_SEEDS = ["ember-sky-31", "birch-ford-12", "slate-owl-640", "mist-reed-77", "copper-vale-9", "quill-moor-303", "fable-glen-58", "salt-wren-21", "dune-lark-8"];

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

const rival = [scripted("warden", "normal"), scripted("trader", "normal")];
const candidate = (t: Tuning): Entrant => ({ name: "candidate", personality: "warden", level: "normal", brain: tunedBrain(t) });

/** Mean of (candidate score minus the mean of the two others), over the seeds, the seat rotating. */
function fitness(t: Tuning, seeds: string[], matches: number): number {
  let sum = 0;
  let n = 0;
  for (let m = 0; m < matches; m++) {
    const seed = seeds[m % seeds.length] as string;
    const seat = m % 3;
    const field = [rival[0] as Entrant, rival[1] as Entrant];
    field.splice(seat, 0, candidate(t));
    const r = playMatch(seed, field, DAYS);
    const mine = r.scores[seat] as number;
    const others = r.scores.filter((_, i) => i !== seat);
    sum += mine - others.reduce((a, b) => a + b, 0) / others.length;
    n++;
  }
  return sum / n;
}

describe("train", () => {
  it("searches the warden's numbers", () => {
    const rng = new Rng("train-ai");
    const gauss = () => rng.next() + rng.next() + rng.next() + rng.next() - 2;
    const clip = (k: keyof Tuning, v: number) => Math.max(BOUNDS[k][0], Math.min(BOUNDS[k][1], v));
    const base = baselineTuning("warden", "normal");
    let parent: Tuning = { ...base, ...(LEARNED_TUNING.warden ?? {}) };
    let parentFit = fitness(parent, TRAIN_SEEDS, MATCHES);
    const log: unknown[] = [{ gen: 0, fitness: parentFit, tuning: parent }];
    console.log(`gen 0 fitness ${parentFit.toFixed(2)}`);
    let sigma = 0.2;
    for (let g = 1; g <= GENS; g++) {
      for (let c = 0; c < CHILDREN; c++) {
        const child = { ...parent };
        for (const k of KEYS) child[k] = clip(k, parent[k] + gauss() * sigma * (BOUNDS[k][1] - BOUNDS[k][0]));
        const f = fitness(child, TRAIN_SEEDS, MATCHES);
        if (f > parentFit) {
          parent = child;
          parentFit = f;
        }
      }
      sigma *= 0.85;
      log.push({ gen: g, fitness: parentFit, tuning: parent });
      console.log(`gen ${g} fitness ${parentFit.toFixed(2)} ${JSON.stringify(parent)}`);
    }
    // Round the numbers so the file reads, then judge them on seeds the search never saw.
    const found = Object.fromEntries(KEYS.map((k) => [k, Math.round(parent[k] * 100) / 100])) as unknown as Tuning;
    const learnedFit = fitness(found, CHECK_SEEDS, CHECK);
    const handFit = fitness(base, CHECK_SEEDS, CHECK);
    console.log(`check on ${CHECK} unseen matches: learned ${learnedFit.toFixed(2)} vs hand-set ${handFit.toFixed(2)} (score above the field's mean)`);
    writeFileSync("src/sim/data/learned-ai.json", JSON.stringify({ warden: found }, null, 1) + "\n");
    writeFileSync("soak-train.json", JSON.stringify({ gens: GENS, children: CHILDREN, matches: MATCHES, days: DAYS, log, found, check: { matches: CHECK, learned: learnedFit, handSet: handFit } }, null, 1));
  }, 6 * 3_600_000);
});
