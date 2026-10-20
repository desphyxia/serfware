import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { World } from "../../src/sim/world";
import { Economy } from "../../src/sim/econ/economy";

/**
 * Which buildings a seat loses, and to what (#164): `node lost.mjs <size> <seed> <days> [lattice]` plays the assess game (the
 * standard stack, three rivals, no war) and wraps `Economy.removeBuilding`. Every removal is counted by the owner, whether the
 * building was finished, the cause (the nearest of fire, stranding, a demolish command, a flag removed, a falling star, as read
 * from the call stack) and, for a command, the AI routine that gave it. Prints one line per (cause, routine, kind) with the
 * count and the first day, then the lost buildings per seat by day. Read-only: it only watches.
 */
const [size, seed, days, ...flags] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string, ...string[]];
const lattice = flags.includes("lattice");
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
aiOptions.toolsByDemand = aiOptions.oreMines = aiOptions.releaseStalled = aiOptions.toolsmithAnyway = aiOptions.forgeRoom = aiOptions.graniteFirst = true;
aiOptions.turnBuildings = aiOptions.widePlacement = true;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  ...(lattice && { latticeRoads: true }),
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const counts = new Map<string, { n: number; first: number; kinds: Record<string, number> }>();
const perDay = new Map<string, number>();
const proto = Economy.prototype as unknown as { removeBuilding(b: { alive: boolean; built: boolean; owner: number; def: { id: string } }): void };
const real = proto.removeBuilding;
proto.removeBuilding = function (this: Economy, b) {
  if (b.alive) {
    const stack = (new Error().stack ?? "").split("\n").slice(2);
    const names = stack.map((l) => /at (?:\w+\.)?([\w$]+)/.exec(l)?.[1] ?? "?");
    const cause = ["scorchBuilding", "stepStranded", "cmdDemolish", "removeFlag", "removeBuildingAt"].find((c) => names.includes(c)) ?? "other:" + names.slice(0, 3).join("<");
    // The routine behind a command: the first frames above cmdDemolish that are not the plumbing.
    const i = names.indexOf("cmdDemolish");
    const skip = new Set(["command", "act", "apply", "execute", "run", "step", "stepAi", "tick", "?", "cmdDemolish", "removeFlag", "doCommand", "dispatch", "issue"]);
    const above = i >= 0 ? names.slice(i + 1).filter((n) => !skip.has(n)).slice(0, 2).join("<") : "";
    const day = Math.floor(this.tick / this.dayTicks) + 1;
    const key = `${cause}${above ? " via " + above : ""}`;
    const c = counts.get(key) ?? { n: 0, first: day, kinds: {} };
    c.n++;
    const kind = `${b.def.id}${b.built ? "" : "(site)"}`;
    c.kinds[kind] = (c.kinds[kind] ?? 0) + 1;
    counts.set(key, c);
    if (b.owner >= 1) perDay.set(`${b.owner}:${day}`, (perDay.get(`${b.owner}:${day}`) ?? 0) + 1);
  }
  return real.call(this, b);
};
for (let d = 1; d <= Number(days); d++) {
  const stop = w.tick + eco.dayTicks;
  while (w.tick < stop) w.step();
}
console.log(`${size} ${seed} ${days} days ${lattice ? "LATTICE" : "tile-centre roads"}`);
for (const [k, c] of [...counts.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const kinds = Object.entries(c.kinds).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t}:${n}`).join(" ");
  console.log(`${String(c.n).padStart(5)}  first day ${String(c.first).padStart(3)}  ${k}  [${kinds}]`);
}
for (let p = 1; p <= 3; p++) {
  const row: string[] = [];
  for (let d = 1; d <= Number(days); d++) {
    const n = perDay.get(`${p}:${d}`);
    if (n) row.push(`${d}:${n}`);
  }
  console.log(`seat ${p} lost by day: ${row.join(" ") || "none"}`);
}
