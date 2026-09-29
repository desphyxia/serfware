import { describe, expect, it } from "vitest";
import { RingLog } from "../src/core/log";
import { MemoryMonitor, trend, type MemSample } from "../src/core/memory";
import { defaultSettings, detectPreset, PRESETS, sanitize, SettingsStore, suggestPreset } from "../src/core/settings";

const sample = (t: number, over: Partial<MemSample> = {}): MemSample => ({
  t,
  heapMB: 50,
  geometries: 10,
  textures: 5,
  programs: 8,
  objects: 100,
  ...over,
});

describe("memory leak heuristic", () => {
  it("computes slope per minute", () => {
    const t = [0, 60000, 120000];
    expect(trend(t, [1, 2, 3]).slopePerMin).toBeCloseTo(1);
    expect(trend(t, [1, 2, 3]).r2).toBeCloseTo(1);
  });

  it("flags steady geometry growth", () => {
    const m = new MemoryMonitor(100, 24);
    let warnings: ReturnType<MemoryMonitor["add"]> = [];
    for (let i = 0; i < 24; i++) warnings = m.add(sample(i * 5000, { geometries: 10 + i }));
    expect(warnings.map((w) => w.metric)).toContain("geometries");
  });

  it("ignores noisy but flat memory", () => {
    const m = new MemoryMonitor(100, 24);
    const all = [];
    for (let i = 0; i < 40; i++) all.push(...m.add(sample(i * 5000, { heapMB: 50 + (i % 3) * 4, geometries: 10 + (i % 2) })));
    expect(all).toEqual([]);
  });

  it("warns at most once per metric per five minutes", () => {
    const m = new MemoryMonitor(200, 24);
    let count = 0;
    for (let i = 0; i < 60; i++) count += m.add(sample(i * 5000, { textures: 5 + i })).length;
    expect(count).toBe(1);
  });
});

describe("settings", () => {
  it("detects presets and custom values", () => {
    expect(detectPreset(PRESETS.low)).toBe("low");
    expect(detectPreset({ ...PRESETS.high, bloom: false })).toBe("custom");
  });

  it("switches to custom when a value changes and back when a preset is applied", () => {
    const s = new SettingsStore(defaultSettings("medium"));
    s.setGraphics({ vegetation: 0.2 });
    expect(s.get().preset).toBe("custom");
    s.applyPreset("high");
    expect(s.get().preset).toBe("high");
    expect(s.get().graphics.msaa).toBe(4);
  });

  it("sanitises stored data", () => {
    const out = sanitize({ graphics: { bloom: "yes", vegetation: 0.5 }, audio: { master: 0.2 } }, defaultSettings("low"));
    expect(out.graphics.bloom).toBe(false);
    expect(out.graphics.vegetation).toBe(0.5);
    expect(out.audio.master).toBe(0.2);
    expect(out.preset).toBe("custom");
    expect(sanitize(null, defaultSettings("low")).preset).toBe("low");
  });

  it("suggests presets from hardware hints", () => {
    expect(suggestPreset({ mobile: true })).toBe("low");
    expect(suggestPreset({ cores: 16, memoryGB: 16 })).toBe("high");
    expect(suggestPreset({ cores: 4, memoryGB: 8 })).toBe("medium");
  });
});

describe("ring log", () => {
  it("keeps only the newest entries", () => {
    const l = new RingLog(3, () => 0);
    for (let i = 0; i < 5; i++) l.info(`m${i}`);
    expect(l.entries().map((e) => e.msg)).toEqual(["m2", "m3", "m4"]);
  });
});
