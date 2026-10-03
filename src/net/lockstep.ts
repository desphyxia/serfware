import type { CommandResult } from "../sim/econ/economy";
import type { WorldCommand as Command } from "../sim/world";
import { TICK_MS } from "../sim/clock";
import type { World } from "../sim/world";
import { Session, type LoggedCommand, type SessionInfo } from "./session";
import type { NetMessage, Transport } from "./transport";

/** Ticks per lockstep turn (200 ms). */
export const TURN_TICKS = 2;
/** A peer stuck this long on a turn asks the others to send what it is missing. */
export const NEED_AFTER_MS = 500;
/** Commands are scheduled this many turns ahead, hiding network latency. */
export const INPUT_DELAY = 3;

export interface TurnPacket extends NetMessage {
  type: "turn";
  turn: number;
  player: number;
  cmds: Command[];
  /** Speed chosen by the host for this turn (only the host's value counts). */
  speed?: number;
  /** Checksum of the sender's world at the start of turn `sumTurn`. */
  sum: number;
  sumTurn: number;
}

/** What a rejoining player (or a late spectator) needs to catch up with a game in progress. */
export interface CatchUp {
  log: LoggedCommand[];
  tick: number;
  /** Turn packets already exchanged for turns from `startTurn` on. */
  packets: TurnPacket[];
  startTurn: number;
  /** First turn the newcomer sends its own packet for (spectators: never). */
  sendFrom: number;
}

/**
 * Deterministic lockstep: every peer runs the same simulation and only exchanges commands.
 * At the start of turn k each peer sends its commands for turn k + INPUT_DELAY together with
 * a checksum of its state, then waits until it has every player's packet for turn k.
 * Checksums are compared as they arrive; any mismatch is reported as a desync.
 */
export class LockstepSession extends Session {
  private pending: Command[] = [];
  private readonly packets = new Map<number, Map<number, TurnPacket>>();
  private readonly sums = new Map<number, number>();
  private readonly remoteSums = new Map<number, Map<number, number>>();
  private sentThrough: number;
  /** First turn of this session; earlier turns need no packets. */
  private readonly startTurn: number;
  private waitingSince = 0;
  /** Game milliseconds spent waiting on the current turn, and since we last asked for what is missing. */
  private waitedMs = 0;
  private askedAt = 0;
  private desynced = false;
  private hostSpeed = 1;
  private resumeAt: { tick: number; value: number } | null = null;
  private readonly isHost: boolean;
  /** Joined a game in progress: every turn from the first needs its packets. */
  private readonly resumed: boolean;
  /**
   * Host only: players who dropped out, and the turn they are back from (Infinity: still away).
   * The host sends empty turns for them so nobody waits, and a steward keeps their settlement.
   */
  private readonly absent = new Map<number, number>();

  constructor(
    world: World,
    info: SessionInfo,
    localPlayer: number,
    private readonly transport: Transport,
    resume?: CatchUp,
  ) {
    super(world, info, localPlayer);
    this.isHost = localPlayer === 0;
    this.resumed = !!resume;
    this.startTurn = resume ? resume.startTurn : Math.ceil(world.tick / TURN_TICKS);
    this.sentThrough = resume ? resume.sendFrom - 1 : this.startTurn + INPUT_DELAY - 1;
    transport.onMessage((msg, from) => this.receive(msg, from));
    if (resume) for (const p of resume.packets) this.receive(p, "history");
  }

  /** The players the game waits for (not spectators). */
  private get playing(): number[] {
    return this.info.players.filter((p) => !p.spectator).map((p) => p.id);
  }

  /** Host: a player's connection dropped. A steward takes over; the game goes on without them. */
  dropPlayer(player: number): void {
    if (!this.isHost || player === 0 || !this.playing.includes(player) || this.absent.get(player) === Infinity) return;
    this.absent.set(player, Infinity);
    this.pending.push({ t: "steward", of: player, on: true, player: 0 });
    this.fillAbsent();
  }

