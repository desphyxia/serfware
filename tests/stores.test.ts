import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { GOOD_AUTO, GOOD_COLLECT, GOOD_SEND, GOOD_STOP, STORE_IN, STORE_OUT, STORE_STOP, type Economy } from "../src/sim/econ/economy";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";
const inside = (eco: Economy) => eco as unknown as { spawnGood(type: number, flag: number): { dest: number; id: number }; assignDestination(g: unknown): void };

/** A world with a built, connected storehouse. */
function withStorehouse() {
  const w = new World(SEED, { size: "small" });
  const eco = w.economy;
  expect(placeConnected(w, "storehouse", { minDist: 4, maxDist: 8 })).toBe(true);
  const store = eco.buildings.find((b) => b.alive && b.def.id === "storehouse")!;
  for (let i = 0; i < 20000 && !store.built; i++) w.step();
  expect(store.built).toBe(true);
  return { w, eco, store, keep: eco.buildings[eco.keeps[0]!]! };
}

describe("store modes (Serf City's In, Stop and Out)", () => {
  it("a store on In takes surplus goods; on Stop it only holds what it has", () => {
    const { w, eco, store } = withStorehouse();
    expect(store.mode).toBe(STORE_IN);
    const log = goodId("log");
    // A loose good bound for the store.
    const g = inside(eco).spawnGood(log, store.flag);
    g.dest = -1;
    inside(eco).assignDestination(g);
    expect(g.dest).toBe(store.id);
    expect(w.command({ t: "storeMode", building: store.id, mode: STORE_STOP }).ok).toBe(true);
    // Goods that were on their way here look for another home.
    expect(g.dest).toBe(-1);
    expect(store.pending[log]).toBe(0);
    inside(eco).assignDestination(g);
    expect(g.dest).toBe(eco.keeps[0]);
    // The Hearthship has no modes.
    expect(w.command({ t: "storeMode", building: eco.keeps[0]!, mode: STORE_OUT }).ok).toBe(false);
    expect(w.command({ t: "storeMode", building: store.id, mode: 9 }).ok).toBe(false);
  }, 120000);

  it("a store on Out carries everything to the other stores, and can then be demolished", () => {
    const { w, store, keep } = withStorehouse();
    const log = goodId("log");
    const stone = goodId("stone");
    store.stock[log]! += 5;
    store.stock[stone]! += 3;
    const before = (t: number) => (keep.stock[t] as number) + (store.stock[t] as number);
    const total = [before(log), before(stone)];
    // Not while it holds goods.
    const refused = w.command({ t: "demolish", tile: store.tile });
    expect(refused.ok).toBe(false);
    expect((refused as { reason?: string }).reason).toMatch(/holds 8 goods/);
    expect(store.alive).toBe(true);
    expect(w.command({ t: "storeMode", building: store.id, mode: STORE_OUT }).ok).toBe(true);
    for (let i = 0; i < 6000 && store.stock.some((n) => n > 0); i++) w.step();
    expect(store.stock.every((n) => n === 0)).toBe(true);
    // Let the last goods arrive: nothing is lost.
    for (let i = 0; i < 1500; i++) w.step();
    expect([keep.stock[log], keep.stock[stone]].every((n, i) => (n as number) >= (total[i] as number))).toBe(true);
    expect(w.command({ t: "demolish", tile: store.tile }).ok).toBe(true);
    expect(store.alive).toBe(false);
  }, 240000);

  it("a store can stop, send or collect one good while taking the rest", () => {
    const { w, eco, store, keep } = withStorehouse();
    const log = goodId("log");
    const stone = goodId("stone");
    // Stop logs only: stone still comes here, logs go to the Hearthship.
    expect(w.command({ t: "storeGood", building: store.id, good: "log", mode: GOOD_STOP }).ok).toBe(true);
    const a = inside(eco).spawnGood(log, store.flag);
    const b = inside(eco).spawnGood(stone, store.flag);
    a.dest = -1;
    b.dest = -1;
    inside(eco).assignDestination(a);
    inside(eco).assignDestination(b);
    expect(a.dest).toBe(keep.id);
    expect(b.dest).toBe(store.id);
    // Collect logs: new logs go there first, and the Hearthship's logs are carried over.
    expect(w.command({ t: "storeGood", building: store.id, good: "log", mode: GOOD_COLLECT }).ok).toBe(true);
    const c = inside(eco).spawnGood(log, keep.flag);
    c.dest = -1;
    inside(eco).assignDestination(c);
    expect(c.dest).toBe(store.id);
    keep.stock[log]! += 6;
    const heldBefore = store.stock[log]!;
    for (let i = 0; i < 4000; i++) w.step();
    expect(store.stock[log]!).toBeGreaterThan(heldBefore);
    // Send stone: the store's stone is carried to the Hearthship even though the store takes goods in.
    store.stock[stone]! += 4;
    expect(w.command({ t: "storeGood", building: store.id, good: "stone", mode: GOOD_SEND }).ok).toBe(true);
    for (let i = 0; i < 4000 && store.stock[stone]! > 0; i++) w.step();
    expect(store.stock[stone]).toBe(0);
    // The Hearthship may collect but never stop or send.
    expect(w.command({ t: "storeGood", building: keep.id, good: "log", mode: GOOD_STOP }).ok).toBe(false);
    expect(w.command({ t: "storeGood", building: keep.id, good: "log", mode: GOOD_SEND }).ok).toBe(false);
    expect(w.command({ t: "storeGood", building: keep.id, good: "log", mode: GOOD_COLLECT }).ok).toBe(true);
    expect(w.command({ t: "storeGood", building: store.id, good: "nonsense", mode: GOOD_AUTO }).ok).toBe(false);
  }, 240000);
});
