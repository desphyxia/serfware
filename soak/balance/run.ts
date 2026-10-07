import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import type { AiLevel, Personality } from "../../src/sim/ai/personality";
import { GOODS } from "../../src/sim/econ/defs";
import type { Difficulty } from "../../src/sim/econ/adversity";
import { ORE_PRESETS, type MapOptions } from "../../src/sim/econ/landuse";
import type { GridSize } from "../../src/sim/planet/grid";
import { World } from "../../src/sim/world";
import { invariants } from "../invariants";
import { Probe, SAMPLES_PER_DAY, type ProbeData } from "./probe";

/** One balance game as plain data, so it can be handed to another process. */
export interface GameSpec {
  /** Unique key of the game within its suite; the sweep skips keys it already has. */
  id: string;
  suite: string;
  /** Free labels the report groups by (for example { temper: "warden", size: "tiny" }). */
  tags: Record<string, string>;
  seed: string;
  size: GridSize;
  personalities: Personality[];
  level: AiLevel;
  difficulty: Difficulty;
  days: number;
  peaceDays: number;
  /** Team per rival seat; seat 0 is the steward, which is always on team 0. */
  teams?: number[];
  goal?: "conquest" | "bloom";
  /** An id of ORE_PRESETS (landuse.ts); omitted for the default mix. */
  orePreset?: string;
  map?: MapOptions;
  fairStarts?: boolean;
}

export interface PlayerSample {
  built: number;
  people: number;
  glow: number;
  /** Share of finished workplaces whose worker did no work yesterday. */
  idle: number;
  /** Warehouse stock per good (the same order as GOODS). */
  stock: number[];
}

export interface GameRecord {
  spec: GameSpec;
  /** One sample per game day per rival seat (index 0 is seat 1). */
  days: PlayerSample[][];
  /** Buildings by type at the end, per rival seat. */
  finalBuildings: Record<string, number>[];
  goods: string[];
  captures: number;
  fallen: number;
  winner: number;
  /** The day the game ended with a winner, or -1. */
  endDay: number;
  /** Rule violations found by the daily invariant check (first 10, in the order found). */
  broken: string[];
  /** All of them: every (day, message) pair, and the same counted per kind of message with the numbers replaced by #. Absent in older records, whose `broken` is capped at 10. */
  brokenTotal?: number;
  brokenKinds?: Record<string, number>;
  wallMs: number;
  /** Experimental AI behaviours that were on (BALANCE_AI); absent when none. */
  ai?: string[];
  /** Production, idle reasons, build timeline, logistics, people and war record (see probe.ts). Absent in older records, or when BALANCE_PROBE=0. */
  flow?: ProbeData;
}

/** Play a game to its end or its day limit, sampling every rival seat once a day. */
export function playGame(spec: GameSpec): GameRecord {
  const t0 = Date.now();
  // Experimental AI behaviours (see aiOptions in builder.ts): BALANCE_AI="quarry" turns one on; a record says which.
  const ai = (process.env.BALANCE_AI ?? "").split(",").filter(Boolean);
  aiOptions.relocateQuarries = ai.includes("quarry");
  aiOptions.stoneFallback = ai.includes("stone");
  aiOptions.foodByNeed = ai.includes("food");
  aiOptions.stonePriority = ai.includes("priority");
  aiOptions.borderReach = ai.includes("reach");
  aiOptions.borderClear = ai.includes("clear");
  aiOptions.toolsByDemand = ai.includes("tools");
  aiOptions.oreMines = ai.includes("ore");
  aiOptions.releaseStalled = ai.includes("release");
  aiOptions.toolsmithAnyway = ai.includes("smith");
  aiOptions.forgeRoom = ai.includes("forge");
  const w = new World(spec.seed, {
    size: spec.size,
    rivals: spec.personalities.length,
    personalities: spec.personalities,
    aiLevel: spec.level,
    difficulty: spec.difficulty,
    peaceDays: spec.peaceDays,
    goal: spec.goal,
    map: spec.map ?? (spec.orePreset && spec.orePreset !== "balanced" ? { ore: { ...ORE_PRESETS[spec.orePreset]!.mix } } : undefined),
    fairStarts: spec.fairStarts,
    teams: spec.teams,
    brain: (seat) => new AiBuilder(seat.player, seat.rng, seat.personality, seat.level),
  });
  w.command({ t: "steward", of: 0, on: true });
  const eco = w.economy;
  let captures = 0;
  const hooked = eco as unknown as { capture: (b: unknown, owner: number) => void };
  const capture = hooked.capture.bind(eco);
  hooked.capture = (b, owner) => {
    captures++;
    capture(b, owner);
  };
  const seats = spec.personalities.map((_, i) => i + 1);
  const days: PlayerSample[][] = [];
  const broken = new Set<string>();
  const brokenKinds: Record<string, number> = {};
  let endDay = -1;
  // The probe only reads and wraps (see probe.ts); BALANCE_PROBE=0 plays the game without it.
  const probe = process.env.BALANCE_PROBE === "0" ? null : new Probe(eco, seats.length, w.tick);
  for (let d = 0; d < spec.days && eco.winner < 0; d++) {
    probe?.beginDay(d);
    const start = w.tick;
    for (let slot = 1; slot <= SAMPLES_PER_DAY; slot++) {
      const stop = start + Math.round((eco.dayTicks * slot) / SAMPLES_PER_DAY);
      while (w.tick < stop && eco.winner < 0) w.step();
      probe?.sample(slot);
    }
    days.push(
      seats.map((p) => {
        const mine = eco.buildings.filter((b) => b.alive && b.built && b.owner === p);
        const work = mine.filter((b) => b.def.job);
        const idle = work.filter((b) => b.busyPrev === 0).length;
        return {
          built: mine.length,
          people: eco.people.filter((x) => x.alive && x.owner === p).length,
          glow: Math.round(eco.glow[p] ?? 0),
          idle: work.length ? Math.round((idle / work.length) * 100) / 100 : 0,
          stock: eco.storageTotals(p).map((n) => Math.round(n)),
        };
      }),
    );
    probe?.endDay();
    for (const msg of invariants(w)) {
      const line = `day ${d + 1}: ${msg}`;
      if (broken.has(line)) continue;
      broken.add(line);
      const kind = msg.replace(/\d+/g, "#");
      brokenKinds[kind] = (brokenKinds[kind] ?? 0) + 1;
    }
  }
  if (eco.winner >= 0) endDay = days.length;
  const finalBuildings = seats.map((p) => {
    const out: Record<string, number> = {};
    for (const b of eco.buildings) if (b.alive && b.built && b.owner === p) out[b.def.id] = (out[b.def.id] ?? 0) + 1;
    return out;
  });
  return {
    spec,
    days,
    finalBuildings,
    goods: GOODS.map((g) => g.id),
    captures,
    fallen: seats.filter((p) => eco.defeated[p]).length,
    winner: eco.winner,
    endDay,
    broken: [...broken].slice(0, 10),
    brokenTotal: broken.size,
    brokenKinds,
    wallMs: Date.now() - t0,
    ...(ai.length && { ai }),
    ...(probe && { flow: probe.data }),
  };
}
