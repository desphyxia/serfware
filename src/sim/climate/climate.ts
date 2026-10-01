import { ticksPerDay } from "../clock";
import { asin, clamp, cos, exp, sin, TAU } from "../dmath";
import type { LandUse } from "../econ/landuse";
import { Rng } from "../rng";
import { moonsOf, tideAt, tideLevel, type Moon } from "../biomes/tides";
import { sunHeight } from "../biomes/sun";

/** Game days in a year: four seasons of six days. */
export const YEAR_DAYS = 24;
/** How often the weather moves, in ticks. */
export const CLIMATE_STEP = 20;

export type Season = "spring" | "summer" | "autumn" | "winter";

/** A weather system: a patch of cloud and rain drifting with the wind. */
export interface Front {
  x: number;
  y: number;
  z: number;
  /** Angular radius in radians. */
  radius: number;
  /** 0..1 rain strength at the centre. */
  strength: number;
  /** Remaining life in climate steps; fronts build up and fade. */
  life: number;
  age: number;
}

/**
 * Seasons, wind and weather. Deterministic: fronts move with a zonal wind (trade winds near the
 * equator blow west, westerlies further out blow east) and are born and fade from a seeded
 * random stream. Rain wets the ground into mud; below freezing it falls as snow and lies.
 */
export class Climate {
  readonly fronts: Front[] = [];
  /** Rain falling right now per tile (0..1). */
  readonly rain: Float32Array;
  /** Temperature right now per tile (°C). */
  readonly temp: Float32Array;
  private rng: Rng;
  private readonly dayTicks: number;
  private readonly count: number;
  /** Bumped each climate step; renderers follow it. */
  version = 0;
  /** Some lake ice broke up since the economy last looked (roads over it sink). */
  thawed = false;
  /** The planet's moons, and the tide they raise now (-1 low .. 1 high). */
  readonly moons: Moon[];
  tide = 0;
  /** Tide change per climate step (positive while flooding). */
  tideFlow = 0;
  /**
   * From the planet's atmosphere (terraforming): warming in °C, the sea's rise above its old
   * shore (elevation units), and extra rain from cloud seeding (a fraction). Zero at home.
   */
  tempOffset = 0;
  seaRise = 0;
  rainBoost = 0;