  /**
   * Host: a dropped player is back (or a spectator arrives late). Everything they need to catch
   * up; they send their own turns again from a few turns ahead, when the steward hands over.
   */
  catchUp(player: number, spectator = false): CatchUp {
    const startTurn = Math.ceil(this.world.tick / TURN_TICKS);
    const sendFrom = spectator ? Number.MAX_SAFE_INTEGER : this.sentThrough + 2;
    if (!spectator && this.absent.has(player)) {
      this.absent.set(player, sendFrom);
      this.pending.push({ t: "steward", of: player, on: false, player: 0 });
      this.fillAbsent();
    }
    if (spectator && !this.info.players.some((p) => p.id === player)) this.info.players.push({ id: player, name: `Spectator ${player - 99}`, spectator: true });
    const packets: TurnPacket[] = [];
    for (const [turn, m] of this.packets) if (turn >= startTurn) packets.push(...m.values());
    return { log: [...this.log], tick: this.world.tick, packets, startTurn, sendFrom };
  }

  /** Host: empty turns for absent players, through the last turn we have sent for. */
  private fillAbsent(): void {
    for (const [pl, until] of this.absent) {
      for (let t = this.turn; t <= this.sentThrough && t < until; t++) {
        if (this.packets.get(t)?.has(pl)) continue;
        const pkt: TurnPacket = { type: "turn", turn: t, player: pl, cmds: [], sum: 0, sumTurn: -1 };
        this.receive(pkt, "local");
        this.transport.broadcast(pkt);
      }
      if (until <= this.sentThrough) this.absent.delete(pl);
    }
  }

  private get turn(): number {
    return Math.floor(this.world.tick / TURN_TICKS);
  }

  submit(cmd: Command): CommandResult {
    if (this.spectating) return { ok: false, reason: "You are watching this game." };
    const withPlayer = { ...cmd, player: this.player };
    const reason = this.world.check(withPlayer);
    if (reason) return { ok: false, reason };
    this.pending.push(withPlayer);
    return { ok: true };
  }

  /**
   * Only the host sets speed. Changes ride on the next turn packet so everyone switches on the
   * same tick. Resuming from pause uses a direct message, since paused peers send no turns.
   */
  setSpeed(value: number): void {
    if (!this.isHost) return;
    this.hostSpeed = value;
    if (this.speed === 0 && value > 0) {
      const msg = { type: "resume", tick: this.world.tick, value };
      this.resumeAt = { tick: this.world.tick, value };
      this.transport.broadcast(msg);
    }
  }

  private receive(msg: NetMessage, from: string): void {
    if (msg.type === "resume") {
      this.resumeAt = { tick: msg.tick as number, value: msg.value as number };
      if (this.isHost && from !== "local") this.transport.broadcast(msg, from);
      return;
    }
    if (msg.type === "need") {
      // Someone is stuck on a turn: send them the packets we hold for it (a packet can be lost on the way).
      const m = this.packets.get(msg.turn as number);
      if (m && from !== "local") for (const pkt of m.values()) this.transport.send(from, pkt);
      return;
    }
    if (msg.type !== "turn") return;
    const p = msg as unknown as TurnPacket;
    let m = this.packets.get(p.turn);
    if (!m) this.packets.set(p.turn, (m = new Map()));
    // First packet wins (a dropped player's late packet never replaces the host's empty turn).
    if (m.has(p.player)) return;
    m.set(p.player, p);
    this.checkSum(p.player, p.sumTurn, p.sum);
    // The host relays client packets to the other clients (star topology).
    if (this.isHost && from !== "local") this.transport.broadcast(p, from);
  }

  private checkSum(player: number, turn: number, sum: number): void {
    if (turn < 0 || player === this.localPlayer) return;
    const mine = this.sums.get(turn);
    if (mine === undefined) {
      let r = this.remoteSums.get(turn);
      if (!r) this.remoteSums.set(turn, (r = new Map()));
      r.set(player, sum);
      return;
    }
    if (mine !== sum && !this.desynced) {
      this.desynced = true;
      const detail = `Desync at turn ${turn} (tick ${turn * TURN_TICKS}): local ${mine.toString(16)} vs player ${player} ${sum.toString(16)}`;
      this.onDesync?.(detail);
    }
  }

