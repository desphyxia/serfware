import { Rng } from "../rng";
import { log, pow } from "../dmath";
import type { GridSize } from "../planet/grid";
import type { Planet } from "../planet/planet";

/**
 * Star systems. Every seed has one: a star and any number of planets on their orbits, the home
 * planet (the world being played) among them. The system is drawn from its own random stream,
 * so it never changes the home planet; the home planet's entry mirrors the real world's
 * parameters.
 */

export type StarType = "M" | "K" | "G" | "F";

export interface Star {
  type: StarType;
  name: string;
  /** Luminosity relative to our Sun. */
  luminosity: number;
  /** Display colour (CSS hex). */
  color: string;
}

export type PlanetKind = "temperate" | "arid" | "frozen" | "ocean" | "molten" | "gas";

export interface SystemPlanet {
  index: number;
  name: string;
  kind: PlanetKind;
  /** Orbit radius in AU and year length in home-world days. */
  orbit: number;
  period: number;
  /** 0..1 through the orbit at day 0. */
  phase: number;
  moons: number;
  /** Surface worlds: grid size, gravity (g), day length, tilt, tidal lock, and what shapes the ground. */
  size: GridSize;
  gravity: number;
  dayLengthHours: number;
  axialTilt: number;
  locked: boolean;
  warmth: number;
  wetness: number;
  landFraction: number;
  /** The planet being played. */
  home: boolean;
  /** Has ground to stand on (gas giants do not). */
  surface: boolean;
}

export interface StarSystem {
  star: Star;
  planets: SystemPlanet[];
  /** Index of the home planet. */
  home: number;
  /** Inner and outer edge of the habitable zone, AU. */
  habitable: [number, number];
  /** Where water freezes out and gas giants begin, AU. */
  frostLine: number;
}

const STARS: Record<StarType, { luminosity: [number, number]; color: string }> = {
  M: { luminosity: [0.04, 0.12], color: "#ffb27a" },
  K: { luminosity: [0.25, 0.6], color: "#ffd9a0" },
  G: { luminosity: [0.8, 1.3], color: "#fff4d8" },
  F: { luminosity: [1.6, 3.2], color: "#eef2ff" },
};

const SYLLABLES = ["ar", "bel", "cor", "dra", "el", "fen", "gal", "hes", "ir", "jun", "kal", "lor", "mer", "nov", "or", "pel", "quo", "ras", "sel", "tam", "ul", "ves", "wyn", "zar"];

