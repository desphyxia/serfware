import { describe, expect, it } from "vitest";
import { letterCode, makeLetter, mergeLetters, readLetter } from "../src/core/postcard";
import { makeSave, ReplaySession, SoloSession } from "../src/net/session";
import { BUILDINGS, buildingType } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";

describe("time-lapse replay", () => {
  it("plays a save again from the first tick and ends in the same state", () => {
    const world = new World("amber-fern-212", { size: "tiny" });
    const session = new SoloSession(world);
    const keep = world.economy.buildings[world.economy.keep]!;
    session.advance(2000, 400);
    // An order along the way.
    const def = BUILDINGS[buildingType("lantern")]!;
    const land = world.land;
    const spot = land.ring(keep.tile, 6).find((t) => { const f = land.bestFlagTile(t, 0); return f >= 0 && land.canBuildDef(t, f, def, 0); })!;
    expect(session.submit({ t: "build", type: "lantern", tile: spot, flagTile: land.bestFlagTile(spot, 0) }).ok).toBe(true);
    session.advance(4000, 400);
    const save = makeSave(session, "t", "test");
    const replay = new ReplaySession(save, { size: "tiny" });
    expect(replay.progress).toBe(0);
    expect(replay.submit().ok).toBe(false);
    replay.speed = 100000;
    for (let i = 0; i < 400 && replay.finished === null; i++) replay.advance(100);
    expect(replay.finished).toBe(true);
    expect(replay.progress).toBe(1);
    replay.restart();
    expect(replay.progress).toBe(0);
    expect(save.commands.length).toBeGreaterThan(0);
  });
});

describe("letters", () => {
  it("round-trips through its code, and refuses what is not a letter", () => {
    const l = makeLetter({ from: "Ada", seed: "amber-fern-212", day: 12.7, to: "Bram", text: "Hello from the island — ünïcode ok.", picture: "data:image/jpeg;base64,AAAA", now: new Date("2026-10-02T10:00:00Z") });
    expect(readLetter(letterCode(l))).toEqual(l);
    expect(readLetter(JSON.stringify(l))).toEqual(l);
    expect(readLetter("seedfall-letter:%%%")).toBeNull();
    expect(readLetter('{"format":"other"}')).toBeNull();
  });

  it("cuts fields to size and drops unsafe pictures", () => {
    const l = readLetter(JSON.stringify({ format: "seedfall-letter", version: 1, from: "x".repeat(100), seed: "s", day: -3, to: "", text: "y".repeat(5000), picture: "javascript:alert(1)", sent: "2026" }))!;
    expect(l.from.length).toBe(40);
    expect(l.text.length).toBe(600);
    expect(l.day).toBe(0);
    expect(l.picture).toBeUndefined();
  });

  it("keeps one copy of a letter, newest first", () => {
    const a = makeLetter({ from: "A", seed: "s", day: 1, text: "one", now: new Date("2026-01-01") });
    const b = makeLetter({ from: "B", seed: "s", day: 1, text: "two", now: new Date("2026-02-01") });
    const all = mergeLetters(mergeLetters(mergeLetters([], a), b), a);
    expect(all.map((x) => x.text)).toEqual(["two", "one"]);
  });
});
