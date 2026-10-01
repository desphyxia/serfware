import { scenarioWorld } from "../sim/scenario/campaign";
import type { CommandResult } from "../sim/econ/economy";
import type { WorldCommand as Command } from "../sim/world";
import { TICK_MS } from "../sim/clock";
import { World, type WorldOptions } from "../sim/world";
import type { AiLevel } from "../sim/ai/personality";
import type { Difficulty } from "../sim/econ/adversity";

/** A command as recorded in the log: applied when world.tick === tick, before that tick's step. */
export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

/** Session-level commands that change how the game runs rather than the world. */
export type MetaCommand = { t: "speed"; value: number };

/**
 * How a game is played together. "shared": one settlement, everyone builds it. "neighbours":
 * a settlement each, free for all. "teams": a settlement each, in teams (allies share sight
 * and roads and win together). "relay": everyone on one team, racing nobody but the planet:
 * the team wins when any colony blooms. "race": a settlement each; the first colony to bloom wins.
 */
export type SessionMode = "solo" | "shared" | "neighbours" | "teams" | "relay" | "race";

/** The modes a lobby can start. */
export type PlayMode = Exclude<SessionMode, "solo">;

export const MODE_NAMES: Record<Exclude<SessionMode, "solo">, string> = {
  shared: "Co-op: shared keep",
  neighbours: "Neighbours (each their own)",
  teams: "Teams (up to 4 v 4)",
  relay: "Relay co-op: bloom a colony together",
  race: "Bloom race",
};

export interface SessionPlayer {
  id: number;
  name: string;
  /** Teams mode: which side (0 or 1, up to four each). */
  team?: number;
  /** Watching only: sees everything, gives no orders, the game never waits for them. */
  spectator?: boolean;
}

export interface SessionInfo {
  mode: SessionMode;
  seed: string;
  players: SessionPlayer[];
  /** Co-op through a scenario (the tutorial, a chapter of The Long Voyage…). */
  scenario?: string;
}

/** The world a multiplayer game starts from: how many settlements, the teams and the goal. */
export function worldOptionsFor(mode: SessionMode, players: readonly SessionPlayer[], scenario?: string): WorldOptions {
  const playing = players.filter((p) => !p.spectator).sort((a, b) => a.id - b.id);
  // A scenario in co-op: everyone builds the one settlement, in the scenario's world.
  if (scenario) return { ...scenarioWorld(scenario)?.opts, players: 1 };
  if (mode === "shared" || mode === "solo") return { players: 1 };
  const opts: WorldOptions = { players: playing.length };
  if (mode === "teams") opts.teams = playing.map((p, i) => p.team ?? i % 2);
  if (mode === "relay") {
    opts.teams = playing.map(() => 0);
    opts.goal = "bloom";
  }
  if (mode === "race") opts.goal = "bloom";
  return opts;
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

  /** Watching only (no orders). */
  get spectating(): boolean {
    return !!this.info.players.find((p) => p.id === this.localPlayer)?.spectator;
  }

  /** Player whose economy this machine controls (spectators look on from the first). */
  get player(): number {
    return this.info.mode === "shared" || this.info.mode === "solo" || this.spectating ? 0 : this.localPlayer;
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
  stakes?: "wounded" | "mortal";
  difficulty?: Difficulty;
  /** AI rivals' skill (absent in older saves: Normal). */
  aiLevel?: AiLevel;
  /** Teams and goal (team modes; absent otherwise). */
  teams?: number[];
  goal?: "conquest" | "bloom";
  /** The scenario played (tutorial, chapter, handmade), if any. */
  scenario?: string;
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
    stakes: session.world.economy.stakes,
    difficulty: session.world.economy.adversity.difficulty,
    aiLevel: session.world.ai[0]?.level,
    teams: session.world.economy.teams.length ? session.world.economy.teams.slice(0, session.world.players) : undefined,
    goal: session.world.economy.goal,
    scenario: session.world.scenario?.def.id,
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
  const world = new World(save.seed, { ...(save.scenario ? scenarioWorld(save.scenario)?.opts : {}), ...opts, players: save.players, rivals: save.rivals ?? 0, stakes: save.stakes ?? "wounded", difficulty: save.difficulty ?? "honest", aiLevel: save.aiLevel ?? "normal", teams: save.teams, goal: save.goal ?? "conquest" });
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

/** Build the world of a game in progress from its log, up to `tick` (rejoining, spectating late). */
export function resumeWorld(seed: string, mode: SessionMode, players: readonly SessionPlayer[], log: readonly LoggedCommand[], tick: number, extra: WorldOptions = {}, scenario?: string): World {
  const world = new World(seed, { ...extra, ...worldOptionsFor(mode, players, scenario) });
  let i = 0;
  const cmds = [...log].sort((a, b) => a.tick - b.tick);
  while (world.tick < tick) {
    while (i < cmds.length && (cmds[i] as LoggedCommand).tick === world.tick) world.command((cmds[i++] as LoggedCommand).cmd);
    world.step();
  }
  while (i < cmds.length && (cmds[i] as LoggedCommand).tick === world.tick) world.command((cmds[i++] as LoggedCommand).cmd);
  return world;
}
