import { describe, expect, it } from "vitest";
import { placeConnected } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

describe("warden rotation (Serf City's cycle knights)", () => {
  it("a stronger free warden relieves the weakest on watch at a border lantern", () => {
    const w = new World("russet-heron-417", { size: "small" });
    const eco = w.economy;
    expect(placeConnected(w, "lamphouse", { minDist: 3, maxDist: 8 })).toBe(true);
    const lantern = eco.buildings.find((b) => b.alive && b.def.slots && !eco.keeps.includes(b.id))!;
    for (let i = 0; i < 20000 && !(lantern.built && lantern.garrison.some((g) => eco.settlers[g]!.state === "guard")); i++) w.step();
    const guardRank = () => lantern.garrison.map((g) => eco.people[eco.settlers[g]!.person]!.rank);
    // The lantern fills up, near a border, with ordinary wardens.
    const full = () => {
      lantern.threat = 2;
      return lantern.garrison.length >= eco.garrisonWant(lantern) && lantern.garrison.every((g) => eco.settlers[g]!.state === "guard");
    };
    for (let i = 0; i < 20000 && !(lantern.built && full()); i++) w.step();
    expect(full()).toBe(true);
    expect(Math.max(...guardRank())).toBe(0);
    // Then a seasoned warden is free at home.
    const veteran = eco.people.find((p) => p.alive && p.owner === 0 && p.stage === "adult" && p.settler < 0)!;
    veteran.rank = 3;
    // Without the order nothing changes.
    for (let i = 0; i < 300; i++) {
      lantern.threat = 2;
      w.step();
    }
    expect(guardRank()).not.toContain(3);
    expect(w.command({ t: "rotate" }).ok).toBe(true);
    for (let i = 0; i < 3000 && !guardRank().includes(3); i++) {
      lantern.threat = 2;
      w.step();
    }
    expect(guardRank()).toContain(3);
  }, 120000);
});
