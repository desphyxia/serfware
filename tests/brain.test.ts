import { describe, expect, it } from "vitest";
import type { AiContext, Brain } from "../src/sim/ai/brain";
import { World } from "../src/sim/world";

/** A brain that only sets the garrison policy: proof the seat is swappable. */
class LanternBrain implements Brain {
  readonly period = 120;
  thoughts = 0;
  constructor(
    readonly player: number,
    readonly personality = "builder" as const,
    readonly level = "normal" as const,
  ) {}

  think(ctx: AiContext): void {
    this.thoughts++;
    // An order given through the context, as the player.
    ctx.act({ t: "garrison", zone: "frontier", value: 0.5 });
  }
}

describe("AI brains", () => {
  it("the scripted AI is the default and its orders are recorded when asked", () => {
    const w = new World("brain-1", { size: "tiny", rivals: 1 });
    w.recordAi = true;
    for (let i = 0; i < 3000; i++) w.step();
    expect(w.aiLog.length).toBeGreaterThan(5);
    expect(w.aiLog.every((a) => a.player === 1)).toBe(true);
    expect(w.aiLog.some((a) => a.cmd.t === "build" && a.ok)).toBe(true);
    // Nothing is recorded unless asked.
    const quiet = new World("brain-1", { size: "tiny", rivals: 1 });
    for (let i = 0; i < 600; i++) quiet.step();
    expect(quiet.aiLog.length).toBe(0);
  });

  it("another brain can take a seat, and acts only through the context", () => {
    const brains: LanternBrain[] = [];
    const w = new World("brain-1", { size: "tiny", rivals: 1, brain: (seat) => { const b = new LanternBrain(seat.player); brains.push(b); return b; } });
    w.recordAi = true;
    for (let i = 0; i < 1300; i++) w.step();
    expect(brains.length).toBe(1);
    expect(brains[0]!.thoughts).toBeGreaterThan(5);
    expect(w.aiLog.length).toBe(brains[0]!.thoughts);
    expect(w.aiLog.every((a) => a.cmd.t === "garrison" && (a.cmd as { player?: number }).player === 1)).toBe(true);
    // The rival built nothing: this brain does not.
    expect(w.economy.buildings.filter((b) => b.alive && b.owner === 1 && b.built).length).toBe(1);
  });

  it("is deterministic", () => {
    const run = () => {
      const w = new World("brain-2", { size: "tiny", rivals: 2 });
      for (let i = 0; i < 4000; i++) w.step();
      return w.checksum();
    };
    expect(run()).toBe(run());
  });
});
