import type { TerraKind } from "../econ/defs";
import type { Economy } from "../econ/economy";
import { Feature, Use } from "../econ/landuse";
import type { StateHasher } from "../hash";
import { mix32 } from "../rng";
import type { Climate } from "./climate";

/**
 * A planet's air and water, and the life on its ground: what terraforming works on.
 *
 * Pressure is in bars, oxygen a fraction of the air, water a rough measure of the seas and
 * clouds (1 is Earth-like), warming the °C the works have added. Each day on a rooted colony
 * counts as decades of planetary change: the works' effects add up, the air leaks and cools
 * unless kept up, life spreads by succession (lichen, moss, grass, woodland) where the air and
 * warmth allow, and the planet may Bloom.
 */

/** Planetary years that pass per game day once a colony has taken root. */
export const YEARS_PER_DAY = 25;

export interface AirStart {
  pressure: number;
  oxygen: number;
  water: number;
  /** Frozen water that warming melts into seas. */
  ice: number;
}

/** Life stages. */
export const LIFE = { barren: 0, lichen: 1, moss: 2, grass: 3, woodland: 4 } as const;
export const LIFE_NAMES = ["barren", "lichen", "moss", "grass", "woodland"] as const;

/** What each work cycle does, before the planet's size divides it. */
const WORK = {
  mirror: { warming: 0.6 },
  greenhouse: { warming: 0.35, pressure: 0.02 },
  comet: { water: 0.05, pressure: 0.03 },
  seeding: { seeding: 0.12 },
  basin: { retention: 0.03 },
} as const;

/** Bloom: the air, warmth, water and life a world needs to count as a living world. */
export const BLOOM = { pressure: [0.6, 2.2], oxygen: 0.16, temp: [4, 28], water: 0.4, cover: 0.4 } as const;

export interface BloomCheck {
  pressure: boolean;
  oxygen: boolean;
  temp: boolean;
  water: boolean;
  life: boolean;
  native: boolean;
}

export class Atmosphere {
  pressure: number;
  oxygen: number;
  water: number;
  ice: number;
  warming = 0;
  /** Lake basins: how much of the water stays rather than seeping and blowing away, 0..0.9. */
  retention = 0;
  /** Cloud seeding: extra rain, fading unless kept up. */
  seeding = 0;
  /** Mean land temperature before any warming, °C. */
  readonly baseTemp: number;
  readonly water0: number;
  /** The planet had life of its own; banked once a gene bank has kept its species. */
  readonly native: boolean;
  banked = false;
  bankWork = 0;
  /** Planetary years of change so far, and when the world bloomed (-1 not yet). */
  years = 0;
  bloom = false;
  /** Share of land at grass or woodland. */
  cover = 0;
  private readonly pending: Record<TerraKind, number> = { mirror: 0, greenhouse: 0, comet: 0, seeding: 0, basin: 0, life: 0, bank: 0 };
  /** Where seed houses and gene banks worked since the last day. */
  private readonly lifeAt: number[] = [];
  private readonly bankAt: number[] = [];
  /** Divides the works' effects: bigger worlds have more air to change. */
  private readonly mass: number;
  version = 0;

  constructor(
    private readonly eco: Economy,
    private readonly climate: Climate,
    start: AirStart,
    opts: { native: boolean; bloomed: boolean },
  ) {
    this.pressure = start.pressure;
    this.oxygen = start.oxygen;
    this.water = this.water0 = start.water;
    this.ice = start.ice;
    this.native = opts.native;
    this.bloom = opts.bloomed;
    const land = eco.land;
    const terrain = land.planet.terrain;
    let sum = 0;
    let n = 0;
    for (let t = 0; t < terrain.temperature.length; t++) {
      if (!land.isLand(t)) continue;
      sum += terrain.temperature[t] as number;
      n++;
    }
    this.baseTemp = n ? sum / n : 0;
    this.mass = ({ tiny: 0.6, small: 0.8, medium: 1, large: 1.3, huge: 1.6 } as Record<string, number>)[land.planet.params.size] ?? 1;
    this.cover = this.coverNow();
  }

  meanTemp(): number {
    return this.baseTemp + this.warming;
  }

  /** A terraforming work finished a cycle at building tile `tile`. */
  work(kind: TerraKind, tile: number): void {
    this.pending[kind]++;
    if (kind === "life") this.lifeAt.push(tile);
    if (kind === "bank") this.bankAt.push(tile);
  }

