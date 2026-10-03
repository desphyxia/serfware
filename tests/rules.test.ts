import { describe, expect, it } from "vitest";
import { creativeOf, worldOptionsFor, type SessionPlayer } from "../src/net/session";
import { World } from "../src/sim/world";

const players: SessionPlayer[] = [
  { id: 0, name: "Ada" },
  { id: 1, name: "Bram" },
];

describe("match rules", () => {
  it("the host's peace, stakes and victory rules reach the world and come back out for saves", () => {
    const creative = { rules: { peaceDays: 5, stakes: "mortal" as const, victory: "conquest" as const } };
    const w = new World("rules-1", { size: "tiny", ...worldOptionsFor("neighbours", players, undefined, creative) });
    const eco = w.economy;
    expect(eco.stakes).toBe("mortal");
    expect(eco.victory).toBe("conquest");
    expect(eco.peaceUntil - w.tick).toBe(Math.round(5 * eco.dayTicks));
    expect(creativeOf(w)?.rules).toEqual(creative.rules);
    // Without rules the usual ones apply and nothing is recorded.
    const plain = new World("rules-1", { size: "tiny", ...worldOptionsFor("neighbours", players) });
    expect(plain.economy.victory).toBe("both");
    expect(creativeOf(plain)?.rules).toBeUndefined();
  });

  it("holding the Star Wells does not win a conquest-only match, and conquest does not win a wells-only one", () => {
    const hold = (victory: "both" | "conquest" | "wells") => {
      const w = new World("wells-win", { size: "tiny", victory });
      const grid = w.planet.grid;
      for (let t = 0; t < grid.count; t++) if (grid.degree(t) === 5) w.land.territory[t] = 1;
      for (let i = 0; i < 40000 && w.economy.winner < 0; i++) w.step();
      return w.economy.winner;
    };
    expect(hold("both")).toBe(0);
    expect(hold("wells")).toBe(0);
    expect(hold("conquest")).toBe(-1);
  }, 120000);
});
