import { makeEntrant, playMatch, type EntrantSpec } from "./league";

/** One match as a child process: `node match-job.mjs '<json>'` prints the result as a line of JSON. */
const job = JSON.parse(process.argv[2] as string) as { seed: string; entrants: EntrantSpec[]; days: number; peaceDays?: number };
const result = playMatch(job.seed, job.entrants.map(makeEntrant), job.days, job.peaceDays);
process.stdout.write(JSON.stringify(result) + "\n");
