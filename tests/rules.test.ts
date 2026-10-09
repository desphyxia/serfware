import { describe, expect, it } from "vitest";
import { creativeOf, worldOptionsFor, type SessionPlayer } from "../src/net/session";
import { COMBAT } from "../src/sim/econ/defs";
import { summarize, type VictoryRule } from "../src/sim/econ/victory";
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

  const run = (victory: VictoryRule, setup: (w: World) => void) => {
    const w = new World("prosper-1", { size: "tiny", victory });
    setup(w);
    for (let i = 0; i < 250 && w.economy.winner < 0; i++) w.step();
    return w;
  };

  it("Prosperity is won by reaching the production target, only when the rules allow it", () => {
    const reach = (w: World) => (w.economy.made[0] = COMBAT.prosperityGoods);
    const won = run("prosperity", reach);
    expect(won.economy.winner).toBe(0);
    expect(won.economy.winReason).toBe("prosperity");
    expect(run("all", reach).economy.winReason).toBe("prosperity");
    expect(run("both", reach).economy.winner).toBe(-1);
    expect(run("prosperity", (w) => (w.economy.made[0] = COMBAT.prosperityGoods - 1)).economy.winner).toBe(-1);
  });

  it("Influence is won by winning over most of the hamlets", () => {
    const join = (n: number) => (w: World) => {
      const hs = w.economy.wanderers.hamlets;
      expect(hs.length).toBeGreaterThanOrEqual(2);
      hs.slice(0, n).forEach((h) => (h.joined = 0));
    };
    const total = new World("prosper-1", { size: "tiny" }).economy.wanderers.hamlets.length;
    const half = Math.floor(total / 2);
    expect(run("influence", join(half)).economy.winner).toBe(-1);
    const won = run("influence", join(half + 1));
    expect(won.economy.winReason).toBe("influence");
    expect(run("both", join(total)).economy.winner).toBe(-1);
  });

  it("the summary names the winner and counts each settlement's goods and hamlets", () => {
    const w = run("prosperity", (x) => {
      x.economy.made[0] = COMBAT.prosperityGoods;
      x.economy.wanderers.hamlets[0]!.joined = 0;
    });
    const s = summarize(w.economy);
    expect(s.over).toBe(true);
    expect(s.reason).toBe("prosperity");
    expect(s.rows[0]).toMatchObject({ player: 0, outcome: "won", made: COMBAT.prosperityGoods, hamlets: 1 });
    expect(s.hamletsTotal).toBe(w.economy.wanderers.hamlets.length);
    expect(summarize(new World("prosper-1", { size: "tiny" }).economy).over).toBe(false);
  });
});
