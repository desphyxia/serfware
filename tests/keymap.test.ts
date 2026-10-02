import { describe, expect, it } from "vitest";
import { ACTIONS, Keymap } from "../src/core/keymap";

describe("keymap", () => {
  it("starts with every action on its own key", () => {
    const k = new Keymap();
    expect(new Set(ACTIONS.map((a) => a.key)).size).toBe(ACTIONS.length);
    expect(k.actionOf("M")).toBe("menu");
    expect(k.actionOf("f2")).toBe("photo");
  });

  it("rebinds, and refuses a key another action holds or a reserved one", () => {
    const k = new Keymap();
    expect(k.set("menu", "n")).toBeNull();
    expect(k.actionOf("m")).toBeNull();
    expect(k.actionOf("n")).toBe("menu");
    expect(k.set("grid", "n")).toMatch(/Already used/);
    expect(k.set("grid", "Escape")).toMatch(/can't/);
    expect(k.key("grid")).toBe("g");
    k.reset();
    expect(k.actionOf("m")).toBe("menu");
  });

  it("sets a doubled stored key right and ignores unknown actions", () => {
    const k = new Keymap({ menu: "z", grid: "z", nonsense: "q" });
    expect(k.key("menu")).toBe("z");
    expect(k.key("grid")).toBe("g");
    expect(k.key("nonsense")).toBe("");
  });
});
