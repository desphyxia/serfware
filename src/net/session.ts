import type { Command, CommandResult } from "../sim/econ/economy";
import { TICK_MS } from "../sim/clock";
import { World, type WorldOptions } from "../sim/world";

/** A command as recorded in the log: applied when world.tick === tick, before that tick's step. */
export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/** Session-level commands that change how the game runs rather than the world. */
export type MetaCommand = { t: "speed"; value: number };

export type SessionMode = "solo" | "shared" | "neighbours";

export interface SessionInfo {
  mode: SessionMode;
  seed: string;
  players: { id: number; name: string }[];
}

/**
 * Drives a World: turns elapsed real time into ticks and applies player commands. The solo
 * session applies commands immediately; the lockstep session schedules them on shared turns.
 */
export abstract class Session {
  speed = 1;
  readonly log: LoggedCommand[] = [];
  protected acc = 0;
  onDesync: ((detail: string) => void) | null = null;

  constructor(
    public world: World,
    readonly info: SessionInfo,
    /** Player id used for this machine's commands (0 in solo and shared co-op). */
    readonly localPlayer: number,
  ) {}

  /** Player whose economy this machine controls. */
  get player(): number {
    return this.info.mode === "neighbours" ? this.localPlayer : 0;
  }

  abstract submit(cmd: Command): CommandResult;
  abstract setSpeed(value: number): void;

  /** Advance by elapsed real milliseconds; returns ticks stepped. */
  abstract advance(ms: number, maxSteps?: number): number;

  /** Human-readable status, e.g. "Waiting for Ada". Null when running normally. */
  status(): string | null {
    return null;
  }

  close(): void {}

  protected stepWorld(): void {
    this.world.step();
  }
}

export class SoloSession extends Session {
  constructor(world: World) {
    super(world, { mode: "solo", seed: world.seed, players: [{ id: 0, name: "You" }] }, 0);
  }

  submit(cmd: Command): CommandResult {
    const withPlayer = { ...cmd, player: this.player };
    const r = this.world.command(withPlayer);
    if (r.ok) this.log.push({ tick: this.world.tick, cmd: withPlayer });
    return r;
  }

  setSpeed(value: number): void {
    this.speed = value;
  }

  advance(ms: number, maxSteps = 200): number {
    this.acc += ms * this.speed;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < maxSteps) {
      this.stepWorld();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    return steps;
  }
}

// ---------------------------------------------------------------- saves

export interface SaveFile {
  format: "seedfall-save";
  version: 1;
  name: string;
  build: string;
  createdAt: string;
  seed: string;
  players: number;
  /** AI rivals (absent in older saves). */
  rivals?: number;
  mode: SessionMode;
  tick: number;
  checksum: number;
  commands: LoggedCommand[];
}

export function makeSave(session: Session, name: string, build: string): SaveFile {
  return {
    format: "seedfall-save",
    version: 1,
    name,
    build,
    createdAt: new Date().toISOString(),
    seed: session.world.seed,
    players: session.world.humans,
    rivals: session.world.rivals,
    mode: session.info.mode,
    tick: session.world.tick,
    checksum: session.world.checksum(),
    commands: [...session.log],
  };
}

/**
 * Rebuild a world by replaying its command log. Returns the world and whether the replayed
 * checksum matches the saved one (a mismatch means the simulation changed between builds).
 */
export function replaySave(save: SaveFile, opts: WorldOptions = {}, onProgress?: (f: number) => void): { world: World; matches: boolean; log: LoggedCommand[] } {
  if (save.format !== "seedfall-save" || save.version !== 1) throw new Error("Not a Seedfall save file.");
  const world = new World(save.seed, { ...opts, players: save.players, rivals: save.rivals ?? 0 });
  const cmds = [...save.commands].sort((a, b) => a.tick - b.tick);
  let i = 0;
  const log: LoggedCommand[] = [];
  while (world.tick < save.tick || i < cmds.length) {
    while (i < cmds.length && (cmds[i] as LoggedCommand).tick === world.tick) {
      const c = cmds[i] as LoggedCommand;
      world.command(c.cmd);
      log.push(c);
      i++;
    }
    if (world.tick >= save.tick) break;
    world.step();
    if (onProgress && world.tick % 2000 === 0) onProgress(world.tick / save.tick);
  }
  return { world, matches: world.checksum() === save.checksum, log };
}
