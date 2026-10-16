import { Economy, FLAG_CAPACITY } from "../../src/sim/econ/economy";
import type { GridSize } from "../../src/sim/planet/grid";
import { playGame, type GameSpec } from "./run";

/**
 * How a flag comes to hold more than FLAG_CAPACITY goods: `node overfull.mjs <size> <seed> <days>` (with BALANCE_AI as the sweep had
 * it) plays the assess game until a flag first holds 9, then plays it again and, in the tick before, checks after every Economy
 * method returns; the first to leave a flag over capacity is named with its stack, the flag and the carriers headed for it. Read-only.
 */
const [size, seed, days] = process.argv.slice(2) as [GridSize, string, string];
const spec: GameSpec = {
  id: `overfull|${size}|${seed}`,
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
const originals = new Map<string, Method>();
for (const name of Object.getOwnPropertyNames(proto)) {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  if (name === "constructor" || name === "step" || !d || typeof d.value !== "function") continue;
  originals.set(name, d.value as Method);
}

const over = (eco: Economy) => eco.flags.find((f) => f.alive && f.goods.length > FLAG_CAPACITY);

// Phase 1: the tick of the first overfull flag.
let found = -1;
proto.step = function (this: Economy, tick: unknown) {
  originalStep.call(this, tick);
  if (found < 0 && over(this)) {
    found = this.tick;
    throw new Error("found");
  }
  return undefined;
} as Method;
try {
  playGame(spec);
} catch (e) {
  if ((e as Error).message !== "found") throw e;
}
console.log(`first flag over capacity at tick ${found} (day ${(found / 7500).toFixed(1)})`);
if (found < 0) process.exit(0);

// Phase 2: the same game, watching every method in that tick.
let watching = false;
let reported = false;
let lastReport = "";
let depth = 0;
for (const [name, fn] of originals) {
  proto[name] = function (this: Economy, ...a: unknown[]) {
    depth++;
    let r: unknown;
    try {
      r = fn.apply(this, a);
    } finally {
      depth--;
    }
    // Only when an outermost call is done: inside one a flag may hold a good for a moment (a swap puts one down, then takes one up).
    if (watching && !reported && depth === 0) {
      const f = over(this);
      if (f) {
        reported = true;
        lastReport = `outermost method ${name} left flag ${f.id} with ${f.goods.length} goods, reserved ${f.reserved}`;
        console.log(lastReport);
        const arg = a[0] as { id?: number; role?: string; state?: string; road?: number; target?: number; back?: number; carryGood?: number } | undefined;
        if (arg && typeof arg === "object" && "state" in arg) console.log(`  argument settler ${arg.id}: role ${arg.role} state ${arg.state} road ${arg.road} target ${arg.target} back ${arg.back} carryGood ${arg.carryGood}`);
        console.log(
          "goods:",
          f.goods.map((id) => {
            const g = this.goods[id]!;
            return `${id}(carrier ${g.carrier}, since ${this.tick - g.since})`;
          }).join(" "),
        );
        for (const s of this.settlers) {
          if (!s.alive || s.role !== "carrier") continue;
          if (s.target === f.id || s.back === f.id) console.log(`carrier ${s.id} road ${s.road} state ${s.state} target ${s.target} back ${s.back} carryGood ${s.carryGood}`);
        }
      }
    }
    return r;
  };
}
let before = "";
proto.step = function (this: Economy, tick: unknown) {
  watching = this.tick === found - 1;
  if (watching) {
    // What every flag and carrier held at the start of the tick, as text, for the flag that goes over.
    const lines: string[] = [];
    for (const f of this.flags) if (f.alive && f.goods.length + f.reserved >= FLAG_CAPACITY - 1) lines.push(`flag ${f.id}: goods ${f.goods.length} reserved ${f.reserved} roads ${f.roads.join(",")} goodsList ${f.goods.map((id) => `${id}[c${this.goods[id]!.carrier}]`).join(" ")}`);
    for (const s of this.settlers) if (s.alive && s.role === "carrier") lines.push(`carrier ${s.id}: road ${s.road} idx ${s.roadIdx} state ${s.state} target ${s.target} back ${s.back} carryGood ${s.carryGood}`);
    before = lines.join("\n");
  }
  originalStep.call(this, tick);
  watching = false;
  return undefined;
} as Method;
try {
  playGame({ ...spec, days: Math.ceil(found / 7500) + 1 });
} catch {
  // the game may stop early
}
if (reported) {
  const flagLine = /flag (\d+) with/.exec(lastReport)?.[1];
  const roadsOfFlag = new Set<string>();
  for (const l of before.split("\n")) {
    if (!l.startsWith(`flag ${flagLine}:`)) continue;
    console.log("before:", l);
    for (const r of (/roads ([\d,]*)/.exec(l)?.[1] ?? "").split(",")) roadsOfFlag.add(r);
  }
  for (const l of before.split("\n")) {
    const m = /^carrier \d+: road (\d+)/.exec(l);
    if (m && roadsOfFlag.has(m[1] as string)) console.log("before:", l);
  }
}
if (!reported) console.log("not reproduced in the second pass (the tick differs?)");
