import { describe, expect, it } from "vitest";
import { baselineTuning } from "../src/sim/ai/personality";
import { learnedBrain, tunedBrain } from "../src/sim/ai/tuned";
import { makeEntrant, playMatch, scripted, updateElo, type Entrant, type EntrantSpec } from "../soak/league";
import { runMatches } from "../soak/pool";

describe("the league", () => {
  it("moves Elo toward the winner and keeps the total", () => {
    const ratings = new Map<string, number>();
    updateElo(ratings, { seed: "x", names: ["a", "b", "c"], scores: [30, 10, 10], winner: -1 });
    expect(ratings.get("a")!).toBeGreaterThan(1000);
    expect(ratings.get("b")!).toBe(ratings.get("c"));
    expect([...ratings.values()].reduce((s, r) => s + r, 0)).toBeCloseTo(3000, 6);
    // Scores within the margin are a draw.
    const even = new Map<string, number>();
    updateElo(even, { seed: "x", names: ["a", "b"], scores: [10, 11], winner: -1 });
    expect(even.get("a")).toBe(1000);
  });

  it("plays a match deterministically, and the tuned seat with the baseline numbers plays like the scripted one", { timeout: 300000 }, () => {
    const hand = scripted("warden", "normal");
    const tuned: Entrant = { name: "tuned", personality: "warden", level: "normal", brain: tunedBrain(baselineTuning("warden", "normal")) };
    const others = [scripted("builder", "normal"), scripted("trader", "normal")];
    const a = playMatch("amber-fern-212", [hand, ...others], 3);
    const b = playMatch("amber-fern-212", [hand, ...others], 3);
    expect(b.scores).toEqual(a.scores);
    const c = playMatch("amber-fern-212", [tuned, ...others], 3);
    expect(c.scores).toEqual(a.scores);
  });

  it("the learned brain with no training plays like the scripted one", { timeout: 300000 }, () => {
    const learned: Entrant = { name: "learned", personality: "builder", level: "normal", brain: learnedBrain };
    const hand = scripted("builder", "normal");
    const others = [scripted("trader", "normal"), scripted("warden", "normal")];
    // Only meaningful while the file holds no builder numbers (training writes the warden's).
    const a = playMatch("amber-fern-212", [hand, ...others], 3);
    const c = playMatch("amber-fern-212", [learned, ...others], 3);
    expect(c.scores).toEqual(a.scores);
  });

  it("plays matches in parallel processes with the same results as playing them in turn", { timeout: 600000 }, async () => {
    const field: EntrantSpec[] = [
      { kind: "scripted", personality: "builder", level: "normal" },
      { kind: "scripted", personality: "trader", level: "normal" },
      { kind: "scripted", personality: "warden", level: "normal" },
    ];
    const jobs = ["amber-fern-212", "glade-iris-904"].map((seed) => ({ seed, entrants: field, days: 2 }));
    const parallel = await runMatches(jobs, 2);
    const serial = jobs.map((j) => playMatch(j.seed, j.entrants.map(makeEntrant), j.days));
    expect(parallel).toEqual(serial);
  });
});
