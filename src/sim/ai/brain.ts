import type { CommandResult } from "../econ/economy";
import type { Rng } from "../rng";
import type { World, WorldCommand } from "../world";
import type { AiLevel, Personality } from "./personality";

/**
 * What an AI player is: something that is asked, every `period` ticks, to look at the world and
 * give orders. The scripted AI (`AiBuilder`) is one brain; a searched or learned one is another.
 * A brain acts only by issuing the same commands a human issues, through `ctx.act`, and runs
 * inside the simulation step, so every peer computes the same moves: it must be deterministic.
 */
export interface Brain {
  readonly player: number;
  readonly personality: Personality;
  readonly level: AiLevel;
  /** Ticks between decisions. */
  readonly period: number;
  think(ctx: AiContext): void;
}

/** Builds the brain for a seat. `rng` is the seat's own stream (use it, never Math.random). */
export type BrainFactory = (seat: { player: number; rng: Rng; personality: Personality; level: AiLevel }) => Brain;

/** One order a brain gave, as recorded for tournaments, learning and tests. */
export interface AiAction {
  tick: number;
  player: number;
  cmd: WorldCommand;
  ok: boolean;
}

/** What a brain sees of the game and how it acts. */
export class AiContext {
  constructor(
    readonly world: World,
    readonly player: number,
  ) {}

  get tick(): number {
    return this.world.tick;
  }

  get eco() {
    return this.world.economy;
  }

  /** Give an order as this player. */
  act(cmd: WorldCommand): CommandResult {
    return this.world.command({ ...cmd, player: this.player } as WorldCommand);
  }
}
