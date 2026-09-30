import { describe, expect, it } from "vitest";
import { generateSystem, launchWindow, orbitAngle, planetOverrides } from "../src/sim/system/system";
import { World } from "../src/sim/world";

describe("star systems", () => {
  it("each seed has a system of any size around its home planet, the same every time", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const a = generateSystem(w.seed, w.planet);
    const b = generateSystem(w.seed, w.planet);
    expect(a).toEqual(b);
    expect(a.planets.length).toBeGreaterThanOrEqual(3);
    const home = a.planets[a.home]!;
    expect(home.home).toBe(true);
    expect(home.gravity).toBe(w.planet.params.gravity);
    expect(home.dayLengthHours).toBe(w.planet.params.dayLengthHours);
    expect(home.orbit).toBeGreaterThan(a.habitable[0]);
    expect(home.orbit).toBeLessThan(a.habitable[1]);
    // Orbits grow outward; gas giants only beyond the frost line.
    for (let i = 1; i < a.planets.length; i++) expect(a.planets[i]!.orbit).toBeGreaterThan(a.planets[i - 1]!.orbit * 1.2);
    for (const p of a.planets) if (p.kind === "gas") expect(p.orbit).toBeGreaterThan(a.frostLine);
    // Different seeds give different systems, and some have many planets.
    const counts = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => generateSystem(s, w.planet).planets.length));
    expect(counts.size).toBeGreaterThan(2);
  });

  it("the home world is unchanged by its system (drawn from its own stream)", () => {
    const before = new World("frost-1", { size: "small" }).checksum();
    const w = new World("frost-1", { size: "small" });
    generateSystem(w.seed, w.planet);
    expect(w.checksum()).toBe(before);
  });

  it("launch windows come round once a synodic period and line the target up for arrival", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const sys = generateSystem(w.seed, w.planet);
    const home = sys.planets[sys.home]!;
    const target = sys.planets.find((p) => !p.home)!;
    const win = launchWindow(home, target, 0);
    expect(win.daysUntil).toBeGreaterThanOrEqual(0);
    expect(win.daysUntil).toBeLessThanOrEqual(win.synodic + 1e-6);
    // At the window, the target leads by the transfer angle; after the transfer it meets the craft
    // on the far side of the star.
    const t0 = win.daysUntil;
    const arrive = orbitAngle(target, t0 + win.transferDays);
    const opposite = orbitAngle(home, t0) + Math.PI;
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    expect(Math.abs(wrap(arrive - opposite))).toBeLessThan(1e-6);
    // A day before it opens, it's a day further off (or the previous window just passed).
    const later = launchWindow(home, target, t0 + 0.5);
    expect(later.daysUntil).toBeGreaterThan(win.synodic - 1);
  });

  it("other planets are survey worlds with their own physics and climate, and nobody on them", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const sys = generateSystem(w.seed, w.planet);
    const other = sys.planets.find((p) => p.surface && !p.home)!;
    const survey = new World(`${w.seed}~${other.name}`, { planet: planetOverrides(other), survey: true });
    expect(survey.planet.params.gravity).toBe(other.gravity);
    expect(survey.planet.params.dayLengthHours).toBe(other.dayLengthHours);
    expect(survey.planet.terrain.params.warmth).toBe(other.warmth);
    expect(survey.planet.params.size).toBe(other.size);
    expect(survey.economy.keeps.length).toBe(0);
    expect(survey.economy.settlers.length).toBe(0);
    const t0 = survey.tick;
    for (let i = 0; i < 400; i++) survey.step();
    expect(survey.tick).toBe(t0 + 400);
  });

  it("gravity weighs on walkers: light worlds are quicker, heavy ones slower", () => {
    const light = new World("g-light", { size: "tiny", planet: { gravity: 0.6 } });
    const heavy = new World("g-light", { size: "tiny", planet: { gravity: 1.3 } });
    expect(light.land.lightness).toBeLessThan(1);
    expect(heavy.land.lightness).toBeGreaterThan(1);
    const t = Array.from({ length: light.land.region.length }, (_, i) => i).find((i) => light.land.isLand(i) && light.land.walkable(i))!;
    const n = light.planet.grid.neighborsOf(t)[0]!;
    expect(light.land.stepCost(n, t)).toBeLessThan(heavy.land.stepCost(n, t));
  });
});
