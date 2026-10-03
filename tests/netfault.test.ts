import { describe, expect, it } from "vitest";
import { LockstepSession } from "../src/net/lockstep";
import type { SessionPlayer } from "../src/net/session";
import { LoopbackHub, type NetMessage } from "../src/net/transport";
import { starterChain } from "../src/sim/econ/planner";
import { Rng } from "../src/sim/rng";
import { World } from "../src/sim/world";

/** A flaky network: messages are lost, repeated, and arrive late and out of order. */
class FlakyHub extends LoopbackHub {
  lost = 0;
  repeated = 0;
  private readonly rng = new Rng("flaky");
  constructor(private readonly loss: number, private readonly repeat: number, private readonly jitter: number) {
    super();
    this.latencyTicks = 1;
  }

  override deliver(from: string, to: string, msg: NetMessage): void {
    if (this.rng.next() < this.loss) {
      this.lost++;
      return;
    }
    const times = this.rng.next() < this.repeat ? 2 : 1;
    if (times === 2) this.repeated++;
    for (let i = 0; i < times; i++) {
      // Each copy waits a different time, so they overtake each other.
      this.latencyTicks = 1 + Math.floor(this.rng.next() * this.jitter);
      super.deliver(from, to, msg);
    }
  }
}

const players: SessionPlayer[] = [
  { id: 0, name: "Host" },
  { id: 1, name: "Guest" },
  { id: 2, name: "Third" },
];

function run(loss: number, repeat: number, jitter: number, rounds: number) {
  const hub = new FlakyHub(loss, repeat, jitter);
  const opts = { size: "tiny" as const, players: 3 };
  const info = () => ({ mode: "neighbours" as const, seed: "flaky-1", players: players.map((p) => ({ ...p })) });
  const sessions = players.map((p) => new LockstepSession(new World("flaky-1", opts), info(), p.id, hub.connect(`p${p.id}`)));
  // Everyone builds something along the way, so there is something to disagree about.
  const scratch = new World("flaky-1", opts);
  const planned: Parameters<World["command"]>[0][] = [];
  const orig = scratch.command.bind(scratch);
  scratch.command = (c) => {
    const r = orig(c);
    if (r.ok) planned.push(c);
    return r;
  };
  for (const p of [0, 1, 2]) starterChain(scratch, p);
  planned.filter((c) => (c as { player?: number }).player !== undefined).forEach((c, i) => sessions[(c as { player: number }).player]?.submit(c) ?? i);
  for (let i = 0; i < rounds; i++) {
    for (const s of sessions) s.advance(100, 2);
    hub.pump();
  }
  return { hub, sessions };
}

describe("lockstep on a bad network", () => {
  it("stays in sync with late, reordered and repeated messages", () => {
    const { sessions, hub } = run(0, 0.25, 4, 900);
    expect(hub.repeated).toBeGreaterThan(50);
    const top = Math.min(...sessions.map((s) => s.world.tick));
    expect(top).toBeGreaterThan(300);
    for (const s of sessions) expect(s.status() === null || !String(s.status()).startsWith("Out of sync")).toBe(true);
    // Compare at a turn all have passed.
    const turn = Math.floor(top / 2) - 2;
    const sums = sessions.map((s) => s.checksumAt(turn));
    expect(sums[0]).toBeDefined();
    expect(new Set(sums).size).toBe(1);
  });

  it("recovers when messages are lost, by asking for the turn it is missing", () => {
    const { sessions, hub } = run(0.12, 0.05, 3, 3000);
    expect(hub.lost).toBeGreaterThan(100);
    const top = Math.min(...sessions.map((s) => s.world.tick));
    // Without asking again, the first lost packet would stop the game for good.
    expect(top).toBeGreaterThan(400);
    const turn = Math.floor(top / 2) - 2;
    const sums = sessions.map((s) => s.checksumAt(turn));
    expect(sums[0]).toBeDefined();
    expect(new Set(sums).size).toBe(1);
  });
});
