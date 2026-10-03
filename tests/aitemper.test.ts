import { describe, expect, it } from "vitest";
import { TEMPERS, temperAllows } from "../src/sim/ai/personality";
import { World } from "../src/sim/world";

describe("the temperaments' limits", () => {
  it("say what each will not do", () => {
    expect(temperAllows("builder", { t: "raid" })).toBe(false);
    expect(temperAllows("builder", { t: "attack" })).toBe(true);
    expect(temperAllows("trader", { t: "break" })).toBe(false);
    expect(temperAllows("trader", { t: "send" })).toBe(true);
    expect(temperAllows("warden", { t: "hearthship" })).toBe(false);
    expect(temperAllows("warden", { t: "build", type: "maypole" })).toBe(false);
    expect(temperAllows("warden", { t: "build", type: "weaponsmith" })).toBe(true);
    expect(temperAllows("builder", { t: "build", type: "stable" })).toBe(false);
  });

  it("hold whatever planner asks, because the world enforces them", () => {
    for (const [personality, cmd] of [
      ["builder", { t: "raid", flag: 0 }],
      ["trader", { t: "break", with: 0 }],
      ["warden", { t: "probe", from: 0, to: 1 }],
    ] as const) {
      const w = new World("amber-fern-212", { size: "tiny", rivals: 1, personalities: [personality], peaceDays: 0 });
      // While a brain is acting, its temperament's limits apply to every order it gives, direct or not.
      (w as unknown as { acting: number }).acting = 1;
      const r = w.command({ ...cmd, player: 1 } as never);
      expect(r.ok, personality).toBe(false);
      expect(r.reason, personality).toBe("Not this temperament's way.");
      (w as unknown as { acting: number }).acting = -1;
    }
    // A person is not limited.
    const w = new World("amber-fern-212", { size: "tiny", rivals: 1, peaceDays: 0 });
    expect(w.command({ t: "raid", flag: 0 }).reason).not.toBe("Not this temperament's way.");
  });

  it("only names commands and buildings that exist", () => {
    for (const t of Object.values(TEMPERS)) expect(t.commands.length + t.buildings.length).toBeGreaterThan(0);
  });
});
