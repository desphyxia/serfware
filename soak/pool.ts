import { execFileSync, spawn } from "node:child_process";
import { cpus } from "node:os";
import type { EntrantSpec, Result } from "./league";

export interface MatchJob {
  seed: string;
  entrants: EntrantSpec[];
  days: number;
  peaceDays?: number;
}

const BUNDLE = "artifacts/match-job.mjs";
let bundled = false;

/** Bundle the one-match job (once per run) so any number of node processes can play matches at once. */
function bundle(): void {
  if (bundled) return;
  execFileSync(process.execPath, ["scripts/bundle-job.mjs", BUNDLE], { stdio: "ignore" });
  bundled = true;
}

/**
 * Play matches in parallel, one node process each, `workers` at a time (default: one per core). Results come back
 * in the order of the jobs and are identical to playing them one by one: a match depends only on its seed and
 * entrants, so nothing is shared between them.
 */
export async function runMatches(jobs: MatchJob[], workers = Math.max(1, cpus().length)): Promise<Result[]> {
  bundle();
  const results = new Array<Result>(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await new Promise<Result>((resolve, reject) => {
        const child = spawn(process.execPath, [BUNDLE, JSON.stringify(jobs[i])], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop() as string) as Result) : reject(new Error(`match ${i} exited ${code}`))));
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, lane));
  return results;
}
