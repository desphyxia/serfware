import { dayInfo, START_FRACTION, ticksPerDay, type DayInfo } from "./clock";
import { atan2, TAU } from "./dmath";
import { Economy, type Command, type CommandResult } from "./econ/economy";
import { LandUse } from "./econ/landuse";
import { COMBAT } from "./econ/defs";
import { AiBuilder } from "./ai/builder";
import { Climate, CLIMATE_STEP } from "./climate/climate";
import { StateHasher } from "./hash";
import type { GridSize } from "./planet/grid";
import { Planet, type PlanetOverrides } from "./planet/planet";
import { Rng } from "./rng";

export interface WorldOptions {
  /** Force a planet size (tests and benchmarks); otherwise the seed decides. */
  size?: GridSize;
  /** Number of players with their own keep (neighbours co-op / PvP). Shared co-op uses 1. */
  players?: number;
  /** AI rivals, added after the human players. */
  rivals?: number;
  /** What losing a duel costs: a wound (default) or a life. */
  stakes?: "wounded" | "mortal";
  /** Game days before anyone may attack. */
  peaceDays?: number;
  /** Another planet of the star system: its physics and climate (see sim/system). */
  planet?: PlanetOverrides;
  /** A survey world: the planet only, nobody settled on it yet. */
  survey?: boolean;
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
  readonly climate: Climate;
  readonly players: number;
  /** Players 0..humans-1 are people; the rest are AI rivals. */
  readonly humans: number;
  readonly rivals: number;
  readonly ai: AiBuilder[] = [];
  tick = 0;
  private readonly rng: Rng;

  constructor(seed: string, opts: WorldOptions = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.planet = Planet.generate(this.rng.fork("planet"), opts.size, opts.planet);
    this.land = new LandUse(this.planet);
    this.land.populate(this.rng.fork("nature"));
    this.economy = new Economy(this.land);
    this.climate = new Climate(this.land, this.rng.fork("climate"));
    this.economy.climate = this.climate;
    this.humans = Math.max(1, Math.min(8, opts.players ?? 1));
    this.rivals = opts.survey ? 0 : Math.max(0, Math.min(8 - this.humans, opts.rivals ?? 0));
    this.players = this.humans + this.rivals;
    if (!opts.survey) for (let p = 0; p < this.players; p++) this.economy.setupStart(this.rng.fork(`start-${p}`), p);
    for (let p = this.humans; p < this.players; p++) this.ai.push(new AiBuilder(p, this.rng.fork(`ai-${p}`)));
    // Start the clock so it is early morning at the first Hearthship.
    const keep = this.economy.buildings[this.economy.keeps[0] ?? -1];
    if (keep) {
      const c = this.planet.grid.centerOf(keep.tile);
      const lonFrac = atan2(-c[2], c[0]) / TAU;
      const perDay = ticksPerDay(this.planet.params.dayLengthHours);
      let f = 7.25 / 24 - START_FRACTION - lonFrac;
      f -= Math.floor(f);
      this.tick = Math.round((f * perDay) / 10) * 10;
    }
    this.climate.step(this.tick);
    this.economy.stakes = opts.stakes ?? "wounded";
    this.economy.peaceUntil = this.tick + Math.round((opts.peaceDays ?? COMBAT.peaceDays) * ticksPerDay(this.planet.params.dayLengthHours));
  }

  /** Apply a player command. In multiplayer these are scheduled on a tick by the lockstep layer. */
  command(cmd: Command): CommandResult {
    return this.economy.apply(cmd);
  }

  step(): void {
    this.tick++;
    if (this.tick % CLIMATE_STEP === 0) this.climate.step(this.tick);
    this.economy.step(this.tick);
    for (const ai of this.ai) if ((this.tick + ai.player * 37) % AiBuilder.PERIOD === 0 && !this.economy.defeated[ai.player] && this.economy.winner < 0) ai.think(this);
  }

  /** Time at the prime meridian. */
  day(): DayInfo {
    return dayInfo(this.tick, this.planet.params.dayLengthHours);
  }

  /** Local solar time at a longitude given as a fraction of a full turn (east positive). */
  localDay(lonFraction: number): DayInfo {
    const d = dayInfo(this.tick, this.planet.params.dayLengthHours, lonFraction);
    if (!this.planet.params.locked) return d;
    // The sun never moves: local time is fixed by longitude, noon under the sun.
    let f = 0.5 - lonFraction;
    f -= Math.floor(f);
    const hours = f * 24;
    return { day: d.day, hour: Math.floor(hours), minute: Math.floor((hours % 1) * 60), fraction: f };
  }

  checksum(): number {
    const h = new StateHasher().str(this.seed).int(this.tick);
    for (const v of this.rng.state()) h.int(v);
    this.planet.hash(h);
    this.economy.hash(h);
    let snow = 0;
    for (let t = 0; t < this.land.snowCover.length; t += 7) snow += this.land.snowCover[t] as number;
    h.int(Math.round(snow * 1000)).int(this.climate.version);
    return h.value();
  }
}
