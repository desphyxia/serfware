import { describe, expect, it } from "vitest";
import { goodId } from "../src/sim/econ/defs";
import { ARM_BLADE, ARM_SHIELD } from "../src/sim/econ/people";
import { frontierTiles, placeOn } from "../src/sim/econ/planner";
import { temperAllows } from "../src/sim/ai/personality";
import { creativeOf, creativeOptions } from "../src/net/session";
import { World } from "../src/sim/world";

const blade = goodId("blade");
const shield = goodId("shield");

const run = (w: World, n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    w.step();
    if (until && i % 25 === 0 && until()) return;
  }
};

/** A tiny one-player world with a lantern placed at the border and built; the keep's blades and shields set as given. */
function lanternWorld(armedWardens: boolean, arms: { blade: number; shield: number }) {
  const w = new World("armed-wardens", { size: "tiny", players: 1, armedWardens });
  const keep = w.economy.buildings[w.economy.keeps[0]!]!;
  keep.stock[blade] = arms.blade;
  keep.stock[shield] = arms.shield;
  const tile = placeOn(w, "lantern", frontierTiles(w, 0).slice(0, 30), 0, true, 12);
  expect(tile).toBeGreaterThanOrEqual(0);
  const lantern = w.economy.buildings.find((b) => b.alive && b.tile === tile)!;
  run(w, 20000, () => lantern.built);
  expect(lantern.built).toBe(true);
  return { w, keep, lantern };
}

describe("the armed-wardens rule", () => {
  it("is off by default: a warden lights a lantern with no arms and a seat starts with none", () => {
    const w0 = new World("armed-wardens", { size: "tiny", players: 1 });
    const keep0 = w0.economy.buildings[w0.economy.keeps[0]!]!;
    expect(keep0.stock[blade]).toBe(0);
    expect(keep0.stock[shield]).toBe(0);
    const { w, lantern } = lanternWorld(false, { blade: 0, shield: 0 });
    run(w, 20000, () => lantern.lit);
    expect(lantern.lit).toBe(true);
    const warden = w.economy.settlers[lantern.garrison[0]!]!;
    expect((w.economy.people[warden.person]!.arms & ARM_BLADE) === 0).toBe(true);
  });

  it("starts a seat with 8 blades and 8 shields", () => {
    const w = new World("armed-wardens", { size: "tiny", players: 1, armedWardens: true });
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    expect(keep.stock[blade]).toBe(8);
    expect(keep.stock[shield]).toBe(8);
    expect(w.rules?.armedWardens).toBe(true);
  });

  it("leaves a lantern dark with no arms, and lights it once the stores hold a blade and a shield", () => {
    const { w, keep, lantern } = lanternWorld(true, { blade: 0, shield: 0 });
    run(w, 3000);
    expect(lantern.lit).toBe(false);
    expect(lantern.garrison.length).toBe(0);
    expect(w.economy.waitingFor(lantern)).toMatch(/Waiting for arms/);
    // A blade alone is not enough.
    keep.stock[blade] = 1;
    run(w, 3000);
    expect(lantern.lit).toBe(false);
    keep.stock[shield] = 1;
    run(w, 20000, () => lantern.lit);
    expect(lantern.lit).toBe(true);
    const warden = w.economy.settlers[lantern.garrison[0]!]!;
    const arms = w.economy.people[warden.person]!.arms;
    expect(arms & ARM_BLADE).toBe(ARM_BLADE);
    expect(arms & ARM_SHIELD).toBe(ARM_SHIELD);
    expect(keep.stock[blade]).toBe(0);
    expect(keep.stock[shield]).toBe(0);
    expect(w.economy.waitingFor(lantern)).toBeNull();
  });

  it("makes shields as well as blades at the weaponsmith, whichever the stores hold fewer of", () => {
    const w = new World("armed-wardens", { size: "tiny", players: 1, armedWardens: true });
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    const choose = () => (w.economy as unknown as { chooseArms(owner: number): number }).chooseArms(0);
    keep.stock[blade] = 5;
    keep.stock[shield] = 1;
    expect(choose()).toBe(shield);
    keep.stock[shield] = 5;
    expect(choose()).toBe(blade);
    const off = new World("armed-wardens", { size: "tiny", players: 1 });
    off.economy.buildings[off.economy.keeps[0]!]!.stock[blade] = 5;
    expect((off.economy as unknown as { chooseArms(owner: number): number }).chooseArms(0)).toBe(blade);
  });

  it("stops making arms once the stores hold a reserve beyond the vacant places", () => {
    const w = new World("armed-wardens", { size: "tiny", players: 1, armedWardens: true });
    const keep = w.economy.buildings[w.economy.keeps[0]!]!;
    const choose = () => (w.economy as unknown as { chooseArms(owner: number): number }).chooseArms(0);
    keep.stock[blade] = 6;
    keep.stock[shield] = 6;
    expect(choose()).toBe(-1);
    keep.stock[shield] = 5;
    expect(choose()).toBe(shield);
  });

  it("travels with a save or a multiplayer start, and reaches a colony world", () => {
    const w = new World("armed-wardens", { size: "tiny", players: 1, armedWardens: true });
    const again = new World("armed-wardens", { size: "tiny", players: 1, ...creativeOptions(creativeOf(w)) });
    expect(again.economy.armedWardens).toBe(true);
    expect(again.economy.buildings[again.economy.keeps[0]!]!.stock[blade]).toBe(8);
    const plain = new World("armed-wardens", { size: "tiny", players: 1 });
    expect(creativeOf(plain)).toBeUndefined();
    const colony = w.colonize(w.system.planets.find((p) => p.surface && p.index !== w.system.home)!.index);
    expect(colony.armedWardens).toBe(true);
  });

  it("tells a dark lantern why: no arms, or no free adult", () => {
    const { w, keep, lantern } = lanternWorld(true, { blade: 0, shield: 0 });
    run(w, 3000);
    expect(w.economy.waitingFor(lantern)).toMatch(/arms/);
    keep.stock[blade] = 1;
    keep.stock[shield] = 1;
    for (const p of w.economy.people) if (p.alive && p.stage === "adult" && p.settler < 0) p.woundedUntil = Infinity;
    expect(w.economy.waitingFor(lantern)).toMatch(/free adult/);
  });

  it("lets every temperament build the weaponsmith, and only that", () => {
    for (const p of ["builder", "trader"] as const) {
      expect(temperAllows(p, { t: "build", type: "weaponsmith" })).toBe(false);
      expect(temperAllows(p, { t: "build", type: "weaponsmith" }, true)).toBe(true);
      expect(temperAllows(p, { t: "build", type: "bowyer" }, true)).toBe(false);
      expect(temperAllows(p, { t: "build", type: "stable" }, true)).toBe(false);
    }
  });
});