  /** Is this tile inside a reserve (native life there is left alone)? */
  protectedAt(t: number): boolean {
    const land = this.eco.land;
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built || !b.def.reserve) continue;
      if (b.tile === t || land.ring(b.tile, b.def.reserve).includes(t)) return true;
    }
    return false;
  }

  /** The highest life stage the air and warmth allow on a tile. */
  lifeCap(t: number): number {
    const temp = this.climate.temp[t] as number;
    const p = this.pressure;
    if (p < 0.05 || temp < -30) return LIFE.barren;
    if (p < 0.3 || temp < -10 || this.water < 0.2) return LIFE.lichen;
    if (p < 0.5 || temp < 0 || this.water < 0.3 || this.oxygen < 0.03) return LIFE.moss;
    if (p < 0.6 || temp < 4 || this.water < 0.4 || this.oxygen < 0.1) return LIFE.grass;
    return LIFE.woodland;
  }

  private coverNow(): number {
    const land = this.eco.land;
    let alive = 0;
    let n = 0;
    for (let t = 0; t < land.life.length; t++) {
      if (!land.isLand(t)) continue;
      n++;
      if ((land.life[t] as number) >= LIFE.grass) alive++;
    }
    return n ? alive / n : 0;
  }

  /** One planetary day (on a rooted colony: decades of change). */
  day(day: number): void {
    const s = 1 / this.mass;
    const p = this.pending;
    this.warming += (p.mirror * WORK.mirror.warming + p.greenhouse * WORK.greenhouse.warming) * s;
    this.pressure += (p.greenhouse * WORK.greenhouse.pressure + p.comet * WORK.comet.pressure) * s;
    this.water += p.comet * WORK.comet.water * s;
    this.seeding = Math.min(1, this.seeding + p.seeding * WORK.seeding.seeding * s);
    this.retention = Math.min(0.9, this.retention + p.basin * WORK.basin.retention * s);
    // The works must be kept up: warming radiates away, seeded clouds rain out, air and water leak.
    this.warming *= 0.97;
    this.seeding *= 0.9;
    const melt = Math.min(this.ice, Math.max(0, this.meanTemp()) * 0.004);
    this.ice -= melt;
    this.water += melt;
    this.water = Math.max(0, this.water - 0.004 * (1 - this.retention) * (this.pressure < 0.4 ? 1 : 0.3));
    // Life breathes: plants make oxygen and thicken the air a little.
    this.cover = this.coverNow();
    this.oxygen = Math.min(0.3, this.oxygen + (0.006 * this.cover + 0.0015 * this.mossShare()) * s);
    this.pressure = Math.min(3, this.pressure + 0.001 * this.cover * s);
    this.seedLife(day);
    this.succession(day);
    this.nativeLife(day);
    this.bank();
    for (const k of Object.keys(p) as TerraKind[]) p[k] = 0;
    this.years += YEARS_PER_DAY;
    this.apply();
    this.version++;
  }

  private mossShare(): number {
    const land = this.eco.land;
    let m = 0;
    let n = 0;
    for (let t = 0; t < land.life.length; t += 3) {
      if (!land.isLand(t)) continue;
      n++;
      if ((land.life[t] as number) >= LIFE.lichen) m++;
    }
    return n ? m / n : 0;
  }

  /** The climate follows the air: warmer, wetter, higher seas. */
  apply(): void {
    this.climate.tempOffset = this.warming;
    this.climate.rainBoost = this.seeding;
    this.climate.seaRise = Math.min(0.12, Math.max(0, this.water - this.water0) * 0.25);
  }

  /** Seed houses: raise the ground around them a stage, as far as the air allows. */
  private seedLife(day: number): void {
    const land = this.eco.land;
    for (const at of this.lifeAt) {
      let done = 0;
      const ring = land.ring(at, 5);
      for (let k = 0; k < ring.length && done < 4; k++) {
        const t = ring[(k + mix32(at, day)) % ring.length] as number;
        if (!land.isLand(t) || (land.life[t] as number) >= this.lifeCap(t)) continue;
        this.raise(t);
        done++;
      }
    }
    this.lifeAt.length = 0;
  }

  /** Life spreads by itself from where it has taken hold, a stage a day at most. */
  private succession(day: number): void {
    const land = this.eco.land;
    const grid = land.planet.grid;
    const next: number[] = [];
    for (let t = 0; t < land.life.length; t++) {
      if (!land.isLand(t)) continue;
      const here = land.life[t] as number;
      if (here >= this.lifeCap(t)) continue;
      let best = 0;
      for (const n of grid.neighborsOf(t)) best = Math.max(best, land.life[n] as number);
      if (best <= here) continue;
      // Wetter ground (seeded clouds) takes faster.
      const chance = 10 + Math.round(20 * this.seeding) + Math.round(10 * Math.min(1, this.water));
      if (mix32(t, day * 7919) % 100 < chance) next.push(t);
    }
    for (const t of next) this.raise(t);
  }

  private raise(t: number): void {
    const land = this.eco.land;
    land.life[t] = (land.life[t] as number) + 1;
    land.lifeVersion++;
    // Woodland: now and then a wild sapling takes on open ground.
    if (land.life[t] === LIFE.woodland && land.feature[t] === Feature.None && land.use[t] === Use.Free && mix32(t, 31) % 4 === 0) this.eco.sprout(t);
  }

  /** Native life fades where the new air and warmth are too much for it, except in reserves. */
  private nativeLife(day: number): void {
    if (!this.native) return;
    const land = this.eco.land;
    const harsh = this.warming > 10 || this.oxygen > 0.1;
    const reserved = new Set<number>();
    for (const b of this.eco.buildings) if (b.alive && b.built && b.def.reserve) for (const t of [b.tile, ...land.ring(b.tile, b.def.reserve)]) reserved.add(t);
    for (let t = 0; t < land.native.length; t++) {
      if (!land.native[t]) continue;
      const crowded = (land.life[t] as number) >= LIFE.grass;
      if (!(harsh || crowded) || mix32(t, day) % 5 !== 0 || reserved.has(t)) continue;
      land.native[t] = 0;
      land.lifeVersion++;
    }
  }

  /** Gene banks near native life keep its species; after six cycles they are safe. */
  private bank(): void {
    const land = this.eco.land;
    for (const at of this.bankAt) {
      if (this.banked) break;
      if (![at, ...land.ring(at, 6)].some((t) => land.native[t])) continue;
      if (++this.bankWork >= 6) {
        this.banked = true;
        this.notifyAll("The gene bank has kept every native species: whatever becomes of the old life, it will not be lost.");
      }
    }
    this.bankAt.length = 0;
  }

  nativeTiles(): number {
    let n = 0;
    for (const v of this.eco.land.native) n += v;
    return n;
  }

  check(): BloomCheck {
    const temp = this.meanTemp();
    return {
      pressure: this.pressure >= BLOOM.pressure[0] && this.pressure <= BLOOM.pressure[1],
      oxygen: this.oxygen >= BLOOM.oxygen,
      temp: temp >= BLOOM.temp[0] && temp <= BLOOM.temp[1],
      water: this.water >= BLOOM.water,
      life: this.cover >= BLOOM.cover,
      // Native life must be kept: in a reserve, or banked.
      native: !this.native || this.banked || this.nativeTiles() >= 10,
    };
  }

  /** Has the world just bloomed? (Checked daily.) */
  checkBloom(): boolean {
    if (this.bloom) return false;
    const c = this.check();
    if (!Object.values(c).every(Boolean)) return false;
    this.bloom = true;
    this.notifyAll("The world has bloomed! Breathable air, rain and green ground: this planet is alive, and it is yours to live on.");
    return true;
  }

  private notifyAll(text: string): void {
    for (let p = 0; p < this.eco.keeps.length; p++) if (this.eco.keeps[p] !== undefined) this.eco.notices.push({ owner: p, text });
  }

  hash(h: StateHasher): void {
    for (const v of [this.pressure, this.oxygen, this.water, this.warming, this.retention, this.seeding, this.ice]) h.int(Math.round(v * 1e6));
    h.int(this.bloom ? 1 : 0).int(this.banked ? 1 : 0).int(this.lifeAt.length);
    let life = 0;
    for (let t = 0; t < this.eco.land.life.length; t += 5) life = (life * 31 + (this.eco.land.life[t] as number) + (this.eco.land.native[t] as number) * 7) | 0;
    h.int(life);
  }
}
