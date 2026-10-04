// Balance sweep: plays a matrix of long all-AI games, one node process per game, and appends one JSON line per
// game to balance-out/<suite>.jsonl. Resumable: games already in the file are skipped, so you can stop it
// (Ctrl-C) and start it again. Usage:
//   node scripts/balance-sweep.mjs [suite ...] [--seeds 30] [--days N] [--workers N] [--out balance-out]
// Suites: economy, war, ore (default: all). See docs/BALANCE.md.
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

function cross(dims, seedList, make) {
  const keys = Object.keys(dims);
  let combos = [{}];
  for (const k of keys) combos = combos.flatMap((c) => dims[k].map((v) => ({ ...c, [k]: v })));
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

const suites = wanted.length ? wanted : Object.keys(SUITES);
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
