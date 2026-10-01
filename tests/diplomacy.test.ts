import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { Feature, Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEED = "russet-heron-417";

function two() {
  const w = new World(SEED, { size: "small", players: 2, peaceDays: 0 });
  w.step();
  return { w, eco: w.economy, dip: w.economy.diplomacy };
}

/** Player 0 offers, player 1 accepts. */
function agree(w: World, kind: "truce" | "trade" | "roads" | "prisoners") {
  expect(w.command({ t: "propose", to: 1, kind, player: 0 }).ok).toBe(true);
  const prop = w.economy.diplomacy.proposals.at(-1)!;
  expect(w.command({ t: "answer", proposal: prop.id, accept: true, player: 1 }).ok).toBe(true);
}

function day(w: World) {
  const eco = w.economy;
  const next = (Math.floor(eco.tick / eco.dayTicks) + 1) * eco.dayTicks;
  while (w.tick < next) w.step();
}

describe("diplomacy", () => {
  it("a truce stops attacks both ways until it is broken, and breaking it costs reputation and Glow", () => {
    const { w, eco, dip } = two();
    const target = eco.buildings[eco.keeps[1]!]!;
    agree(w, "truce");
    expect(dip.truce(0, 1)).toBe(true);
    expect(eco.attackBlocked(0, target)).toMatch(/truce/);
    expect(eco.attackBlocked(1, eco.buildings[eco.keeps[0]!]!)).toMatch(/truce/);
    day(w);
    const parts = { ...eco.glowParts[0]! };
    const rep = dip.rep(0);
    expect(w.command({ t: "break", with: 1, player: 0 }).ok).toBe(true);
    expect(dip.truce(0, 1)).toBe(false);
    expect(dip.rep(0)).toBe(rep - 25);
    expect(dip.shamed(0)).toBe(true);
    expect(eco.attackBlocked(0, target) ?? "").not.toMatch(/truce/);
    for (let i = 0; i < eco.dayTicks / 6; i++) w.step();
    expect(eco.glowParts[0]!.belonging).toBeLessThan(parts.belonging);
    expect(eco.glowParts[0]!.joy).toBeLessThan(parts.joy);
  });

  it("a trade pact moves goods each morning, and treaties run out", () => {
    const { w, eco } = two();
    const k0 = eco.buildings[eco.keeps[0]!]!;
    const k1 = eco.buildings[eco.keeps[1]!]!;
    const plank = goodId("plank");
    k0.stock[plank] = 60;
    const before = k1.stock[plank]!;
    agree(w, "trade");
    day(w);
    expect(k1.stock[plank]!).toBeGreaterThan(before);
    eco.diplomacy.treaties[0]!.until = eco.tick + 10;
    day(w);
    expect(eco.diplomacy.between(0, 1, "trade").length).toBe(0);
    expect(eco.notices.some((n) => n.text.includes("run its course"))).toBe(true);
  });

  it("shared roads let each lay roads on the other's land, and are taken up when the treaty is broken", () => {
    const { w, eco, dip } = two();
    const land = eco.land;
    const foreign = land.ring(eco.buildings[eco.keeps[1]!]!.tile, 3).find((t) => land.territory[t] === 2 && land.use[t] === Use.Free && land.feature[t] === Feature.None && land.slope(t) < 2)!;
    expect(land.roadable(foreign, 0)).toBe(false);
    agree(w, "roads");
    expect(land.roadable(foreign, 0)).toBe(true);
    expect(land.roadable(foreign, 1)).toBe(true);
    dip.breakAll(0, 1);
    expect(land.roadable(foreign, 0)).toBe(false);
  });

  it("beaten attackers can be taken prisoner, and an exchange sends them home", () => {
    const { w, eco } = two();
    const mine = eco.people.filter((p) => p.alive && p.owner === 0).slice(0, 3);
    for (const p of mine) {
      p.captive = 1;
      p.woundedUntil = eco.tick + 1000 * eco.dayTicks;
    }
    agree(w, "prisoners");
    expect(mine.every((p) => p.captive === undefined && p.woundedUntil <= eco.tick)).toBe(true);
    expect(eco.notices.some((n) => n.text.includes("3 people come home"))).toBe(true);
  });

  it("rivals answer by temperament: Wardens refuse trade, Traders take it, nobody trusts an oath-breaker", () => {
    for (const [kind, ok] of [
      ["warden", false],
      ["trader", true],
      ["builder", true],
    ] as const) {
      const w = new World(SEED, { size: "small", rivals: 1, personalities: [kind] });
      expect(w.economy.names[1]).toBeTruthy();
      w.command({ t: "propose", to: 1, kind: "trade" });
      expect(w.economy.diplomacy.between(0, 1, "trade").length > 0).toBe(ok);
    }
    const w = new World(SEED, { size: "small", rivals: 1, personalities: ["trader"] });
    w.economy.diplomacy.reputation[0] = 10;
    w.command({ t: "propose", to: 1, kind: "trade" });
    expect(w.economy.diplomacy.between(0, 1).length).toBe(0);
  });

  it("is deterministic: the same offers on two worlds give the same checksum", () => {
    const run = () => {
      const { w } = two();
      agree(w, "trade");
      agree(w, "truce");
      for (let i = 0; i < 2 * w.economy.dayTicks; i++) w.step();
      w.command({ t: "break", with: 1, player: 1 });
      for (let i = 0; i < 200; i++) w.step();
      return w.checksum();
    };
    expect(run()).toBe(run());
  });
});

describe("wanderers", () => {
  it("hamlets sit out in the wild and join a happy settlement whose light reaches them", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const wan = eco.wanderers;
    expect(wan.hamlets.length).toBeGreaterThan(1);
    const h = wan.hamlets[0]!;
    expect(eco.land.use[h.tile]).toBe(Use.Blocked);
    expect(eco.land.territory[h.tile]).toBe(0);
    const people = eco.people.filter((p) => p.alive && p.owner === 0).length;
    // Hold Glow where the test wants it.
    let glow = 30;
    (eco as unknown as { updateGlow(p: number): void }).updateGlow = (p) => (eco.glow[p] = glow);
    eco.land.territory[h.tile] = 1;
    day(w);
    expect(h.joined).toBe(-1);
    expect(eco.notices.some((n) => n.text.includes("happier settlement"))).toBe(true);
    glow = 70;
    day(w);
    expect(h.joined).toBe(0);
    expect(eco.people.filter((p) => p.alive && p.owner === 0).length).toBe(people + h.people);
  });

  it("nomad caravans come, trade surplus for goods the settlement can't make, and leave", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const keep = eco.buildings[eco.keeps[0]!]!;
    keep.stock[goodId("plank")] = 60;
    let caravan;
    for (let d = 0; d < 40 && !caravan; d++) {
      day(w);
      caravan = eco.wanderers.caravans[0];
    }
    expect(caravan).toBeDefined();
    for (let i = 0; i < 3 * eco.dayTicks && !caravan!.done; i++) w.step();
    expect(caravan!.leaving).toBe(true);
    expect(eco.notices.some((n) => n.text.includes("nomads trade"))).toBe(true);
  });

  it("herds of native creatures roam the wild and trample fields they wander into", () => {
    const w = new World(SEED, { size: "small" });
    const eco = w.economy;
    const wan = eco.wanderers;
    expect(wan.creatures.length).toBeGreaterThan(3);
    const c = wan.creatures[0]!;
    const start = c.tile;
    for (let i = 0; i < 600; i++) w.step();
    expect(c.tile).not.toBe(start);
    // Sow every open neighbour of the beast and watch the crop suffer.
    const sown = [...eco.land.planet.grid.neighborsOf(c.tile)].filter((t) => eco.land.isLand(t) && eco.land.use[t] === Use.Free);
    for (const t of sown) {
      eco.land.feature[t] = Feature.Field;
      eco.land.amount[t] = 3;
    }
    for (let i = 0; i < 1200; i++) w.step();
    expect(sown.some((t) => eco.land.amount[t]! < 3 || eco.land.feature[t] !== Feature.Field)).toBe(true);
  });
});
