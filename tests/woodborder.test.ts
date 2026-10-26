import { afterEach, describe, expect, it } from "vitest";
import { aiOptions } from "../src/sim/ai/options";
import { AiBuilder } from "../src/sim/ai/builder";
import { goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

// toolsByDemand is on by default since #184.
const TOOLS = aiOptions.toolsByDemand;
afterEach(() => {
  aiOptions.woodByNeed = false;
  aiOptions.borderCandidates = false;
  aiOptions.toolsByDemand = TOOLS;
});

const PLANK = goodId("plank");
const LOG = goodId("log");

/** One rival on a small map; after 8 days of play, 8 more with every plank and log taken from the stores as fast as they are made. */
function woodShortGame(on: boolean) {
  aiOptions.woodByNeed = on;
  aiOptions.toolsByDemand = true;
  const w = new World("wood-border", {
    size: "small",
    rivals: 1,
    personalities: ["builder"],
    peaceDays: 99,
    brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
  } as never);
  w.command({ t: "steward", of: 0, on: true });
  const eco = w.economy;
  const drain = () => {
    for (const b of eco.buildings) if (b.alive && b.owner === 1 && b.def.storage) {
      b.stock[PLANK] = 0;
      b.stock[LOG] = 0;
    }
  };
  const woodSites = () => eco.buildings.filter((b) => b.alive && b.owner === 1 && !b.built && (b.def.id === "woodcutter" || b.def.id === "forester")).length;
  for (let i = 0; i < 8 * eco.dayTicks; i++) w.step();
  let peak = 0;
  // The most finished buildings at any time: the cap is set when a woodcutter is ordered, and exhausted quarries and mines
  // pulled down later (relocateQuarries, oreMines; on since #184) lower the count at the end.
  let most = 0;
  const built = () => eco.buildings.filter((b) => b.alive && b.owner === 1 && b.built).length;
  for (let i = 0; i < 8 * eco.dayTicks; i++) {
    if (i % 50 === 0) {
      drain();
      most = Math.max(most, built());
    }
    w.step();
    peak = Math.max(peak, woodSites());
  }
  const mine = eco.buildings.filter((b) => b.alive && b.owner === 1);
  const finished = mine.filter((b) => b.built).length;
  const wood = mine.filter((b) => b.def.id === "woodcutter" || b.def.id === "forester").length;
  return { wood, finished: Math.max(finished, most), peak };
}

describe("AI switches from #150", () => {
  it("are off by default", () => {
    expect(aiOptions.woodByNeed).toBe(false);
    expect(aiOptions.borderCandidates).toBe(false);
  });

  it("borderCandidates still pushes the border out", () => {
    aiOptions.borderCandidates = true;
    const w = new World("wood-border", {
      size: "small",
      rivals: 1,
      personalities: ["builder"],
      peaceDays: 99,
      brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
    } as never);
    w.command({ t: "steward", of: 0, on: true });
    const held = () => w.land.territory.reduce((n, o) => n + (o === 2 ? 1 : 0), 0);
    const before = held();
    for (let i = 0; i < 10 * w.economy.dayTicks; i++) w.step();
    expect(held()).toBeGreaterThan(before);
  }, 300000);

  it("woodByNeed adds woodcutters and foresters while planks and logs run short, up to a cap that grows with the settlement", () => {
    const off = woodShortGame(false);
    const on = woodShortGame(true);
    expect(on.wood).toBeGreaterThan(off.wood);
    // Woodcutters up to 2 + finished/12, foresters up to a third of that.
    const cap = 2 + Math.floor(on.finished / 12);
    expect(on.wood).toBeLessThanOrEqual(cap + Math.ceil(cap / 3));
  }, 600000);
});
