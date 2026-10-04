// Bundle soak/match-job.ts (or the entry given as the second argument) into one file node can run in many processes at once (soak/pool.ts uses it).
import { rolldown } from "rolldown";

const out = process.argv[2] ?? "artifacts/match-job.mjs";
const bundle = await rolldown({ input: process.argv[3] ?? "soak/match-job.ts", platform: "node", logLevel: "warn" });
await bundle.write({ file: out, format: "esm" });
console.log(out);
