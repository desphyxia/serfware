// Balance sweep: plays a matrix of long all-AI games, one node process per game, and appends one JSON line per
// game to balance-out/<suite>.jsonl. Resumable: games already in the file are skipped, so you can stop it
// (Ctrl-C) and start it again. Usage:
//   node scripts/balance-sweep.mjs [suite ...] [--seeds 30] [--days N] [--workers N] [--out balance-out]
// Suites: economy, war, ore, players (default: economy, war, ore). See docs/BALANCE.md.
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const SEEDS = Number(opt("seeds", 30));
const DAYS = opt("days", undefined);
const WORKERS = Number(opt("workers", Math.max(1, cpus().length - 1)));
const OUT = opt("out", "balance-out");
const wanted = args.filter((a) => !a.startsWith("--"));

const seeds = Array.from({ length: SEEDS }, (_, i) => `bal-${String(i + 1).padStart(3, "0")}`);
const TEMPERS = ["builder", "trader", "warden"];
const ORE_PRESETS = ["balanced", "fuel", "gold", "poor", "stone"]; // ids in ORE_PRESETS (landuse.ts)
const LEVELS = ["easy", "normal", "hard"];
// The (size, players) cells of the `players` suite.
const PLAYER_CELLS = new Set(["tiny-2", "tiny-3", "small-3", "small-4", "medium-3", "medium-4", "medium-5", "medium-6"]);

/** Each suite makes its games from the matrix of its dimensions; `tags` are what the report groups by. */
const SUITES = {
  // Growth curves: three rivals of one temperament and level, peace all game, so only the economy is measured.
  economy: () =>
    cross({ temper: TEMPERS, level: LEVELS, size: ["tiny", "small"], difficulty: ["honest"] }, seeds, (t, seed) => ({
      personalities: [t.temper, t.temper, t.temper],
      level: t.level,
      size: t.size,
      difficulty: t.difficulty,
      days: Number(DAYS ?? 60),
      peaceDays: 999,
      seed,
    })),
  // War pacing: three Wardens, short peace, long game: do wars end, how fast.
  war: () =>
    cross({ level: LEVELS, size: ["tiny", "small"] }, seeds, (t, seed) => ({
      personalities: ["warden", "warden", "warden"],
      level: t.level,
      size: t.size,
      difficulty: "honest",
      days: Number(DAYS ?? 200),
      peaceDays: 5,
      seed,
    })),
  // Player counts: the same economy with fewer or more players on a map, to tell the size of the map from the land each
  // player gets. `players` counts everyone: player 0 (the steward seat, not measured) and the AI rivals, all of one
  // temperament, so 2 players is one rival. Medium games run 90 days: the land lasts longer there.
  players: () =>
    cross(
      { size: ["tiny", "small", "medium"], players: ["2", "3", "4", "5", "6"], temper: TEMPERS },
      seeds,
      (t, seed) => ({
        personalities: Array.from({ length: Number(t.players) - 1 }, () => t.temper),
        level: "normal",
        size: t.size,
        difficulty: "honest",
        days: Number(DAYS ?? (t.size === "medium" ? 90 : 60)),
        peaceDays: 999,
        seed,
      }),
      (t) => PLAYER_CELLS.has(`${t.size}-${t.players}`),
    ),
  // Ore mixes: the same economy on the map settings the game offers.
  ore: () =>
    cross({ mix: ORE_PRESETS }, seeds, (t, seed) => ({
      personalities: ["builder", "trader", "warden"],
      level: "normal",
      size: "small",
      difficulty: "honest",
      days: Number(DAYS ?? 60),
      peaceDays: 999,
      orePreset: t.mix,
      seed,
    })),
};

function cross(dims, seedList, make, keep = () => true) {
  const keys = Object.keys(dims);
  let combos = [{}];
  for (const k of keys) combos = combos.flatMap((c) => dims[k].map((v) => ({ ...c, [k]: v })));
  combos = combos.filter(keep);
  return combos.flatMap((tags) =>
    seedList.map((seed) => ({ tags, ...make(tags, seed) })),
  );
}

function specsFor(suite) {
  return SUITES[suite]().map((g) => ({
    id: `${suite}|${Object.values(g.tags).join("|")}|${g.seed}`,
    suite,
    tags: g.tags,
    seed: g.seed,
    size: g.size,
    personalities: g.personalities,
    level: g.level,
    difficulty: g.difficulty,
    days: g.days,
    peaceDays: g.peaceDays,
    orePreset: g.orePreset,
  }));
}

const suites = wanted.length ? wanted : ["economy", "war", "ore"];
for (const s of suites) if (!SUITES[s]) throw new Error(`unknown suite ${s}; known: ${Object.keys(SUITES).join(", ")}`);

mkdirSync(OUT, { recursive: true });
const BUNDLE = "artifacts/balance-job.mjs";
execFileSync(process.execPath, ["scripts/bundle-job.mjs", BUNDLE, "soak/balance/job.ts"], { stdio: "ignore" });

const jobs = [];
for (const suite of suites) {
  const file = `${OUT}/${suite}.jsonl`;
  const done = new Set();
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) if (line.trim()) done.add(JSON.parse(line).spec.id);
  for (const spec of specsFor(suite)) if (!done.has(spec.id)) jobs.push({ spec, file });
}
// Longest games first, so the slow ones do not start last and run alone while the other cores sit idle. The factors are
// mean game times from the 2-seed economy pilot (traders 14 min, builders 13, wardens 9; small worlds 13 min, tiny 11);
// games of a suite without these tags keep their order. The order changes no result, only when each game runs.
// Medium worlds and more rivals are guesses (a quarter of a game is fixed, the rest grows with the rivals), not measured.
const cost = ({ spec }) => spec.days * ({ trader: 1.5, builder: 1.35, warden: 1 }[spec.tags.temper] ?? 1) * ({ medium: 2.5, small: 1.2, tiny: 1 }[spec.size] ?? 1) * (0.25 + 0.25 * spec.personalities.length);
jobs.sort((a, b) => cost(b) - cost(a));
console.log(`${jobs.length} games to play on ${WORKERS} workers`);

let next = 0;
let finished = 0;
const started = Date.now();
const lane = async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [BUNDLE, JSON.stringify(job.spec)], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("close", (code) => {
        if (code === 0) appendFileSync(job.file, out.trim().split("\n").pop() + "\n");
        else console.error(`FAILED (exit ${code}): ${job.spec.id}`);
        finished++;
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`[${finished}/${jobs.length}] ${mins} min  ${job.spec.id}`);
        resolve();
      });
    });
  }
};
await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, lane));
console.log("done; now run: node scripts/balance-report.mjs");
