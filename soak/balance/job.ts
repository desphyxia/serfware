import { playGame, type GameSpec } from "./run";

/** One balance game as a child process: `node balance-job.mjs '<json spec>'` prints the record as a line of JSON. */
process.stdout.write(JSON.stringify(playGame(JSON.parse(process.argv[2] as string) as GameSpec)) + "\n");
