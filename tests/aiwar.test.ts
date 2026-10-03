import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { ARM_MOUNT } from "../src/sim/econ/people";
import { World } from "../src/sim/world";

function tally(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of w.aiLog) {
    if (!a.ok) continue;
    const k = a.cmd.t === "build" ? `build:${(a.cmd as { type: string }).type}` : a.cmd.t;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe("the AI at war and in public works", () => {
  it("palisades, camps, raids, breaks a truce and bridges", { timeout: 900000 }, () => {
    const all: Record<string, number> = {};
    for (const seed of ["amber-fern-212", "glade-iris-904"]) {
      const w = new World(seed, { size: "tiny", rivals: 3, personalities: ["warden", "warden", "trader"], peaceDays: 3 });
      w.command({ t: "steward", of: 0, on: true });
      w.recordAi = true;
      const eco = w.economy;
      // Two Wardens sit under a truce they would rather not keep.
      eco.diplomacy.treaties.push({ id: 0, kind: "truce", a: 1, b: 2, until: 1e9, broken: false } as never);
      (eco.diplomacy as unknown as { sync(): void }).sync();
      for (let i = 0; i < 40 * eco.dayTicks; i++) {
        // Timber and stone are topped up, and wardens are mounted (a stable's work), so this tests the war.
        if (i % eco.dayTicks === 0) {
          for (const p of [1, 2, 3]) {
            const k = eco.buildings[eco.keeps[p]!]!;
            for (const g of ["log", "plank", "stone"]) (k.stock as number[])[goodId(g)] = Math.max((k.stock as number[])[goodId(g)] ?? 0, 30);
          }
        }
        if (i % 600 === 0) for (const s of eco.settlers) if (s.alive && s.owner >= 1 && s.role === "warden") (eco.people[s.person] as { arms: number }).arms |= ARM_MOUNT;
        w.step();
      }
      for (const [k, n] of Object.entries(tally(w))) all[k] = (all[k] ?? 0) + n;
    }
    for (const k of ["palisade", "camp", "raid", "break", "bridge"]) expect(all[k] ?? 0, `${k} in ${JSON.stringify(all)}`).toBeGreaterThan(0);
  });

  it("sends planks to a poorer ally", { timeout: 600000 }, () => {
    const w = new World("amber-fern-212", { size: "tiny", rivals: 2, personalities: ["trader", "trader"], peaceDays: 99, teams: [0, 1, 1] });
    w.command({ t: "steward", of: 0, on: true });
    w.recordAi = true;
    const eco = w.economy;
    (eco.buildings[eco.keeps[1]!]!.stock as number[])[goodId("plank")] = 200;
    (eco.buildings[eco.keeps[2]!]!.stock as number[])[goodId("plank")] = 0;
    for (let i = 0; i < 20 * eco.dayTicks; i++) {
      if (i % 300 === 0) (eco.buildings[eco.keeps[2]!]!.stock as number[])[goodId("plank")] = 0;
      w.step();
    }
    expect(tally(w).send ?? 0).toBeGreaterThan(0);
  });
});