function name(r: Rng, parts: number): string {
  let s = "";
  for (let i = 0; i < parts; i++) s += r.pick(SYLLABLES);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The star system of a seed, with the home planet taken from the real world. */
export function generateSystem(seed: string, homePlanet: Planet): StarSystem {
  const r = new Rng(`${seed}:system`);
  const type = r.pick(["M", "K", "K", "G", "G", "G", "F"] as const);
  const def = STARS[type];
  const star: Star = { type, name: name(r, 2), luminosity: r.range(def.luminosity[0], def.luminosity[1]), color: def.color };
  const hz: [number, number] = [0.95 * Math.sqrt(star.luminosity), 1.4 * Math.sqrt(star.luminosity)];
  const frostLine = 2.7 * Math.sqrt(star.luminosity);
  const count = r.int(3, 9);
  // Orbits spread out geometrically; the home planet sits in the habitable zone.
  const homeAt = r.int(0, Math.min(count - 1, 3));
  const homeOrbit = (hz[0] + hz[1]) / 2;
  const ratio = r.range(1.45, 1.9);
  const planets: SystemPlanet[] = [];
  for (let i = 0; i < count; i++) {
    const orbit = homeOrbit * pow(ratio, i - homeAt) * r.range(0.93, 1.07);
    const period = 24 * pow(orbit / Math.sqrt(star.luminosity), 1.5) * r.range(0.9, 1.1);
    const phase = r.next();
    if (i === homeAt) {
      const p = homePlanet.params;
      planets.push({
        index: i,
        name: name(r, 2),
        kind: "temperate",
        orbit: homeOrbit,
        period: 24,
        phase,
        moons: r.int(1, 3),
        size: p.size,
        gravity: p.gravity,
        dayLengthHours: p.dayLengthHours,
        axialTilt: p.axialTilt,
        locked: p.locked,
        warmth: homePlanet.terrain.params.warmth,
        wetness: homePlanet.terrain.params.wetness,
        landFraction: homePlanet.terrain.params.landFraction,
        home: true,
        surface: true,
      });
      continue;
    }
    const gas = orbit > frostLine && r.next() < 0.7;
    // Warmth from the distance to the habitable zone: hot inside it, cold beyond.
    const warmth = Math.max(0, Math.min(1, 0.55 + log(homeOrbit / orbit) * 0.9));
    const wetness = r.range(0.1, 0.9) * (warmth > 0.9 ? 0.3 : 1);
    const kind: PlanetKind = gas ? "gas" : warmth > 0.92 ? "molten" : warmth > 0.72 ? "arid" : warmth < 0.25 ? "frozen" : wetness > 0.7 ? "ocean" : "temperate";
    planets.push({
      index: i,
      name: name(r, r.int(2, 3)),
      kind,
      orbit,
      period,
      phase,
      moons: gas ? r.int(4, 16) : r.int(0, 2),
      size: gas ? "large" : r.pick(["tiny", "small", "small", "medium"] as const),
      gravity: gas ? r.range(1.8, 2.6) : Math.round(r.range(0.55, 1.4) * 100) / 100,
      dayLengthHours: r.int(14, 48),
      axialTilt: r.range(0.02, 0.6),
      locked: !gas && orbit < hz[0] * 0.7 && r.next() < 0.6,
      warmth,
      wetness,
      landFraction: kind === "ocean" ? r.range(0.12, 0.25) : kind === "arid" ? r.range(0.6, 0.85) : r.range(0.3, 0.6),
      home: false,
      surface: !gas,
    });
  }
  return { star, planets, home: homeAt, habitable: hz, frostLine };
}

/** Angle of a planet on its orbit on a (fractional) home-world day, radians. */
export function orbitAngle(p: SystemPlanet, day: number): number {
  return (p.phase + day / p.period) * Math.PI * 2;
}

/**
 * The next launch window from one planet to another: when the target leads (or trails) by the
 * angle a transfer orbit needs. Returns days until it opens and the transfer's length in days.
 */
export function launchWindow(from: SystemPlanet, to: SystemPlanet, day: number): { daysUntil: number; transferDays: number; synodic: number } {
  const a1 = from.orbit;
  const a2 = to.orbit;
  // A transfer orbit's half period, scaled from the home year.
  const transferDays = 0.5 * from.period * pow((a1 + a2) / (2 * a1), 1.5);
  // The target must lead by this angle at departure so it arrives where the craft does.
  const lead = Math.PI - (transferDays / to.period) * Math.PI * 2;
  const w1 = (Math.PI * 2) / from.period;
  const w2 = (Math.PI * 2) / to.period;
  const synodic = Math.abs((Math.PI * 2) / (w1 - w2));
  const now = orbitAngle(to, day) - orbitAngle(from, day);
  const wrap = (x: number) => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  // The lead angle changes at w2 - w1; solve for the next time it matches.
  const rate = w2 - w1;
  const diff = rate < 0 ? wrap(now - lead) : wrap(lead - now);
  return { daysUntil: diff / Math.abs(rate), transferDays, synodic };
}

/** Terrain and physics for building a planet's world (see World's `planet` option). */
export function planetOverrides(p: SystemPlanet): { size: GridSize; dayLengthHours: number; axialTilt: number; gravity: number; locked: boolean; warmth: number; wetness: number; landFraction: number } {
  return { size: p.size, dayLengthHours: p.dayLengthHours, axialTilt: p.axialTilt, gravity: p.gravity, locked: p.locked, warmth: p.warmth, wetness: p.wetness, landFraction: p.landFraction };
}
