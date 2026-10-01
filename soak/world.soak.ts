import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Personality } from "../src/sim/ai/personality";
import { World, type WorldOptions } from "../src/sim/world";
import { invariants } from "./invariants";

/**
 * Long all-AI games. Every settlement is played by the AI (the human seat by a steward), the
 * world runs for many game days, and once a day the rules that must always hold are checked.
 * Run with `npm run soak`; SOAK_DAYS sets the length (default 30), SOAK_SEEDS the seeds.
 */
const DAYS = Number(process.env.SOAK_DAYS ?? 30);
const SEEDS = (process.env.SOAK_SEEDS ?? "russet-heron-417,amber-fern-212").split(",");
const report: Record<string, unknown>[] = [];

interface Run {
  world: World;
  days: number;
  msPerDay: number[];
  broken: string[];
}

/** Play a world for up to `days` game days (or until someone wins), checking it every day. */
function play(seed: string, opts: WorldOptions, days: number, untilWin = false): Run {
  const world = new World(seed, opts);
  // The human seat is played by a steward, like a player who walked away.
  world.command({ t: "steward", of: 0, on: true });
  const msPerDay: number[] = [];
  const broken: string[] = [];
  let d = 0;
  for (; d < days; d++) {
    const t0 = performance.now();
    const end = world.tick + world.economy.dayTicks;
    while (world.tick < end) world.step();
    msPerDay.push(performance.now() - t0);
    const bad = invariants(world);
    if (bad.length) {
      broken.push(...bad.map((b) => `day ${d + 1}: ${b}`));
      break;
    }
    if (untilWin && world.economy.winner >= 0) {
      d++;
      break;
    }
  }
  return { world, days: d, msPerDay, broken };
}

function summary(name: string, seed: string, r: Run): Record<string, unknown> {
  const eco = r.world.economy;
  const players = eco.keeps.map((_, p) => ({
    player: p,
    name: eco.playerName(p),
    temper: r.world.ai.find((a) => a.player === p)?.personality ?? "steward",
    buildings: eco.buildings.filter((b) => b.alive && b.built && b.owner === p).length,
    people: eco.people.filter((x) => x.alive && x.owner === p).length,
    glow: Math.round(eco.glow[p] ?? 0),
    defeated: !!eco.defeated[p],
  }));
  const sorted = [...r.msPerDay].sort((a, b) => a - b);
  const s = {
    name,
    seed,
    days: r.days,
    winner: eco.winner,
    winReason: eco.winReason,
    msPerDay: { median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), max: Math.round(sorted[sorted.length - 1] ?? 0), first: Math.round(r.msPerDay[0] ?? 0), last: Math.round(r.msPerDay[r.msPerDay.length - 1] ?? 0) },
    players,
    broken: r.broken,
  };
  report.push(s);
  console.log(JSON.stringify(s));
  return s;
}

const RIVALS: Personality[] = ["builder", "trader", "warden"];

describe("soak", () => {
  for (const seed of SEEDS) {
    it(`${seed}: a long game with three rivals keeps every rule, and gets no slower`, () => {
      // Peace for the whole run: this one is about growing (the war below is about fighting).
      const r = play(seed, { size: "small", rivals: 3, personalities: RIVALS, peaceDays: DAYS + 1 }, DAYS);
      summary("economy", seed, r);
      expect(r.broken).toEqual([]);
      expect(r.days).toBe(DAYS);
      // Every settlement grew.
      for (let p = 0; p < 4; p++) expect(r.world.economy.buildings.filter((b) => b.alive && b.built && b.owner === p).length).toBeGreaterThan(4);
      // Late days cost at most a few times the early ones.
      const early = r.msPerDay.slice(1, 4).reduce((a, b) => a + b, 0) / 3;
      const late = r.msPerDay.slice(-3).reduce((a, b) => a + b, 0) / 3;
      expect(late).toBeLessThan(Math.max(early * 6, 2000));
    });
  }

  it("the same seed plays the same game, day after day", () => {
    const days = Math.min(DAYS, 12);
    const a = new World(SEEDS[0]!, { size: "small", rivals: 3, personalities: RIVALS });
    const b = new World(SEEDS[0]!, { size: "small", rivals: 3, personalities: RIVALS });
    for (const w of [a, b]) w.command({ t: "steward", of: 0, on: true });
    for (let d = 0; d < days; d++) {
      const end = a.tick + a.economy.dayTicks;
      while (a.tick < end) {
        a.step();
        b.step();
      }
      expect(b.checksum(), `day ${d + 1}`).toBe(a.checksum());
    }
  });

  it("a war of four Wardens plays through to the end", () => {
    const r = play(SEEDS[0]!, { size: "tiny", rivals: 3, personalities: ["warden", "warden", "warden"], aiLevel: "hard", peaceDays: 1 }, Math.max(DAYS * 3, 60), true);
    summary("war", SEEDS[0]!, r);
    expect(r.broken).toEqual([]);
  });

  it("two against two: teams keep every rule over a long game", () => {
    const r = play(SEEDS[1] ?? SEEDS[0]!, { size: "small", rivals: 3, teams: [0, 0, 1, 1], personalities: ["trader", "warden", "warden"], peaceDays: 2 }, DAYS);
    summary("teams", SEEDS[1] ?? SEEDS[0]!, r);
    expect(r.broken).toEqual([]);
  });

  it("writes the report", () => {
    writeFileSync(process.env.SOAK_REPORT ?? "soak-report.json", JSON.stringify({ days: DAYS, runs: report }, null, 2));
  });
});
