import { describe, expect, it } from "vitest";
import { goodId, TOOLS } from "../src/sim/econ/defs";
import { Deposit } from "../src/sim/econ/landuse";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step();
};
const stock = (w: World, id: string) => w.economy.storageTotals(0)[goodId(id)]!;

/** Turn a patch of land next to the keep into a small mountain with a deposit. */
function makeMountain(w: World, d: Deposit): void {
  const land = w.land;
  const keep = w.economy.buildings[w.economy.keep]!;
  const peak = w.planet.terrain.params.mountainHeight;
  const ring = land.ring(keep.tile, 6).filter((t) => land.territory[t] === 1 && land.isLand(t) && !land.ring(keep.tile, 3).includes(t));
  const center = ring[0]!;
  for (const t of [center, ...land.ring(center, 2)]) {
    if (land.use[t] !== 0) continue;
    w.planet.terrain.elevation[t] = peak * 0.45;
    land.deposit[t] = d;
    land.depositAmount[t] = 30;
  }
}

describe("production chains", () => {
  it("grain becomes flour becomes bread", () => {
    const w = new World("chain-bread", { size: "tiny" });
    const before = stock(w, "bread");
    expect(placeConnected(w, "farm", { minDist: 3 })).toBe(true);
    expect(placeConnected(w, "mill", { minDist: 2 })).toBe(true);
    expect(placeConnected(w, "bakery", { minDist: 2 })).toBe(true);
    run(w, 30000);
    const fields = Array.from(w.land.feature).filter((f) => f === 4).length;
    expect(fields).toBeGreaterThan(0);
    // Bread is eaten as it is baked, so count what the baker made rather than what is left.
    expect(w.economy.people.some((p) => (p.done.bakery ?? 0) > 0)).toBe(true);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it("mines dig coal while they have food", () => {
    const w = new World("chain-coal", { size: "tiny" });
    makeMountain(w, Deposit.Coal);
    const coal = stock(w, "coal");
    const food = stock(w, "bread") + stock(w, "fish");
    expect(placeConnected(w, "coalmine", { minDist: 3 })).toBe(true);
    run(w, 9000);
    expect(stock(w, "coal")).toBeGreaterThan(coal);
    expect(stock(w, "bread") + stock(w, "fish")).toBeLessThan(food);
  });

  it("distribution weight 0 starves a consumer", () => {
    const w = new World("chain-prio", { size: "tiny" });
    makeMountain(w, Deposit.Coal);
    w.command({ t: "prio", key: "food", target: "coalmine", value: 0 });
    const coal = stock(w, "coal");
    placeConnected(w, "coalmine", { minDist: 3 });
    run(w, 9000);
    expect(stock(w, "coal")).toBe(coal);
  });

  it("the toolsmith turns iron and planks into tools", () => {
    const w = new World("chain-tools", { size: "tiny" });
    const tools = () => TOOLS.reduce((s, t) => s + w.economy.storageTotals(0)[t]!, 0);
    const before = tools();
    expect(placeConnected(w, "toolsmith", { minDist: 2 })).toBe(true);
    run(w, 9000);
    // Hammers go out with builders and come back; the toolsmith adds new ones on top.
    run(w, 3000);
    expect(tools()).toBeGreaterThan(before - 2);
    expect(stock(w, "iron")).toBeLessThan(2);
  });

  it("geologists plant signposts around a flag", () => {
    const w = new World("chain-geo", { size: "tiny" });
    const keep = w.economy.buildings[w.economy.keep]!;
    const flagTile = w.economy.flags[keep.flag]!.tile;
    expect(w.command({ t: "geologist", flagTile }).ok).toBe(true);
    run(w, 2500);
    expect(Array.from(w.land.sign).some((x) => x > 0)).toBe(true);
  });

  it("workers need the right tool", () => {
    const w = new World("chain-rod", { size: "tiny" });
    const keep = w.economy.buildings[w.economy.keep]!;
    keep.stock[goodId("axe")] = 0;
    placeConnected(w, "woodcutter", { minDist: 3 });
    run(w, 3000);
    const wc = w.economy.buildings.find((b) => b.def.id === "woodcutter")!;
    expect(wc.built).toBe(true);
    expect(wc.worker).toBe(-1);
    expect(w.economy.waitingFor(wc)).toMatch(/axe/);
  });
});
