import { Economy } from "../../src/sim/econ/economy";
import { Use } from "../../src/sim/econ/landuse";
import type { GridSize } from "../../src/sim/planet/grid";
import { playGame, type GameSpec } from "./run";

/**
 * A flag that is not on its tile: `node notontile.mjs <size> <seed> <days>` (BALANCE_AI as the sweep had it) plays the assess game until
 * a living flag's tile no longer says "this flag" (land.use is not Flag, or land.ref is another id), and prints the flag, its tile's use,
 * ref and feature, the building and flags round it, and who made the flag (the methods on the stack when it was created). Read-only.
 */
const [size, seed, days] = process.argv.slice(2) as [GridSize, string, string];
const spec: GameSpec = {
  id: `notontile|${size}|${seed}`,
  suite: "assess",
  tags: { size },
  seed,
  size,
  personalities: ["builder", "trader", "warden"],
  level: "normal",
  difficulty: "honest",
  days: Number(days),
  peaceDays: 999,
};

type Method = (this: Economy, ...a: unknown[]) => unknown;
const proto = Economy.prototype as unknown as Record<string, Method>;
const originalStep = proto.step as Method;
const originalCreate = proto.createFlag as Method;
const made = new Map<number, string>();
const who = () =>
  (new Error().stack ?? "")
    .split("\n")
    .slice(2, 12)
    .map((l) => /at (?:Economy\.)?([A-Za-z_$][\w$]*)/.exec(l)?.[1] ?? "")
    .filter((n) => n && n !== "proto" && n !== "Object")
    .slice(0, 6)
    .join("<");
proto.createFlag = function (this: Economy, ...a: unknown[]) {
  const f = originalCreate.apply(this, a) as { id: number };
  made.set(f.id, `tick ${this.tick} tile ${String(a[0])} owner ${String(a[1])}  ${who()}`);
  return f;
} as Method;
proto.step = function (this: Economy, tick: unknown) {
  originalStep.call(this, tick);
  const land = (this as unknown as { land: import("../../src/sim/econ/landuse").LandUse }).land;
  for (const f of this.flags) {
    if (!f.alive || (land.use[f.tile] === Use.Flag && land.ref[f.tile] === f.id)) continue;
    const grid = land.planet.grid;
    console.log(`tick ${this.tick} (day ${(this.tick / this.dayTicks).toFixed(2)}): flag ${f.id} owner ${f.owner} tile ${f.tile} building ${f.building} roads ${f.roads.join(",")}`);
    console.log(`  tile use ${land.use[f.tile]} (Flag ${Use.Flag}) ref ${land.ref[f.tile]} feature ${land.feature[f.tile]} territory ${land.territory[f.tile]}`);
    console.log(`  made: ${made.get(f.id)}`);
    const here = this.buildings.filter((b) => b.alive && (b.tile === f.tile || b.flag === f.id));
    for (const b of here) console.log(`  building ${b.id} ${b.def.id} tile ${b.tile} flag ${b.flag} built ${b.built}`);
    for (const n of grid.neighborsOf(f.tile)) console.log(`  neighbour ${n}: use ${land.use[n]} ref ${land.ref[n]} feature ${land.feature[n]}`);
    throw new Error("found");
  }
  return undefined;
} as Method;
let foundTick = -1;
let foundTile = -1;
let foundFlag = -1;
proto.step = function (this: Economy, tick: unknown) {
  originalStep.call(this, tick);
  const land = (this as unknown as { land: import("../../src/sim/econ/landuse").LandUse }).land;
  for (const f of this.flags) {
    if (!f.alive || (land.use[f.tile] === Use.Flag && land.ref[f.tile] === f.id)) continue;
    foundTick = this.tick;
    foundTile = f.tile;
    foundFlag = f.id;
    throw new Error("found");
  }
  return undefined;
} as Method;
try {
  playGame(spec);
  console.log("no flag off its tile in this game");
} catch (e) {
  if ((e as Error).message !== "found") throw e;
}
if (foundTick < 0) process.exit(0);
console.log(`flag ${foundFlag} tile ${foundTile} first wrong at tick ${foundTick}`);

// Phase 3: the same game with every Economy and LandUse method watched in that tick, for the first to leave the tile wrong.
proto.step = originalStep;
proto.createFlag = originalCreate;
let watching = false;
let reported = false;
let landRef: import("../../src/sim/econ/landuse").LandUse | undefined;
const wrap = (target: Record<string, Method>, label: string) => {
  for (const name of Object.getOwnPropertyNames(target)) {
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (name === "constructor" || name === "step" || !d || typeof d.value !== "function") continue;
    const fn = d.value as Method;
    target[name] = function (this: unknown, ...a: unknown[]) {
      const r = fn.apply(this as Economy, a);
      if (watching && !reported && landRef && !(landRef.use[foundTile] === Use.Flag && landRef.ref[foundTile] === foundFlag)) {
        reported = true;
        console.log(`first wrong after ${label}.${name}(${a.map((x) => (typeof x === "number" ? x : typeof x)).join(",")}); use ${landRef.use[foundTile]} ref ${landRef.ref[foundTile]}`);
        console.log(
          (new Error().stack ?? "")
            .split("\n")
            .slice(2, 14)
            .map((l) => /at (?:\w+\.)?([A-Za-z_$][\w$]*)/.exec(l)?.[1] ?? "")
            .filter((n) => n && n !== "proto" && n !== "Object")
            .join(" < "),
        );
      }
      return r;
    };
  }
};
const landProto = Object.getPrototypeOf((await import("../../src/sim/econ/landuse")).LandUse.prototype) === null ? null : (await import("../../src/sim/econ/landuse")).LandUse.prototype;
wrap(proto, "Economy");
if (landProto) wrap(landProto as unknown as Record<string, Method>, "LandUse");
proto.step = function (this: Economy, tick: unknown) {
  landRef = (this as unknown as { land: import("../../src/sim/econ/landuse").LandUse }).land;
  watching = this.tick >= foundTick - 1;
  originalStep.call(this, tick);
  return undefined;
} as Method;
try {
  playGame({ ...spec, days: Math.ceil(foundTick / 6900) + 1 });
} catch {
  // the game may stop early
}
if (!reported) console.log("not reproduced in the second pass");