  constructor(
    private readonly land: LandUse,
    rng: Rng,
  ) {
    const planet = land.planet;
    const n = planet.grid.count;
    this.rain = new Float32Array(n);
    this.temp = new Float32Array(n);
    this.rng = rng;
    this.dayTicks = ticksPerDay(planet.params.dayLengthHours);
    this.count = 5 + Math.round(n / 1500);
    this.moons = moonsOf(planet, this.dayTicks);
    for (let i = 0; i < this.count; i++) this.fronts.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Front {
    const r = this.rng;
    // Uniform point on the sphere, favouring the moist mid-latitudes a little.
    const y = clamp((r.next() * 2 - 1) * 0.9, -0.95, 0.95);
    const a = r.next() * TAU;
    const rr = Math.sqrt(1 - y * y);
    return { x: rr * cos(a), y, z: rr * sin(a), radius: 0.18 + r.next() * 0.3, strength: 0.35 + r.next() * 0.65, life: 60 + r.int(0, 200), age: anywhere ? r.int(0, 60) : 0 };
  }

  /** 0..1 through the year. */
  yearPhase(tick: number): number {
    const f = tick / (this.dayTicks * YEAR_DAYS) + 0.1;
    return f - Math.floor(f);
  }

  /** Season at a latitude (sine of latitude: -1 south pole .. 1 north pole). */
  season(tick: number, y: number): Season {
    // A locked planet has no seasons: one long summer under the fixed sun.
    if (this.land.planet.params.locked) return "summer";
    let p = this.yearPhase(tick);
    if (y < 0) p = (p + 0.5) % 1;
    return p < 0.25 ? "spring" : p < 0.5 ? "summer" : p < 0.75 ? "autumn" : "winter";
  }

  /** Seasonal temperature swing at a latitude, °C. Summer peaks at phase 0.375 in the north. */
  seasonalOffset(tick: number, y: number): number {
    const tilt = this.land.planet.params.axialTilt;
    const swing = 32 * (tilt / 0.48) * Math.abs(y) + 3;
    const s = sin((this.yearPhase(tick) - 0.125) * TAU);
    return swing * s * (y >= 0 ? 1 : -1);
  }

  /**
   * Temperature offset at a tile: the seasons, or on a locked planet the fixed sun (hot under it,
   * frozen on the far side, mild in the twilight ring) in place of latitude and season.
   */
  offsetAt(tick: number, t: number, y: number): number {
    if (!this.land.planet.params.locked) return this.seasonalOffset(tick, y);
    return y * y * 36 + 34 * sunHeight(this.land.planet, t) - 12;
  }

  /** Zonal wind speed (radians per step) at a latitude: westward trades, eastward westerlies. */
  static wind(y: number): number {
    const lat = asin(clamp(y, -1, 1));
    return 0.006 * cos(lat * 3);
  }

  /** Advance the weather one climate step. */
  step(tick: number): void {
    const land = this.land;
    const grid = land.planet.grid;
    const c = grid.center;
    this.advanceFronts();
    // Tides: the sea rises over the Tidewater flats and falls back.
    const tide = tideAt(this.moons, tick);
    this.tideFlow = tide - this.tide;
    this.tide = tide;
    const level = tideLevel(tide);
    const elev = land.planet.terrain.elevation;
    // Rising seas (a terraformed world's melt and comets) drown the lowest shores for good.
    const risen = this.seaRise > 0 ? 0.05 + this.seaRise : -1;
    for (let t = 0; t < grid.count; t++) {
      if (!land.tidal[t] && !(risen > 0 && land.isLand(t) && (elev[t] as number) < risen)) continue;
      const wet = (elev[t] as number) < Math.max(land.tidal[t] ? level : -1, risen) ? 1 : 0;
      if (land.flooded[t] !== wet) {
        land.flooded[t] = wet;
        land.floodVersion++;
      }
    }
    // Rain, temperature, mud and snow per tile.
    const terrain = land.planet.terrain;
    for (let t = 0; t < grid.count; t++) {
      const ty = c[t * 3 + 1] as number;
      const rain = this.rainBoost > 0 ? Math.min(1, this.rainAt(t) * (1 + this.rainBoost)) : this.rainAt(t);
      this.rain[t] = rain;
      const temp = (terrain.temperature[t] as number) + this.offsetAt(tick, t, ty) - rain * 4 + this.tempOffset;
      this.temp[t] = temp;
      land.chill[t] = temp < -2 ? 1 : 0;
      if (land.hydro.lake[t]) {
        // Lakes freeze over in a hard frost and break up in the thaw.
        const was = land.frozen[t] as number;
        if (!was && temp < -3) land.frozen[t] = 1;
        else if (was && temp > 1) land.frozen[t] = 0;
        if (land.frozen[t] !== was) {
          land.iceVersion++;
          this.thawed ||= !!was;
        }
      }
      if (!land.isLand(t)) continue;
      // Mud follows rain and dries slowly; snow builds below freezing and melts above.
      const mud = land.mud[t] as number;
      land.mud[t] = temp > 0 ? Math.max(rain * 0.9, mud - 0.004) : Math.max(0, mud - 0.01);
      let snow = land.snowCover[t] as number;
      if (temp < 0 && rain > 0.05) snow += rain * 0.04;
      else if (temp < -4) snow += 0.002;
      if (temp > 1) snow -= 0.004 * (1 + temp * 0.15);
      land.snowCover[t] = clamp(snow, 0, 1);
    }
    this.version++;
  }

  /** Can fields grow here right now? */
  growing(t: number): boolean {
    return (this.temp[t] as number) > 5 && (this.land.snowCover[t] as number) < 0.2;
  }

  /**
   * What the next day brings at a tile: rain chance and the temperature range, from a copy of
   * the weather run forward (so it is exactly what will happen).
   */
  forecast(tick: number, t: number, hours = 24): { rain: number; snow: boolean; low: number; high: number } {
    const f = this.fronts.map((x) => ({ ...x }));
    const copy = new Climate(this.land, new Rng(0));
    copy.rng = Rng.fromState(this.rng.state());
    copy.fronts.length = 0;
    copy.fronts.push(...f);
    const steps = Math.round((hours / 24) * (this.dayTicks / CLIMATE_STEP));
    const grid = this.land.planet.grid;
    const c = grid.center;
    const ty = c[t * 3 + 1] as number;
    let wet = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < steps; i++) {
      copy.advanceFronts();
      const r = copy.rainAt(t);
      wet = Math.max(wet, r);
      const temp = (this.land.planet.terrain.temperature[t] as number) + this.offsetAt(tick + i * CLIMATE_STEP, t, ty) - r * 4;
      low = Math.min(low, temp);
      high = Math.max(high, temp);
    }
    return { rain: wet, snow: wet > 0.1 && low < 0, low, high };
  }

  private advanceFronts(): void {
    for (let i = 0; i < this.fronts.length; i++) {
      const f = this.fronts[i] as Front;
      f.age++;
      if (f.age > f.life) {
        this.fronts[i] = this.spawn(false);
        continue;
      }
      const w = Climate.wind(f.y);
      const cw = cos(w);
      const sw = sin(w);
      const x = f.x * cw - f.z * sw;
      const z = f.x * sw + f.z * cw;
      const y = clamp(f.y + (f.y >= 0 ? 0.0006 : -0.0006), -0.97, 0.97);
      const len = Math.sqrt(x * x + y * y + z * z);
      f.x = x / len;
      f.y = y / len;
      f.z = z / len;
    }
  }

  private rainAt(t: number): number {
    const c = this.land.planet.grid.center;
    const tx = c[t * 3] as number;
    const ty = c[t * 3 + 1] as number;
    const tz = c[t * 3 + 2] as number;
    let rain = 0;
    for (const f of this.fronts) {
      const dot = tx * f.x + ty * f.y + tz * f.z;
      const ang2 = Math.max(0, 2 - 2 * dot);
      const r2 = f.radius * f.radius;
      if (ang2 > r2 * 4) continue;
      const grow = Math.min(1, f.age / 12, (f.life - f.age) / 12);
      rain += f.strength * grow * exp(-ang2 / r2);
    }
    return clamp(rain * (0.45 + 0.8 * (this.land.planet.terrain.moisture[t] as number)), 0, 1);
  }
}
