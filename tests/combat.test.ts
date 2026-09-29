import { describe, expect, it } from "vitest";
import { captureOdds, duelChance, strength } from "../src/sim/econ/combat";
import { goodId } from "../src/sim/econ/defs";
import { placeOn } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const run = (w: World, n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    w.step();
    if (until && i % 50 === 0 && until()) return;
  }
};

/** Own tiles ordered by closeness to `target` (by straight-line distance). */
function toward(w: World, player: number, target: number): number[] {
  const c = w.planet.grid.center;
  const d = (t: number) => (c[t * 3]! - c[target * 3]!) ** 2 + (c[t * 3 + 1]! - c[target * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[target * 3 + 2]!) ** 2;
  const out: number[] = [];
  for (let t = 0; t < w.land.territory.length; t++) if (w.land.territory[t] === player + 1 && w.land.isLand(t)) out.push(t);
  return out.sort((a, b) => d(a) - d(b) || a - b);
}

/** Push player `p`'s border toward the other keep with beacons until an attack is possible. */
function approach(w: World, p: number, q: number): void {
  const eco = w.economy;
  const enemyKeep = eco.buildings[eco.keeps[q]!]!;
  for (let round = 0; round < 4; round++) {
    if (!eco.attackBlocked(p, enemyKeep)) return;
    const t = placeOn(w, "beacon", toward(w, p, enemyKeep.tile).slice(0, 80), p, true, 40);
    expect(t).toBeGreaterThanOrEqual(0);
    const b = eco.buildings.find((x) => x.alive && x.tile === t)!;
    run(w, 20000, () => b.lit && b.garrison.length >= 5);
  }
}

describe("combat arithmetic", () => {
  it("rank and a blade make a fighter stronger; fatigue weakens", () => {
    const base = strength({ rank: 0, arms: 0, fatigue: 0 }, 1, 1);
    expect(strength({ rank: 2, arms: 0, fatigue: 0 }, 1, 1)).toBeGreaterThan(base);
    expect(strength({ rank: 0, arms: 1, fatigue: 0 }, 1, 1)).toBeGreaterThan(base);
    expect(strength({ rank: 0, arms: 0, fatigue: 1 }, 1, 1)).toBeLessThan(base);
    expect(duelChance(1, 1)).toBeCloseTo(0.5);
  });

  it("capture odds grow with more attackers", () => {
    const d = [1.1, 1.1];
    expect(captureOdds([1], d)).toBeLessThan(captureOdds([1, 1, 1], d));
    expect(captureOdds([1, 1, 1, 1, 1], d)).toBeGreaterThan(0.7);
    expect(captureOdds([1], [])).toBe(1);
  });
});

describe("attacks", () => {
  it("is refused during the peace and out of reach", () => {
    const w = new World("combat-peace", { size: "small", players: 2 });
    const enemy = w.economy.buildings[w.economy.keeps[1]!]!;
    expect(w.economy.attackBlocked(0, enemy)).toMatch(/peace/);
    expect(w.command({ t: "attack", target: enemy.id, count: 3 }).ok).toBe(false);
  });

  it("wardens march, duel at the door and take the Hearthship", () => {
    const w = new World("combat-siege", { size: "small", players: 2, peaceDays: 0 });
    const eco = w.economy;
    w.command({ t: "garrison", zone: "frontier", value: 1 });
    w.command({ t: "garrison", zone: "inland", value: 1 });
    // Arm player 0 well: blades and gold for resolve.
    const keep0 = eco.buildings[eco.keeps[0]!]!;
    keep0.stock[goodId("blade")] = 12;
    keep0.stock[goodId("gold")] = 10;
    approach(w, 0, 1);
    const enemy = eco.buildings[eco.keeps[1]!]!;
    expect(eco.attackBlocked(0, enemy)).toBeNull();
    run(w, 2000);
    let rounds = 0;
    let sentAny = false;
    while (!eco.defeated[1] && rounds < 8) {
      rounds++;
      const pool = eco.attackersFor(0, enemy);
      const odds = eco.attackOdds(0, enemy, pool.length);
      if (pool.length >= 2 && w.command({ t: "attack", target: enemy.id, count: pool.length }).ok) {
        sentAny = true;
        expect(odds).toBeGreaterThan(0);
      }
      run(w, 12000, () => eco.defeated[1] === true);
    }
    run(w, 200);
    expect(sentAny).toBe(true);
    expect(eco.people.some((p) => p.woundedUntil > 0)).toBe(true);
    expect(eco.defeated[1]).toBe(true);
    expect(eco.winner).toBe(0);
    expect(enemy.owner).toBe(0);
    expect(eco.people.every((p) => !p.alive || p.owner === 0)).toBe(true);
    // The fallen settlement's other buildings are stranded, and fall to ruin after a season.
    const theirs = eco.buildings.filter((b) => b.alive && b.owner === 1);
    for (const b of theirs) expect(b.stranded).toBeGreaterThanOrEqual(0);
  });

  it("stays deterministic through a fight", () => {
    const make = () => {
      const w = new World("combat-det", { size: "small", players: 2, peaceDays: 0, stakes: "mortal" });
      w.command({ t: "garrison", zone: "inland", value: 1 });
      w.command({ t: "garrison", zone: "frontier", value: 1 });
      approach(w, 0, 1);
      const enemy = w.economy.buildings[w.economy.keeps[1]!]!;
      w.command({ t: "attack", target: enemy.id, count: 10 });
      run(w, 6000);
      return w.checksum();
    };
    expect(make()).toBe(make());
  });

  it("holding the Star Wells for a day wins", () => {
    const w = new World("wells-win", { size: "tiny" });
    const grid = w.planet.grid;
    for (let t = 0; t < grid.count; t++) if (grid.degree(t) === 5) w.land.territory[t] = 1;
    run(w, 200);
    expect(w.economy.wellsSince[0]).toBeGreaterThanOrEqual(0);
    run(w, 40000, () => w.economy.winner >= 0);
    expect(w.economy.winner).toBe(0);
    expect(w.economy.winReason).toBe("wells");
  });
});
