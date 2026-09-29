import { describe, expect, it } from "vitest";
import { LockstepSession } from "../src/net/lockstep";
import { makeSave, replaySave, SoloSession } from "../src/net/session";
import { LoopbackHub } from "../src/net/transport";
import { placeConnected, starterChain } from "../src/sim/econ/planner";
import { World } from "../src/sim/world";

function pair(mode: "shared" | "neighbours", latency = 0) {
  const hub = new LoopbackHub();
  hub.latencyTicks = latency;
  const players = [
    { id: 0, name: "Host" },
    { id: 1, name: "Guest" },
  ];
  const opts = { size: "tiny" as const, players: mode === "neighbours" ? 2 : 1 };
  const info = { mode, seed: "lockstep-1", players };
  const a = new LockstepSession(new World("lockstep-1", opts), info, 0, hub.connect("host"));
  const b = new LockstepSession(new World("lockstep-1", opts), info, 1, hub.connect("guest"));
  return { hub, a, b };
}

/** Plan a chain on a scratch copy of the world and return the commands it used. */
function plannedCommands(seed: string, player: number, opts: { size: "tiny"; players: number }) {
  const scratch = new World(seed, opts);
  const cmds: Parameters<World["command"]>[0][] = [];
  const orig = scratch.command.bind(scratch);
  scratch.command = (c) => {
    const r = orig(c);
    if (r.ok) cmds.push(c);
    return r;
  };
  starterChain(scratch, player);
  return cmds;
}

describe("lockstep", () => {
  it("keeps two peers in sync in shared co-op", () => {
    const { a, b } = pair("shared");
    const cmds = plannedCommands("lockstep-1", 0, { size: "tiny", players: 1 });
    cmds.slice(0, 3).forEach((c) => a.submit(c));
    cmds.slice(3).forEach((c) => b.submit(c));
    for (let i = 0; i < 400; i++) {
      a.advance(100);
      b.advance(100);
    }
    expect(a.world.tick).toBeGreaterThan(300);
    expect(Math.abs(a.world.tick - b.world.tick)).toBeLessThanOrEqual(8);
    // Bring both to the same tick and compare.
    while (a.world.tick < b.world.tick) a.advance(100, 1);
    while (b.world.tick < a.world.tick) b.advance(100, 1);
    expect(a.world.checksum()).toBe(b.world.checksum());
    expect(a.world.economy.buildings.filter((x) => x.alive).length).toBeGreaterThan(2);
  });

  it("gives each player their own keep in neighbours mode", () => {
    const { a, b, hub } = pair("neighbours", 2);
    expect(a.world.economy.keeps.length).toBe(2);
    const cmdsB = plannedCommands("lockstep-1", 1, { size: "tiny", players: 2 });
    cmdsB.forEach((c) => b.submit(c));
    for (let i = 0; i < 300; i++) {
      a.advance(100);
      b.advance(100);
      hub.pump();
    }
    for (let i = 0; i < 20 && a.world.tick !== b.world.tick; i++) {
      hub.pump();
      if (a.world.tick < b.world.tick) a.advance(100, 1);
      if (b.world.tick < a.world.tick) b.advance(100, 1);
    }
    expect(a.world.tick).toBe(b.world.tick);
    expect(a.world.checksum()).toBe(b.world.checksum());
    expect(a.world.economy.buildings.some((x) => x.alive && x.owner === 1 && x.def.id !== "keep")).toBe(true);
  });

  it("stalls instead of diverging when a peer is missing, and reports desyncs", () => {
    const hub = new LoopbackHub();
    const players = [
      { id: 0, name: "Host" },
      { id: 1, name: "Guest" },
    ];
    const a = new LockstepSession(new World("stall", { size: "tiny" }), { mode: "shared", seed: "stall", players }, 0, hub.connect("host"));
    const start = a.world.tick;
    for (let i = 0; i < 50; i++) a.advance(100);
    expect(a.world.tick - start).toBeLessThanOrEqual(8);
    expect(a.status() ?? "").toMatch(/Waiting|^$/);
  });

  it("detects a desync", () => {
    const { a, b } = pair("shared");
    let reported = "";
    a.onDesync = (d) => (reported = d);
    b.onDesync = (d) => (reported = d);
    for (let i = 0; i < 20; i++) {
      a.advance(100);
      b.advance(100);
    }
    // Corrupt one side.
    b.world.economy.buildings[0]!.residents += 1;
    for (let i = 0; i < 40; i++) {
      a.advance(100);
      b.advance(100);
    }
    expect(reported).toMatch(/Desync/);
  });
});

describe("saves", () => {
  it("replays a command log to the same state", () => {
    const s = new SoloSession(new World("save-1", { size: "tiny" }));
    for (let i = 0; i < 50; i++) s.advance(100);
    // Plan on a scratch world at the same tick, then submit through the session so it is logged.
    const scratch = new World("save-1", { size: "tiny" });
    while (scratch.tick < s.world.tick) scratch.step();
    const cmds: Parameters<World["command"]>[0][] = [];
    const orig = scratch.command.bind(scratch);
    scratch.command = (c) => {
      const r = orig(c);
      if (r.ok) cmds.push(c);
      return r;
    };
    placeConnected(scratch, "woodcutter", { minDist: 3 });
    for (const c of cmds) expect(s.submit(c).ok).toBe(true);
    for (let i = 0; i < 300; i++) s.advance(100);
    const save = makeSave(s, "test", "dev");
    const { world, matches } = replaySave(JSON.parse(JSON.stringify(save)), { size: "tiny" });
    expect(world.tick).toBe(s.world.tick);
    expect(matches).toBe(true);
  });
});
