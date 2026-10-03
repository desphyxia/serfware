import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { updateElo, type EntrantSpec } from "./league";
import { runMatches, type MatchJob } from "./pool";

/**
 * A league: the scripted seats of every temperament and level, and the learned one, play three-seat matches on
 * tiny worlds (in parallel, one process per core); Elo ratings come from the pairwise results. Run with
 * `npm run soak -- tournament`; writes soak-tournament.json. SOAK_MATCHES (default 24) and SOAK_DAYS (default 12)
 * size it. Ratings from this few matches are rough: the table prints how many games each entrant played.
 */
const MATCHES = Number(process.env.SOAK_MATCHES ?? 24);
const DAYS = Number(process.env.SOAK_DAYS ?? 12);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212,glade-iris-904,lantern-moss-55,tidal-oak-808,ember-sky-31").split(",");

const ENTRANTS: EntrantSpec[] = [
  { kind: "scripted", personality: "builder", level: "normal" },
  { kind: "scripted", personality: "trader", level: "normal" },
  { kind: "scripted", personality: "warden", level: "normal" },
  { kind: "scripted", personality: "warden", level: "hard" },
  { kind: "scripted", personality: "builder", level: "easy" },
  { kind: "learned", personality: "warden", level: "normal" },
];

describe("tournament", () => {
  it("rates the brains", async () => {
    const jobs: MatchJob[] = [];
    for (let m = 0; m < MATCHES; m++) {
      // Three distinct entrants, rotating; the seats rotate too, so no one always has the same neighbour.
      const set = [m % 6, (m + 1 + Math.floor(m / 6)) % 6, (m + 3 + 2 * Math.floor(m / 6)) % 6];
      for (let extra = 0; new Set(set).size < 3; extra++) set[2] = (m + 2 + extra) % 6;
      const seats = set.map((i) => ENTRANTS[i] as EntrantSpec);
      const turn = m % 3;
      jobs.push({ seed: SEEDS[m % SEEDS.length] as string, entrants: [...seats.slice(turn), ...seats.slice(0, turn)], days: DAYS });
    }
    const results = await runMatches(jobs);
    const ratings = new Map<string, number>();
    const games = new Map<string, number>();
    const scores = new Map<string, number>();
    for (const result of results) {
      updateElo(ratings, result);
      result.names.forEach((n, i) => {
        games.set(n, (games.get(n) ?? 0) + 1);
        scores.set(n, (scores.get(n) ?? 0) + (result.scores[i] as number));
      });
    }
    const table = [...ratings.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, elo]) => ({ name, elo: Math.round(elo), games: games.get(name) ?? 0, meanScore: Math.round(((scores.get(name) ?? 0) / (games.get(name) ?? 1)) * 10) / 10 }));
    console.log("\n" + table.map((r) => `${r.name.padEnd(16)} Elo ${r.elo}  games ${r.games}  mean score ${r.meanScore}`).join("\n"));
    writeFileSync("soak-tournament.json", JSON.stringify({ matches: MATCHES, days: DAYS, table }, null, 1));
  }, 3_600_000);
});
