import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import { AiBuilder } from "../src/sim/ai/builder";
import { World } from "../src/sim/world";

/** A stand-in for the world with just what the AI's attack and tidy-up read. */
function fake(over: Record<string, unknown>) {
  const sent: unknown[] = [];
  const eco = {
    peaceUntil: 0,
    defeated: [],
    keeps: [0, 1],
    buildings: [] as unknown[],
    flags: [] as unknown[],
    roads: [] as unknown[],
    attackBlocked: () => null,
    attackersFor: () => [1, 2, 3, 4],
    attackOdds: () => 0.95,
    defendersOf: (b: { held: number }) => new Array(b.held).fill(0),
    route: () => ({ dist: 5 }),
    ...over,
  };
  return { w: { tick: 100, economy: eco, command: (c: unknown) => (sent.push(c), { ok: true }) }, sent, eco };
}

const lantern = (id: number, held: number, owner = 1) => ({ id, held, owner, alive: true, built: true, def: { light: 3 } });
const ai = () => new AiBuilder(0, new Rng("ai-test"), "warden", "normal");
const call = (a: AiBuilder, name: string, w: unknown) => (a as unknown as Record<string, (w: unknown) => unknown>)[name]!.call(a, w);

describe("the AI (lessons from Settlers 2's)", () => {
  it("attacks an undefended target first, then the weakest garrison", () => {
    const f = fake({});
    f.eco.buildings.push(lantern(10, 3), lantern(11, 0), lantern(12, 1));
    expect(call(ai(), "attack", f.w)).toBe(true);
    expect((f.sent[0] as { target: number }).target).toBe(11);
    // With no undefended one, the weakest garrison.
    const g = fake({});
    g.eco.buildings.push(lantern(10, 3), lantern(12, 1));
    call(ai(), "attack", g.w);
    expect((g.sent[0] as { target: number }).target).toBe(12);
    // Targets whose odds are poor are left alone.
    const h = fake({ attackOdds: () => 0.1 });
    h.eco.buildings.push(lantern(10, 0));
    expect(call(ai(), "attack", h.w)).toBe(false);
  });

  it("clears away a flag that leads nowhere, and a site no road reaches, after a while", () => {
    const leaf = { id: 4, alive: true, owner: 0, building: -1, tile: 77, roads: [0] };
    const site = { id: 9, alive: true, owner: 0, built: false, def: {}, flag: 5, tile: 88 };
    const keep = { id: 0, alive: true, owner: 0, flag: 1, built: true, def: {} };
    const f = fake({ route: (_a: number, b: number) => ({ dist: b === 5 ? Infinity : 3 }) });
    f.eco.buildings.push(keep, site);
    f.eco.flags.push(leaf);
    f.eco.roads.push({ alive: true });
    const a = ai();
    call(a, "tidy", f.w);
    call(a, "tidy", f.w);
    expect(f.sent).toEqual([]);
    call(a, "tidy", f.w);
    expect(f.sent).toContainEqual({ t: "demolish", tile: 77, player: 0 });
    expect(f.sent).toContainEqual({ t: "demolish", tile: 88, player: 0 });
  });

  it("a flag that gets a building in time is spared", () => {
    const leaf = { id: 4, alive: true, owner: 0, building: -1, tile: 77, roads: [0] };
    const f = fake({});
    f.eco.buildings.push({ id: 0, alive: true, owner: 0, flag: 1, built: true, def: {} });
    f.eco.flags.push(leaf);
    f.eco.roads.push({ alive: true });
    const a = ai();
    call(a, "tidy", f.w);
    call(a, "tidy", f.w);
    leaf.building = 12;
    call(a, "tidy", f.w);
    call(a, "tidy", f.w);
    expect(f.sent).toEqual([]);
  });

  it("rivals keep the toolsmith's priorities to what their buildings need, and build one", () => {
    const w = new World("amber-fern-212", { size: "tiny", rivals: 3, personalities: ["builder", "trader", "warden"], peaceDays: 99 });
    w.command({ t: "steward", of: 0, on: true });
    const eco = w.economy;
    const defaults = JSON.stringify(eco.prefs[1]!.tools);
    for (let i = 0; i < 8 * eco.dayTicks; i++) w.step();
    // They have set their own priorities, and at least one has built a toolsmith.
    expect([1, 2, 3].some((p) => JSON.stringify(eco.prefs[p]!.tools) !== defaults)).toBe(true);
    expect(eco.buildings.some((b) => b.alive && b.owner >= 1 && b.def.id === "toolsmith")).toBe(true);
  }, 240000);
});
