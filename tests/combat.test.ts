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
function approach(w: World, p: number, q: number): boolean {
  const eco = w.economy;
  const enemyKeep = eco.buildings[eco.keeps[q]!]!;
  for (let round = 0; round < 5; round++) {
    if (!eco.attackBlocked(p, enemyKeep)) return true;
    const t = placeOn(w, "beacon", toward(w, p, enemyKeep.tile).slice(0, 150), p, true, 60);
    if (t < 0) return false;
    const b = eco.buildings.find((x) => x.alive && x.tile === t)!;
    run(w, 20000, () => b.lit && b.garrison.length >= 5);
  }
  return !eco.attackBlocked(p, enemyKeep);
}

/** The first of a fixed list of seeds where the two Hearthships can reach each other overland. */
function battleWorld(opts: ConstructorParameters<typeof World>[1], setup: (w: World) => void = () => {}): World {
  for (const seed of ["combat-siege", "combat-siege-2", "combat-siege-3", "combat-siege-4", "combat-siege-5"]) {
    const w = new World(seed, { size: "small", players: 2, peaceDays: 0, ...opts });
    w.command({ t: "garrison", zone: "frontier", value: 1 });
    w.command({ t: "garrison", zone: "inland", value: 1 });
    setup(w);
    if (approach(w, 0, 1)) return w;
  }
  throw new Error("No test seed with an overland approach");
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

  it("wardens march, duel at the door and take the Hearthship", { timeout: 60000 }, () => {
    // Arm player 0 well: blades and gold for resolve.
    const w = battleWorld({}, (w) => {
      const keep0 = w.economy.buildings[w.economy.keeps[0]!]!;
      keep0.stock[goodId("blade")] = 12;
      keep0.stock[goodId("gold")] = 10;
    });
    const eco = w.economy;
    const enemy = eco.buildings[eco.keeps[1]!]!;
    expect(eco.attackBlocked(0, enemy)).toBeNull();
    // Veterans: a few days of watch behind them.
    for (const p of eco.people) if (p.owner === 0) p.rank = 3;
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

  it("stays deterministic through a fight", { timeout: 60000 }, () => {
    const make = () => {
      const w = battleWorld({ stakes: "mortal" });
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

describe("war rules from Serf City", () => {
  it("attackers' morale follows their share of the world's gold", { timeout: 60000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const gold = goodId("gold");
    const keep = (p: number) => eco.buildings[eco.keeps[p]!]!;
    keep(0).stock[gold] = 0;
    keep(1).stock[gold] = 0;
    // No gold anywhere: no handicap.
    expect(eco.warMorale(0)).toBe(1);
    // All the gold is the enemy's: three-quarters strength.
    keep(1).stock[gold] = 10;
    expect(eco.warMorale(0)).toBeCloseTo(0.75);
    expect(eco.warMorale(1)).toBe(1);
    // Half the world's gold or more: full strength.
    keep(0).stock[gold] = 10;
    expect(eco.warMorale(0)).toBe(1);
    // And it shows in the odds of taking a Hearthship.
    const enemy = keep(1);
    keep(0).stock[gold] = 0;
    for (const p of eco.people) if (p.owner === 0) p.rank = 2;
    const poor = eco.attackOdds(0, enemy, 99);
    keep(0).stock[gold] = 10;
    keep(1).stock[gold] = 0;
    const rich = eco.attackOdds(0, enemy, 99);
    expect(rich).toBeGreaterThan(poor);
  });

  it("wardens can be sent weakest first", { timeout: 60000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const enemy = eco.buildings[eco.keeps[1]!]!;
    // Give the wardens different ranks.
    let i = 0;
    for (const p of eco.people) if (p.owner === 0) p.rank = i++ % 4;
    run(w, 600);
    const strong = eco.attackersFor(0, enemy, "strongest");
    const weak = eco.attackersFor(0, enemy, "weakest");
    expect(strong.length).toBeGreaterThanOrEqual(2);
    expect(weak.length).toBe(strong.length);
    const rank = (x: (typeof strong)[0]) => eco.people[x.s.person]!.rank;
    expect(rank(strong[0]!)).toBeGreaterThanOrEqual(rank(strong[strong.length - 1]!));
    expect(rank(weak[0]!)).toBeLessThanOrEqual(rank(weak[weak.length - 1]!));
    expect(rank(strong[0]!)).toBeGreaterThan(rank(weak[0]!));
    // The command takes the choice, and the weakest go first.
    expect(w.command({ t: "attack", target: enemy.id, count: 1, order: "weakest" }).ok).toBe(true);
    const sent = eco.settlers.find((s) => s.alive && s.role === "attacker")!;
    expect(eco.people[sent.person]!.rank).toBe(rank(weak[0]!));
  });

  it("garrisons follow how near the enemy is: frontier, near and inland", { timeout: 60000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const beacon = eco.buildings.find((b) => b.alive && b.owner === 0 && b.def.id === "beacon")!;
    const set = (zone: "frontier" | "near" | "inland", value: number) => w.command({ t: "garrison", zone, value });
    set("frontier", 0.9);
    set("near", 0.5);
    set("inland", 0.1);
    const want = (threat: number) => {
      beacon.threat = threat;
      return eco.garrisonWant(beacon);
    };
    expect([want(0), want(1), want(2)]).toEqual([1, 3, 5]);
    // Without a "near" setting (older saves) it is halfway between the other two.
    delete (eco.prefs[0]!.garrison as { near?: number }).near;
    expect(want(1)).toBe(3);
    // A beacon pushed toward the enemy has the enemy's land close by.
    const threats = eco.buildings.filter((b) => b.alive && b.owner === 0 && b.lit && b.def.slots).map((b) => b.threat);
    expect(Math.max(...threats)).toBeGreaterThanOrEqual(1);
    expect(eco.buildings.filter((b) => b.alive && b.owner === 0 && b.lit && b.def.slots && b.threat >= 2).every((b) => b.frontier)).toBe(true);
  });

  it("a lantern that falls decides the land around it, even where the old owner also had light", { timeout: 120000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const keep1 = eco.buildings[eco.keeps[1]!]!;
    // Give the enemy a lantern beside its Hearthship, so the two lights overlap, and let it light.
    const spots = w.land.ring(keep1.tile, 3).filter((t) => w.land.territory[t] === 2 && w.land.isLand(t));
    const at = placeOn(w, "lamphouse", spots, 1, true, 40);
    expect(at).toBeGreaterThanOrEqual(0);
    const lantern = eco.buildings.find((b) => b.alive && b.tile === at)!;
    run(w, 30000, () => lantern.lit);
    expect(lantern.lit).toBe(true);
    const flood = (eco as unknown as { flood(c: number, r: number, f: (t: number, d: number) => void): void }).flood.bind(eco);
    const before = Uint8Array.from(w.land.territory);
    (eco as unknown as { capture(b: unknown, owner: number): void }).capture(lantern, 0);
    eco.updateTerritory();
    // Distance from each tile to the nearest lit lantern of each side.
    const nearest = (owner: number) => {
      const d = new Map<number, number>();
      for (const b of eco.buildings) if (b.alive && b.lit && b.def.light && b.owner === owner) flood(b.tile, b.def.light, (t, k) => d.set(t, Math.min(d.get(t) ?? 99, k)));
      return d;
    };
    const mine = nearest(0);
    const theirs = nearest(1);
    let flipped = 0;
    flood(lantern.tile, lantern.def.light!, (t) => {
      const a = mine.get(t);
      if (a === undefined) return;
      const b = theirs.get(t) ?? 99;
      if (a < b) {
        // Closer to the new owner's lantern: it is theirs now (the old rule left it with the old owner).
        expect(w.land.territory[t]).toBe(1);
        if (before[t] === 2) flipped++;
      }
    });
    expect(flipped).toBeGreaterThan(0);
  });
});
