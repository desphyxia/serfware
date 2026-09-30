import { mix32 } from "../rng";
import { sin, TAU } from "../dmath";
import type { Planet } from "../planet/planet";

/** A moon, as far as the tides care: how often it pulls the sea round, and how hard. */
export interface Moon {
  /** Ticks between high tides it raises. */
  period: number;
  /** 0..1 offset through its cycle at tick 0. */
  phase: number;
  /** Relative pull (the largest moon is 1). */
  pull: number;
  /** Relative size in the sky, for the renderer. */
  size: number;
}

/** Height of the sea above its mean at high tide, in world units (land elevation is in the same units). */
export const TIDE_RANGE = 0.1;
/** Mean sea level for the tidal flats; flats are Tidewater land below the highest tide. */
export const TIDE_MEAN = 0.14;

/**
 * The planet's moons, derived from its own parameters (not the world's random stream, so adding
 * tides changes nothing else). One to three moons; the first is the largest.
 */
export function moonsOf(planet: Planet, dayTicks: number): Moon[] {
  const p = planet.params;
  const h0 = mix32(planet.grid.count, Math.round(p.dayLengthHours * 1000) ^ Math.round(p.axialTilt * 1e6));
  const n = 1 + (h0 % 3);
  const out: Moon[] = [];
  for (let i = 0; i < n; i++) {
    const h = mix32(h0, i + 1);
    const f = (h & 0xffff) / 0x10000;
    const g = ((h >>> 16) & 0xffff) / 0x10000;
    // Roughly two tides a day, each moon a little out of step with the others.
    out.push({ period: Math.round(dayTicks * (0.5 + i * 0.07 + f * 0.05)), phase: g, pull: i === 0 ? 1 : 0.25 + f * 0.4, size: i === 0 ? 1 : 0.35 + g * 0.4 });
  }
  return out;
}

/** The tide at a tick, -1 (lowest) .. 1 (highest). */
export function tideAt(moons: readonly Moon[], tick: number): number {
  let s = 0;
  let w = 0;
  for (const m of moons) {
    const f = tick / m.period + m.phase;
    s += m.pull * sin((f - Math.floor(f)) * TAU);
    w += m.pull;
  }
  return w > 0 ? s / w : 0;
}

/** Sea level over the flats at a tide value. */
export function tideLevel(tide: number): number {
  return TIDE_MEAN + TIDE_RANGE * tide;
}
