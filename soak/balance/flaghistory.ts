import { Economy, FLAG_CAPACITY, type Flag } from "../../src/sim/econ/economy";
import type { GridSize } from "../../src/sim/planet/grid";
import { playGame, type GameSpec } from "./run";

/**
 * Who put the goods and reservations on a flag that ends up over capacity: `node flaghistory.mjs <size> <seed> <days>` (BALANCE_AI as
 * the sweep had it) plays the assess game until a flag first holds more than FLAG_CAPACITY goods, plays it again with that flag's goods
 * list and reserved count watched, and prints the last changes to it: the tick, goods and reserved before and after, and the methods
 * that made the change. Read-only.
 */
const [size, seed, days] = process.argv.slice(2) as [GridSize, string, string];
const spec: GameSpec = {
  id: `flaghistory|${size}|${seed}`,
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

// Phase 1: the first flag over capacity at the end of a tick.
let found = -1;
let flagId = -1;
proto.step = function (this: Economy, tick: unknown) {
  originalStep.call(this, tick);
  if (found < 0) {
    const f = this.flags.find((x) => x.alive && x.goods.length > FLAG_CAPACITY);
    if (f) {
      found = this.tick;
      flagId = f.id;
      throw new Error("found");
    }
  }
  return undefined;
} as Method;
try {
  playGame(spec);
} catch (e) {
  if ((e as Error).message !== "found") throw e;
}
console.log(`flag ${flagId} first over capacity at tick ${found} (day ${(found / 7500).toFixed(1)})`);
if (found < 0) process.exit(0);

// Phase 2: the same game with that flag watched from the moment it is made.
proto.step = originalStep;
const events: string[] = [];
let tickNow = () => 0;
const who = () =>
  (new Error().stack ?? "")
    .split("\n")
    .slice(2, 9)
    .map((l) => /at (?:Economy\.)?([A-Za-z_$][\w$]*)/.exec(l)?.[1] ?? "")
    .filter((n) => n && n !== "proto" && n !== "Object")
    .slice(0, 4)
    .join("<");
proto.createFlag = function (this: Economy, ...a: unknown[]) {
  const f = originalCreate.apply(this, a) as Flag;
  tickNow = () => this.tick;
  if (f.id === flagId) {
    let reserved = f.reserved;
    Object.defineProperty(f, "reserved", {
      get: () => reserved,
      set: (v: number) => {
        events.push(`tick ${tickNow()} reserved ${reserved} -> ${v} goods ${f.goods.length}  ${who()}`);
        reserved = v;
      },
    });
    f.goods = new Proxy(f.goods, {
      get(t, p, r) {
        const v = Reflect.get(t, p, r);
        if (p === "push" || p === "splice" || p === "pop" || p === "shift") {
          return (...args: unknown[]) => {
            const n = t.length;
            const out = (v as (...x: unknown[]) => unknown).apply(t, args);
            events.push(`tick ${tickNow()} goods ${n} -> ${t.length} reserved ${reserved} ${String(p)}(${args.map((x) => (typeof x === "number" ? x : "…")).join(",")})  ${who()}`);
            return out;
          };
        }
        return v;
      },
    });
  }
  return f;
} as Method;
try {
  playGame({ ...spec, days: Math.ceil(found / 7500) + 1 });
} catch {
  // the game may stop early
}
for (const e of events.filter((l) => Number(/tick (\d+)/.exec(l)?.[1]) <= found).slice(-28)) console.log(e);
