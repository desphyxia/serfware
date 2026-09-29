import { dayInfo, type DayInfo } from "./clock";
import { StateHasher } from "./hash";
import { Rng } from "./rng";

export interface PlanetParams {
  /** Hours in one rotation. */
  dayLengthHours: number;
  /** Axial tilt in radians. */
  axialTilt: number;
  /** Radius in world units used by the renderer. */
  radius: number;
}

/**
 * The simulation root. Owns all game state and advances it in fixed ticks.
 * Must stay free of rendering and browser APIs.
 */
export class World {
  readonly seed: string;
  readonly planet: PlanetParams;
  tick = 0;
  private readonly rng: Rng;

  constructor(seed: string) {
    this.seed = seed;
    this.rng = new Rng(seed);
    const pr = this.rng.fork("planet");
    this.planet = {
      dayLengthHours: 24,
      axialTilt: pr.range(0.12, 0.45),
      radius: 100,
    };
  }

  step(): void {
    this.tick++;
  }

  day(): DayInfo {
    return dayInfo(this.tick, this.planet.dayLengthHours);
  }

  checksum(): number {
    return new StateHasher().str(this.seed).int(this.tick).int(this.rng.state()[0] ?? 0).value();
  }
}
