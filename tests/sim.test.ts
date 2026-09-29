import { describe, expect, it } from "vitest";
import { dayInfo, formatDay, ticksPerDay } from "../src/sim/clock";
import * as dm from "../src/sim/dmath";
import { hashString, Rng } from "../src/sim/rng";
import { normaliseSeed, randomSeedWord } from "../src/sim/seedwords";
import { World } from "../src/sim/world";

describe("Rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng("amber-fox-1");
    const b = new Rng("amber-fox-1");
    const seqA = Array.from({ length: 50 }, () => a.nextU32());
    const seqB = Array.from({ length: 50 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it("differs between seeds and forks", () => {
    expect(new Rng("a").nextU32()).not.toBe(new Rng("b").nextU32());
    const r = new Rng(1);
    expect(r.fork("x").nextU32()).not.toBe(r.fork("x").nextU32());
  });

  it("round-trips its state", () => {
    const r = new Rng(42);
    r.next();
    const copy = Rng.fromState(r.state());
    expect(copy.nextU32()).toBe(r.nextU32());
  });

  it("produces a known sequence (guards against accidental algorithm changes)", () => {
    const r = new Rng("golden");
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchInlineSnapshot(`
      [
        648302536,
        1523391614,
        4031400704,
      ]
    `);
  });

  it("ints are within range and roughly uniform", () => {
    const r = new Rng(9);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40000; i++) counts[r.int(0, 3)]!++;
    for (const c of counts) expect(c).toBeGreaterThan(9000);
    expect(hashString("x")).toBe(hashString("x"));
  });
});

describe("deterministic math", () => {
  it("matches Math within 1e-9", () => {
    for (let x = -20; x <= 20; x += 0.137) {
      expect(Math.abs(dm.sin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(dm.cos(x) - Math.cos(x))).toBeLessThan(1e-9);
      expect(Math.abs(dm.atan(x) - Math.atan(x))).toBeLessThan(1e-9);
      expect(Math.abs(dm.exp(x / 4) - Math.exp(x / 4)) / Math.exp(x / 4)).toBeLessThan(1e-9);
    }
    for (let y = -3; y <= 3; y += 0.5)
      for (let x = -3; x <= 3; x += 0.5) expect(Math.abs(dm.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9);
    for (let x = -1; x <= 1; x += 0.05) {
      expect(Math.abs(dm.acos(x) - Math.acos(x))).toBeLessThan(1e-9);
      expect(Math.abs(dm.asin(x) - Math.asin(x))).toBeLessThan(1e-9);
    }
  });
});

describe("clock", () => {
  it("starts at 06:30 on day 1", () => {
    expect(formatDay(dayInfo(0, 24))).toBe("Day 1 06:30");
  });
  it("rolls over days", () => {
    const perDay = ticksPerDay(24);
    expect(dayInfo(perDay, 24).day).toBe(2);
  });
});

describe("seeds", () => {
  it("generates readable seeds and normalises input", () => {
    expect(randomSeedWord(5)).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    expect(normaliseSeed("  Amber Fox ")).toBe("amber-fox");
    expect(normaliseSeed("")).toBe("hearth-1");
  });
});

describe("World", () => {
  it("advances ticks and checksums deterministically", () => {
    const a = new World("x");
    const b = new World("x");
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(a.checksum()).toBe(b.checksum());
    expect(a.checksum()).not.toBe(new World("y").checksum());
  });
});