  /** Start-of-turn work: record checksum, send our packet for turn + delay. */
  private beginTurn(k: number): void {
    if (!this.sums.has(k)) {
      const sum = this.world.checksum();
      this.sums.set(k, sum);
      const early = this.remoteSums.get(k);
      if (early) {
        for (const [pl, s] of early) this.checkSum(pl, k, s);
        this.remoteSums.delete(k);
      }
      // Forget old history.
      this.sums.delete(k - 200);
      this.packets.delete(k - 10);
    }
    const target = k + INPUT_DELAY;
    if (this.spectating) return;
    if (this.sentThrough < target) {
      const pkt: TurnPacket = {
        type: "turn",
        turn: target,
        player: this.localPlayer,
        cmds: this.pending,
        sum: this.sums.get(k) as number,
        sumTurn: k,
        speed: this.isHost ? this.hostSpeed : undefined,
      };
      this.pending = [];
      this.sentThrough = target;
      this.receive(pkt, "local");
      this.transport.broadcast(pkt);
      if (this.isHost && this.absent.size) this.fillAbsent();
    }
  }

  private ready(k: number): boolean {
    if (!this.resumed && k < this.startTurn + INPUT_DELAY) return true;
    const m = this.packets.get(k);
    if (!m) return false;
    for (const pl of this.playing) if (!m.has(pl)) return false;
    return true;
  }

  private applyTurn(k: number): void {
    const m = this.packets.get(k);
    if (!m) return;
    const players = [...m.keys()].sort((a, b) => a - b);
    for (const pl of players) {
      const pkt = m.get(pl) as TurnPacket;
      if (pl === 0 && pkt.speed !== undefined) this.speed = pkt.speed;
      for (const cmd of pkt.cmds) {
        const r = this.world.command(cmd);
        if (r.ok) this.log.push({ tick: this.world.tick, cmd });
      }
    }
  }

  advance(ms: number, maxSteps = 200): number {
    if (this.desynced) return 0;
    // Even when paused, keep turns flowing so speed changes and commands still arrive.
    const effective = Math.max(this.speed, 0);
    this.acc += ms * (effective > 0 ? effective : 0);
    let steps = 0;
    const now = performance.now();
    if (effective === 0) {
      if (this.resumeAt && this.resumeAt.tick === this.world.tick) {
        this.speed = this.resumeAt.value;
        this.resumeAt = null;
      }
      return 0;
    }
    while (this.acc >= TICK_MS && steps < maxSteps) {
      if (this.world.tick % TURN_TICKS === 0) {
        const k = this.turn;
        this.beginTurn(k);
        if (!this.ready(k)) {
          if (!this.waitingSince) this.waitingSince = now;
          this.acc = Math.min(this.acc, TICK_MS * TURN_TICKS * 4);
          // Stuck for a while: a packet may have been lost. Ask the others for this turn, and again every so often.
          this.waitedMs += ms;
          if (this.waitedMs - this.askedAt >= NEED_AFTER_MS) {
            this.askedAt = this.waitedMs;
            this.transport.broadcast({ type: "need", turn: k });
          }
          return steps;
        }
        this.waitingSince = 0;
        this.waitedMs = 0;
        this.askedAt = 0;
        this.applyTurn(k);
      }
      this.stepWorld();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    return steps;
  }

  /** Our checksum at the start of a turn, if we have passed it (tests and bug reports). */
  checksumAt(turn: number): number | undefined {
    return this.sums.get(turn);
  }

  override status(): string | null {
    if (this.desynced) return "Out of sync. Please send a bug report (F8).";
    if (this.waitingSince && performance.now() - this.waitingSince > 1200) {
      const m = this.packets.get(this.turn);
      const missing = this.info.players.filter((p) => !p.spectator && !m?.has(p.id)).map((p) => p.name);
      return `Waiting for ${missing.join(", ") || "players"}…`;
    }
    return null;
  }

  override close(): void {
    this.transport.close();
  }
}
