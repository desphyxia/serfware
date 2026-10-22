import { afterEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/builder";
import { DEFAULT_DISTRIBUTION, goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

afterEach(() => {
  aiOptions.bowsByNeed = false;
});

const BOW = goodId("bow");
const setBows = (w: World, p: number, n: number): void => {
  const eco = w.economy;
  for (const b of eco.buildings) if (b.alive && b.owner === p && b.def.storage) b.stock[BOW] = 0;
  (eco.buildings[eco.keeps[p] as number] as { stock: number[] }).stock[BOW] = n;
};
const bowyerShare = (w: World, p: number): number => w.economy.prefs[p]?.dist.plank?.bowyer ?? (DEFAULT_DISTRIBUTION.plank?.bowyer as number);
const play = (w: World, steps: number): void => {
  for (let i = 0; i < steps; i++) w.step();
};

describe("the bowyer's planks follow the wardens' need for bows (bowsByNeed, #175)", () => {
  it("is off by default", () => {
    expect(aiOptions.bowsByNeed).toBe(false);
  });

  it("gives the bowyer no planks while the stores hold enough bows, and its share again when they do not", () => {
    aiOptions.bowsByNeed = true;
    const w = new World("quiet-cairn-175", { rivals: 1 });
    play(w, 400);
    setBows(w, 1, 500);
    play(w, 400);
    expect(bowyerShare(w, 1)).toBe(0);
    setBows(w, 1, 0);
    play(w, 400);
    expect(bowyerShare(w, 1)).toBeGreaterThan(0);
  }, 120000);

  it("leaves the bowyer's share alone with the switch off", () => {
    const w = new World("quiet-cairn-175", { rivals: 1 });
    play(w, 400);
    setBows(w, 1, 500);
    play(w, 400);
    expect(bowyerShare(w, 1)).toBeGreaterThan(0);
  }, 120000);
});
