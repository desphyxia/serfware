import { describe, expect, it } from "vitest";
import { Use } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

/** A small world with a hamlet, standing in the light of seat 0 (its tile made ours, the glow high), and the tick a day starts. */
function hamletInLight() {
  const w = new World("hamlets-join", { size: "small", players: 1 });
  const eco = w.economy;
  const h = eco.wanderers.hamlets[0];
  expect(h).toBeDefined();
  w.land.territory[h!.tile] = 1;
  eco.glow[0] = 80;
  return { w, eco, tile: h!.tile };
}

describe("a hamlet that joins a settlement", () => {
  it("frees its tile when nothing stands on it", () => {
    const { w, eco, tile } = hamletInLight();
    expect(w.land.use[tile]).toBe(Use.Blocked);
    eco.wanderers.step(eco.dayTicks);
    expect(w.land.use[tile]).toBe(Use.Free);
    expect(eco.wanderers.hamlets[0]!.joined).toBe(0);
  });

  it("leaves a flag that stands on its tile alone (the flag was left off its tile)", () => {
    const { w, eco, tile } = hamletInLight();
    w.land.use[tile] = Use.Flag;
    w.land.ref[tile] = 999;
    eco.wanderers.step(eco.dayTicks);
    expect(w.land.use[tile]).toBe(Use.Flag);
    expect(w.land.ref[tile]).toBe(999);
    expect(eco.wanderers.hamlets[0]!.joined).toBe(0);
  });
});
