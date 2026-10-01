import { describe, expect, it } from "vitest";
import { LockstepSession } from "../src/net/lockstep";
import { resumeWorld, worldOptionsFor, type SessionPlayer } from "../src/net/session";
import { LoopbackHub } from "../src/net/transport";
import { World } from "../src/sim/world";

const SEED = "lockstep-1";
const players: SessionPlayer[] = [
  { id: 0, name: "Host" },
  { id: 1, name: "Guest" },
  { id: 100, name: "Watcher", spectator: true },
];
const opts = { size: "tiny" as const, ...worldOptionsFor("neighbours", players) };

function level(sessions: LockstepSession[]) {
  const top = Math.max(...sessions.map((s) => s.world.tick));
  for (const s of sessions) for (let i = 0; i < 400 && s.world.tick < top; i++) s.advance(100, 1);
}

describe("drop-out, steward, rejoin and spectating", () => {
  it("the game goes on when a player drops (a steward keeps them), they rejoin, and a spectator watches throughout", () => {
    const hub = new LoopbackHub();
    const info = () => ({ mode: "neighbours" as const, seed: SEED, players: players.map((p) => ({ ...p })) });
    const a = new LockstepSession(new World(SEED, opts), info(), 0, hub.connect("host"));
    const b = new LockstepSession(new World(SEED, opts), info(), 1, hub.connect("guest"));
    const c = new LockstepSession(new World(SEED, opts), info(), 100, hub.connect("watch"));
    expect(c.spectating).toBe(true);
    expect(c.submit({ t: "flag", tile: 0 }).ok).toBe(false);
    for (let i = 0; i < 100; i++) for (const s of [a, b, c]) s.advance(100, 2);
    expect(c.world.tick).toBeGreaterThan(100);

    // The guest drops: the host stops waiting for them and a steward takes over.
    hub.disconnect("guest");
    a.dropPlayer(1);
    const at = a.world.tick;
    for (let i = 0; i < 150; i++) for (const s of [a, c]) s.advance(100, 2);
    expect(a.world.tick).toBeGreaterThan(at + 100);
    expect(a.world.stewards.has(1)).toBe(true);
    expect(c.world.stewards.has(1)).toBe(true);

    // They come back: rebuilt from the log, then in lockstep again; the steward hands over.
    const t = hub.connect("guest2");
    const catchUp = a.catchUp(1);
    const world = resumeWorld(SEED, "neighbours", players, catchUp.log, catchUp.tick, { size: "tiny" });
    const b2 = new LockstepSession(world, info(), 1, t, catchUp);
    for (let i = 0; i < 200; i++) for (const s of [a, b2, c]) s.advance(100, 2);
    expect(b2.world.tick).toBeGreaterThan(catchUp.tick + 100);
    expect(a.world.stewards.has(1)).toBe(false);
    level([a, b2, c]);
    expect(b2.world.checksum()).toBe(a.world.checksum());
    expect(c.world.checksum()).toBe(a.world.checksum());
    expect(b2.status()).toBeNull();
  });
});
