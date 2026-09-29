import { dayInfo, type DayInfo } from "./clock";
import { Economy, type Command, type CommandResult } from "./econ/economy";
import { LandUse } from "./econ/landuse";
import { StateHasher } from "./hash";
import type { GridSize } from "./planet/grid";
import { Planet } from "./planet/planet";
import { Rng } from "./rng";

export interface WorldOptions {
  /** Force a planet size (tests and benchmarks); otherwise the seed decides. */
  size?: GridSize;
}

/**
 * The simulation root. Owns all game state and advances it in fixed ticks.
 * Must stay free of rendering and browser APIs.
 */
export class World {
  readonly seed: string;
  readonly planet: Planet;
  readonly land: LandUse;
  readonly economy: Economy;
  tick = 0;
  private readonly rng: Rng;

  constructor(seed: string, opts: WorldOptions = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.planet = Planet.generate(this.rng.fork("planet"), opts.size);
    this.land = new LandUse(this.planet);
    this.land.populate(this.rng.fork("nature"));
    this.economy = new Economy(this.land);
    this.economy.setupStart(this.rng.fork("start"));
  }

  /** Apply a player command. In multiplayer these are scheduled on a tick by the lockstep layer. */
  command(cmd: Command): CommandResult {
    return this.economy.apply(cmd);
  }

  step(): void {
    this.tick++;
    this.economy.step(this.tick);
  }

  /** Time at the prime meridian. */
  day(): DayInfo {
    return dayInfo(this.tick, this.planet.params.dayLengthHours);
  }

  /** Local solar time at a longitude given as a fraction of a full turn (east positive). */
  localDay(lonFraction: number): DayInfo {
    return dayInfo(this.tick, this.planet.params.dayLengthHours, lonFraction);
  }

  checksum(): number {
    const h = new StateHasher().str(this.seed).int(this.tick);
    for (const v of this.rng.state()) h.int(v);
    this.planet.hash(h);
    this.economy.hash(h);
    return h.value();
  }
}
