import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { learnedBrain } from "../src/sim/ai/tuned";
import { playMatch, scripted, updateElo, type Entrant } from "./league";

/**
 * A league: the scripted seats of every temperament and level, and the tuned one, play three-seat matches on
 * tiny worlds; Elo ratings come from the pairwise results. Run with `npm run soak -- tournament`; writes
 * soak-tournament.json. SOAK_MATCHES (default 18) and SOAK_DAYS (default 12) size it. Ratings from this few
 * matches are rough: the table prints how many games each entrant played.
 */
const MATCHES = Number(process.env.SOAK_MATCHES ?? 18);
const DAYS = Number(process.env.SOAK_DAYS ?? 12);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212,glade-iris-904,lantern-moss-55,tidal-oak-808,ember-sky-31").split(",");

const learned: Entrant = { name: "learned-warden", personality: "warden", level: "normal", brain: learnedBrain };
const ENTRANTS: Entrant[] = [scripted("builder", "normal"), scripted("trader", "normal"), scripted("warden", "normal"), scripted("warden", "hard"), scripted("builder", "easy"), learned];

describe("tournament", () => {
  it("rates the brains", () => {
    const ratings = new Map<string, number>();
    const games = new Map<string, number>();
    const scores = new Map<string, number>();
    for (let m = 0; m < MATCHES; m++) {
      // Three distinct entrants, rotating; the seats rotate too, so no one always has the same neighbour.
      const picks = [m % 6, (m + 1 + Math.floor(m / 6)) % 6, (m + 3 + 2 * Math.floor(m / 6)) % 6];
      const set = [...new Set(picks)];
      for (let extra = 0; set.length < 3; extra++) if (!set.includes((m + extra) % 6)) set.push((m + extra) % 6);
      const seats = set.map((i) => ENTRANTS[i] as Entrant);
      const turn = m % 3;
      const entrants = [...seats.slice(turn), ...seats.slice(0, turn)];
      const result = playMatch(SEEDS[m % SEEDS.length] as string, entrants, DAYS);
      updateElo(ratings, result);
      result.names.forEach((n, i) => {
        games.set(n, (games.get(n) ?? 0) + 1);
        scores.set(n, (scores.get(n) ?? 0) + (result.scores[i] as number));
      });
      console.log(JSON.stringify({ seed: result.seed, names: result.names, scores: result.scores.map((x) => Math.round(x)), winner: result.winner }));
    }
    const table = [...ratings.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, elo]) => ({ name, elo: Math.round(elo), games: games.get(name) ?? 0, meanScore: Math.round(((scores.get(name) ?? 0) / (games.get(name) ?? 1)) * 10) / 10 }));
    console.log("\n" + table.map((r) => `${r.name.padEnd(16)} Elo ${r.elo}  games ${r.games}  mean score ${r.meanScore}`).join("\n"));
    writeFileSync("soak-tournament.json", JSON.stringify({ matches: MATCHES, days: DAYS, table }, null, 1));
  }, 3_600_000);
});
