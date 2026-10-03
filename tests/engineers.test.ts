import { describe, expect, it } from "vitest";
import { COMBAT, goodId } from "../src/sim/econ/defs";
import { CAMP_REACH, RAID_COVER } from "../src/sim/econ/economy";
import { ARM_MOUNT } from "../src/sim/econ/people";
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


const stockUp = (w: World, p: number) => {
  const keep = w.economy.buildings[w.economy.keeps[p]!]!;
  keep.stock[goodId("plank")] = 40;
  keep.stock[goodId("log")] = 40;
  return keep;
};

describe("engineers", () => {
  it("a palisade makes a lantern harder to take, and needs planks and logs", { timeout: 120000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const enemy = eco.buildings[eco.keeps[1]!]!;
    // The enemy pushes its own border out too, so there are lanterns in front of its Hearthship.
    approach(w, 1, 0);
    // The attacked side's lanterns: take a lit one of the enemy that player 0 can attack.
    const lantern = eco.buildings.find((b) => b.alive && b.owner === 1 && b.lit && b.def.slots && !eco.attackBlocked(0, b));
    const target = lantern ?? enemy;
    expect(target, "an enemy lantern within reach").not.toBe(enemy);
    const before = eco.attackOdds(0, target, 5);
    for (const b of eco.buildings) if (b.alive && b.owner === 1 && b.def.storage) b.stock[goodId("plank")] = 0;
    expect(w.command({ t: "palisade", building: target.id, player: 1 }).ok).toBe(false);
    stockUp(w, 1);
    expect(w.command({ t: "palisade", building: target.id, player: 1 }).ok).toBe(true);
    expect(w.command({ t: "palisade", building: target.id, player: 1 }).ok).toBe(false);
    expect(target.palisade).toBe(true);
    expect(eco.groundFor(target)).toBeCloseTo(1.1 * 1.3);
    expect(eco.attackOdds(0, target, 5)).toBeLessThan(before);
    // Not the enemy's to build for another player, nor on the Hearthship.
    expect(w.command({ t: "palisade", building: target.id, player: 0 }).ok).toBe(false);
    expect(w.command({ t: "palisade", building: enemy.id, player: 1 }).ok).toBe(false);
  });

  it("a field camp reaches further for one attack, and is used up by it", { timeout: 120000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const enemy = eco.buildings[eco.keeps[1]!]!;
    const src = eco.attackersFor(0, enemy)[0];
    expect(src).toBeDefined();
    const { from, d } = src!;
    const light = from.def.light as number;
    const reach = COMBAT.reach;
    try {
      // Shrink the normal reach so this attack is just out of range.
      COMBAT.reach = d - light - 2;
      expect(eco.attackBlocked(0, enemy)).toMatch(/close enough/);
      stockUp(w, 0);
      expect(w.command({ t: "camp", building: from.id }).ok).toBe(true);
      expect(w.command({ t: "camp", building: from.id }).ok).toBe(false);
      expect(eco.attackTargetsFrom(from).map((x) => x.id)).toContain(enemy.id);
      expect(CAMP_REACH).toBeGreaterThan(2);
      expect(w.command({ t: "attack", target: enemy.id, count: 3 }).ok).toBe(true);
      expect(from.camp).toBe(0);
      expect(eco.attackTargetsFrom(from).map((x) => x.id)).not.toContain(enemy.id);
    } finally {
      COMBAT.reach = reach;
    }
  });

  it("a bridge makes a walkable, roadable tile of shallow water inside the border", () => {
    for (const seed of ["bridge-1", "bridge-2", "bridge-3", "bridge-4", "russet-heron-417", "amber-fern-212"]) {
      const w = new World(seed, { size: "small" });
      const eco = w.economy;
      const land = w.land;
      const grid = w.planet.grid;
      const spot = Array.from({ length: grid.count }, (_, t) => t).find((t) => !land.isLand(t) && land.territory[t] === 1 && (w.planet.terrain.elevation[t] as number) > -0.9 && grid.degree(t) !== 5 && grid.neighborsOf(t).some((n) => land.isLand(n) && land.territory[n] === 1));
      if (spot === undefined) continue;
      expect(land.walkable(spot)).toBe(false);
      expect(w.command({ t: "bridge", tile: spot }).ok).toBe(true); // the Hearthship starts with planks
      expect(land.walkable(spot)).toBe(true);
      expect(land.roadable(spot, 0)).toBe(true);
      expect(w.command({ t: "bridge", tile: spot }).ok).toBe(false);
      // Deep water, and water not touching land, are refused.
      const deep = Array.from({ length: grid.count }, (_, t) => t).find((t) => !land.isLand(t) && (w.planet.terrain.elevation[t] as number) < -1.5 && land.territory[t] === 1);
      if (deep !== undefined) expect(w.command({ t: "bridge", tile: deep }).ok).toBe(false);
      void eco;
      return;
    }
    throw new Error("no world with shallows inside the border");
  });

  it("an outrider cuts down an unwatched enemy flag, and not a watched one", { timeout: 180000 }, () => {
    const w = battleWorld({});
    const eco = w.economy;
    const land = w.land;
    // Give the nearest-to-the-front lantern of player 0 a mounted warden to spare.
    const mounted = () => {
      for (const b of eco.buildings) {
        if (!b.alive || !b.lit || b.owner !== 0 || !b.def.slots || b.garrison.length < 2) continue;
        const s = eco.settlers[b.garrison[b.garrison.length - 1]!]!;
        const person = eco.people[s.person]!;
        person.arms |= ARM_MOUNT;
      }
    };
    mounted();
    // An enemy flag out beyond the watch of every lit lantern of theirs, in range of ours.
    const enemyLit = eco.buildings.filter((b) => b.alive && b.lit && b.owner === 1 && (b.def.slots || eco.keeps.includes(b.id)));
    const unwatched = (t: number) => !enemyLit.some((b) => land.ring(t, RAID_COVER).includes(b.tile) || b.tile === t);
    let flagId = -1;
    const candidates: number[] = [];
    for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === 2 && land.isLand(t) && unwatched(t) && land.canPlaceFlag(t, 1)) candidates.push(t);
    for (const t of candidates) {
      if (!w.command({ t: "flag", tile: t, player: 1 }).ok) continue;
      const f = eco.flagAt(t)!;
      const r = w.command({ t: "raid", flag: f.id, player: 0 });
      if (r.ok) {
        flagId = f.id;
        break;
      }
      w.command({ t: "demolish", tile: t, player: 1 });
    }
    expect(flagId).toBeGreaterThanOrEqual(0);
    run(w, 6000, () => !eco.flags[flagId]!.alive);
    expect(eco.flags[flagId]!.alive).toBe(false);
    // A flag beside one of their lanterns is watched.
    const lantern = enemyLit[0]!;
    const near = land.ring(lantern.tile, 2).find((t) => land.canPlaceFlag(t, 1));
    if (near !== undefined) {
      w.command({ t: "flag", tile: near, player: 1 });
      const f = eco.flagAt(near);
      if (f) expect(w.command({ t: "raid", flag: f.id, player: 0 }).reason).toMatch(/watched/);
    }
  });
});
