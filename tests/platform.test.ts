import { describe, expect, it } from "vitest";
import { deadzone, padActions, PAD, readPad, type PadState } from "../src/ui/gamepad";
import { radialIndex } from "../src/ui/radialMenu";
import { ACHIEVEMENTS, newlyEarned } from "../src/platform/achievements";
import { CloudSaves } from "../src/platform/cloudSaves";
import type { DesktopBridge } from "../src/platform/bridge";
import { defaultSettings, DECK_UI_SCALE, detectPreset, PRESETS, SettingsStore } from "../src/core/settings";
import { starterChain } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

const pad = (axes: number[], pressed: number[] = []) =>
  readPad({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

describe("controller", () => {
  it("ignores stick drift and rescales past the dead zone", () => {
    expect(deadzone(0.1, -0.1)).toEqual([0, 0]);
    const [x, y] = deadzone(1, 0);
    expect(x).toBeCloseTo(1);
    expect(y).toBe(0);
    const [hx] = deadzone(0.6, 0);
    expect(hx).toBeGreaterThan(0.4);
    expect(hx).toBeLessThan(0.6);
  });

  it("turns button presses into actions once, on the way down", () => {
    const idle = pad([0, 0, 0, 0]);
    const a = pad([0, 0, 0, 0], [PAD.A, PAD.X]);
    expect(padActions(idle, a)).toEqual(["confirm", "radial"]);
    // Held: no repeat.
    expect(padActions(a, a)).toEqual([]);
    const s: PadState = pad([0, 0, 0, 0], [PAD.B]);
    expect(padActions(null, s)).toEqual(["back"]);
  });

  it("maps the stick to radial menu slices clockwise from the top", () => {
    expect(radialIndex(0, 0, 8)).toBe(-1);
    expect(radialIndex(0, -1, 8)).toBe(0);
    expect(radialIndex(1, 0, 8)).toBe(2);
    expect(radialIndex(0, 1, 8)).toBe(4);
    expect(radialIndex(-1, 0, 8)).toBe(6);
    expect(radialIndex(-0.7, -0.7, 8)).toBe(7);
  });
});

describe("achievements", () => {
  it("are earned by play, once", () => {
    const w = new World("achieve-1", { size: "tiny" });
    const have = new Set<string>();
    expect(newlyEarned(w, 0, have).map((a) => a.id)).not.toContain("FIRST_ROAD");
    starterChain(w);
    const got = newlyEarned(w, 0, have).map((a) => a.id);
    expect(got).toContain("FIRST_ROAD");
    for (const id of got) have.add(id);
    expect(newlyEarned(w, 0, have)).toEqual([]);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe("Steam Cloud saves", () => {
  it("mirror saves to the cloud and bring them in on another machine", async () => {
    const cloud = new Map<string, string>();
    const bridge = {
      cloudEnabled: async () => true,
      cloudWrite: async (n: string, t: string) => (cloud.set(n, t), true),
      cloudRead: async (n: string) => cloud.get(n) ?? null,
      cloudList: async () => [...cloud.keys()],
      cloudDelete: async (n: string) => cloud.delete(n),
    } as unknown as DesktopBridge;
    const a = new MemStorage();
    a.setItem("seedfall.save.s1", '{"format":"seedfall-save"}');
    a.setItem("seedfall.saves", JSON.stringify([{ id: "s1", name: "One" }]));
    await new CloudSaves(bridge, a as Storage).push("s1");
    expect(cloud.has("save-s1.json")).toBe(true);
    const b = new MemStorage();
    expect(await new CloudSaves(bridge, b as Storage).pull()).toBe(1);
    expect(b.getItem("seedfall.save.s1")).toBe('{"format":"seedfall-save"}');
    expect(JSON.parse(b.getItem("seedfall.saves")!)[0].id).toBe("s1");
    // Nothing new the second time.
    expect(await new CloudSaves(bridge, b as Storage).pull()).toBe(0);
  });
});

describe("Steam Deck preset", () => {
  it("caps at 40 fps, lightens the load and enlarges the interface", () => {
    const store = new SettingsStore(defaultSettings("high"));
    store.applyPreset("deck");
    const s = store.get();
    expect(s.graphics.maxFps).toBe(40);
    expect(s.ui.uiScale).toBe(DECK_UI_SCALE);
    expect(detectPreset(PRESETS.deck)).toBe("deck");
    store.applyPreset("medium");
    expect(store.get().preset).toBe("medium");
  });
});
