// Bundle soak/match-job.ts into one file node can run in many processes at once (soak/pool.ts uses it).
import { rolldown } from "rolldown";

const out = process.argv[2] ?? "artifacts/match-job.mjs";
const bundle = await rolldown({ input: "soak/match-job.ts", platform: "node", logLevel: "warn" });
await bundle.write({ file: out, format: "esm" });
console.log(out);
