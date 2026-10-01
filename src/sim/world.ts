import { dayInfo, START_FRACTION, ticksPerDay, type DayInfo } from "./clock";
import { atan2, TAU } from "./dmath";
import { Economy, type Command, type CommandResult } from "./econ/economy";
import { Feature, LandUse } from "./econ/landuse";
import { COMBAT } from "./econ/defs";
import { AiBuilder } from "./ai/builder";
import { Climate, CLIMATE_STEP } from "./climate/climate";
import { StateHasher } from "./hash";
import type { GridSize } from "./planet/grid";
import { Planet, type PlanetOverrides } from "./planet/planet";
import { Rng } from "./rng";
import { generateSystem, HOME_AIR, worldFor, type StarSystem } from "./system/system";
import { Atmosphere, type AirStart } from "./climate/atmosphere";
import type { Difficulty } from "./econ/adversity";
import { VOYAGE_COMMANDS, Voyages, type VoyageCommand, type WorldHost } from "./system/voyages";

export interface WorldOptions {
  /** Force a planet size (tests and benchmarks); otherwise the seed decides. */
  size?: GridSize;
  /** Number of players with their own keep (neighbours co-op / PvP). Shared co-op uses 1. */
  players?: number;
  /** AI rivals, added after the human players. */
  rivals?: number;
  /** What losing a duel costs: a wound (default) or a life. */
  stakes?: "wounded" | "mortal";
  /** How hard adversity bites: floods, blight, cold snaps, meteors, pests, fire (default Honest). */
  difficulty?: Difficulty;
  /** Game days before anyone may attack. */
  peaceDays?: number;
  /** Another planet of the star system: its physics and climate (see sim/system). */
  planet?: PlanetOverrides;
  /** A survey world: the planet only, nobody settled on it yet. */
  survey?: boolean;
  /** A colony world: settled by Hearthship voyages from home (implies no starts, no rivals). */
  colony?: boolean;
  /** Start the clock here (colonies keep time with home). */
  startTick?: number;
  /** Another planet's bare ground (no life yet), its air, and whether it had native life. */
  barren?: boolean;
  native?: boolean;
  air?: AirStart;
}

/** Any command: to a world's economy (optionally on another planet of the system), or a voyage. */
export type WorldCommand = (Command & { planet?: number }) | VoyageCommand;

/** The seed of another planet's world in a home seed's system (survey and colony alike). */
export function planetSeed(homeSeed: string, name: string): string {
  return `${homeSeed}~${name.toLowerCase()}`;
}

/**
 * The simulation root. Owns all game state and advances it in fixed ticks.
 * Must stay free of rendering and browser APIs.
 */
export class World implements WorldHost {
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
  /** The star system (home worlds only; survey and colony worlds belong to one). */
  readonly system: StarSystem;
  /** Voyages between planets and the colony worlds they have founded, by planet index. */
  readonly voyages: Voyages | null = null;
  readonly colonies: (World | undefined)[] = [];
  /** The planet's air, water and life (what terraforming works on). */
  readonly atmosphere: Atmosphere;
  tick = 0;
  private readonly rng: Rng;

  constructor(seed: string, opts: WorldOptions = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.planet = Planet.generate(this.rng.fork("planet"), opts.size, opts.planet);
    this.land = new LandUse(this.planet);
    this.land.populate(this.rng.fork("nature"));
    if (opts.barren) World.makeBarren(this.land, opts.native ? new Rng(`${seed}:native`) : null);
    this.economy = new Economy(this.land);
    this.climate = new Climate(this.land, this.rng.fork("climate"));
    this.economy.climate = this.climate;
    this.humans = Math.max(1, Math.min(8, opts.players ?? 1));
    const bare = opts.survey || opts.colony;
    this.rivals = bare ? 0 : Math.max(0, Math.min(8 - this.humans, opts.rivals ?? 0));
    this.players = this.humans + this.rivals;
    if (!bare) for (let p = 0; p < this.players; p++) this.economy.setupStart(this.rng.fork(`start-${p}`), p);
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
    if (opts.startTick !== undefined) this.tick = opts.startTick;
    this.economy.colony = !!opts.colony;
    this.climate.step(this.tick);
    // The system is drawn from its own stream: it never changes the home world.
    this.system = generateSystem(seed, this.planet);
    if (!bare) this.voyages = new Voyages(this);
    this.atmosphere = new Atmosphere(this.economy, this.climate, opts.air ?? HOME_AIR, { native: !!opts.native, bloomed: !opts.barren });
    this.atmosphere.apply();
    this.economy.onTerraform = (b) => b.def.terra && this.atmosphere.work(b.def.terra, b.tile);
    this.economy.stakes = opts.stakes ?? "wounded";
    this.economy.adversity.difficulty = opts.difficulty ?? "honest";
    this.economy.peaceUntil = this.tick + Math.round((opts.peaceDays ?? COMBAT.peaceDays) * ticksPerDay(this.planet.params.dayLengthHours));
  }

