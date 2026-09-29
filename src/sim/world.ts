import { dayInfo, type DayInfo } from "./clock";
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
  tick = 0;
  private readonly rng: Rng;

  constructor(seed: string, opts: WorldOptions = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.planet = Planet.generate(this.rng.fork("planet"), opts.size);
  }

  step(): void {
    this.tick++;
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
    return h.value();
  }
}