  /**
   * Another planet as first found: bare rock and dust, no trees or scrub (life comes with
   * terraforming), and on some worlds mats of native life in patches.
   */
  private static makeBarren(land: LandUse, native: Rng | null): void {
    const grid = land.planet.grid;
    for (let t = 0; t < grid.count; t++) {
      if (!land.isLand(t)) continue;
      land.life[t] = 0;
      const f = land.feature[t] as Feature;
      if (f === Feature.Tree || f === Feature.Shrub || f === Feature.Hedge || f === Feature.Giant || f === Feature.Glowcap) {
        land.feature[t] = Feature.None;
        land.amount[t] = 0;
      }
    }
    land.featureVersion++;
    if (!native) return;
    const land_ = Array.from({ length: grid.count }, (_, t) => t).filter((t) => land.isLand(t));
    for (let k = 0; k < 6 + Math.round(grid.count / 1500) && land_.length; k++) {
      const c = native.pick(land_);
      for (const t of [c, ...land.ring(c, 3)]) if (land.isLand(t) && native.next() < 0.7) land.native[t] = 1;
    }
    land.lifeVersion++;
  }

  /** Apply a player command. In multiplayer these are scheduled on a tick by the lockstep layer. */
  command(cmd: WorldCommand): CommandResult {
    if (VOYAGE_COMMANDS.has(cmd.t)) return this.voyages ? this.voyages.apply(cmd as VoyageCommand) : { ok: false, reason: "No voyages from here." };
    const c = cmd as Command & { planet?: number };
    if (c.planet === undefined || c.planet === this.system.home) return this.economy.apply(c);
    const colony = this.colonies[c.planet];
    if (!colony) return { ok: false, reason: "Nobody has settled that planet." };
    const { planet: _, ...rest } = c;
    return colony.economy.apply(rest);
  }

  /** Check a command without applying it (multiplayer's instant feedback). Voyages check on arrival. */
  check(cmd: WorldCommand): string | null {
    if (VOYAGE_COMMANDS.has(cmd.t)) return this.voyages ? null : "No voyages from here.";
    const { planet, ...rest } = cmd as Command & { planet?: number };
    const eco = planet === undefined ? this.economy : this.economyAt(planet);
    return eco ? eco.check(rest) : "Nobody has settled that planet.";
  }

  /** The economy on a planet of this world's system: home, a colony, or none. */
  economyAt(planet: number): Economy | null {
    if (planet === this.system.home) return this.economy;
    return this.colonies[planet]?.economy ?? null;
  }

  /** The world on a planet of the system, if anyone lives there. */
  worldAt(planet: number): World | null {
    return planet === this.system.home ? this : (this.colonies[planet] ?? null);
  }

  /** Found the colony world on a planet (the first Hearthship to land there). */
  colonize(planet: number): Economy {
    const existing = this.colonies[planet];
    if (existing) return existing.economy;
    const p = this.system.planets[planet];
    if (!p) throw new Error(`No planet ${planet}`);
    const w = new World(planetSeed(this.seed, p.name), { ...worldFor(p), colony: true, players: this.humans, startTick: this.tick });
    this.colonies[planet] = w;
    return w.economy;
  }

  step(): void {
    this.tick++;
    if (this.tick % CLIMATE_STEP === 0) this.climate.step(this.tick);
    this.economy.step(this.tick);
    for (const ai of this.ai) if ((this.tick + ai.player * 37) % AiBuilder.PERIOD === 0 && !this.economy.defeated[ai.player] && this.economy.winner < 0) ai.think(this);
    // A rooted colony's planet changes by decades a day (see Atmosphere).
    if (this.economy.colony && this.tick % this.economy.dayTicks === 7 && this.economy.rooted.some(Boolean)) {
      this.atmosphere.day(Math.floor(this.tick / this.economy.dayTicks));
      this.atmosphere.checkBloom();
    }
    if (this.voyages) {
      this.voyages.step(this.tick);
      for (const c of this.colonies) if (c) c.step();
    }
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
    if (this.economy.colony) this.atmosphere.hash(h);
    if (this.voyages) {
      this.voyages.hash(h);
      for (const c of this.colonies) if (c) h.int(c.checksum());
    }
    return h.value();
  }
}
