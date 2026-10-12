import type { Economy } from "../../src/sim/econ/economy";
import type { World } from "../../src/sim/world";

/**
 * Instrumentation for the star system in a balance game: voyages and colonies (colonisation) and the air, water and life of
 * each colony world (terraforming). It only reads (nothing here changes a game), and is sampled once a day with `day()`.
 *
 * Seats: index 0 is player 0 (the steward seat), then the rivals in order, as `World.players` counts them. This differs from
 * `ProbeData`, whose rival arrays leave the steward out.
 */

/** Per colony per game day, in this order (see ColonyData.days). */
export const COLONY_FIELDS = ["pressure", "oxygen", "water", "warming", "cover", "years", "bloom", "ice"] as const;
/** Per seat per colony per game day, in this order (see ColonyData.seatDays). */
export const COLONY_SEAT_FIELDS = ["people", "built", "lit", "territory", "terraWorks", "rooted"] as const;

export interface ColonyData {
  planet: number;
  name: string;
  size: string;
  gravity: number;
  /** Game day on which the first Hearthship landed (the colony existed from then), or -1 if sampled before. */
  foundedDay: number;
  /** Game day on which the planet bloomed, or -1. */
  bloomDay: number;
  /** One row per game day since founding, fields as COLONY_FIELDS. */
  days: number[][];
  /** One row per game day since founding: for each seat, the fields as COLONY_SEAT_FIELDS. */
  seatDays: number[][][];
  /** Finished terraforming works at the end of the game, per seat: terra kind -> count. */
  terraWorks: Record<string, number>[];
}

export interface SystemData {
  /** Players in the system (the steward seat and the rivals). */
  players: number;
  /** Planets with ground, and how many of them are not the home world. */
  worlds: number;
  /** Each time a voyage was first seen in a state: [game day, kind, owner, from, to, state, settlers aboard]. */
  voyageLog: (number | string)[][];
  /** Voyages at the end: [kind, owner, to, state, departs day or -1, arrives day or -1, founders]. */
  voyages: (number | string)[][];
  /** Per player, a bitmask of the planets a probe of theirs has reached. */
  surveyed: number[];
  colonyFields: string[];
  colonySeatFields: string[];
  colonies: ColonyData[];
}

export class SystemProbe {
  readonly data: SystemData;
  private readonly seen = new Map<number, string>();
  private readonly byPlanet = new Map<number, ColonyData>();

  constructor(private readonly w: World) {
    this.data = {
      players: w.players,
      worlds: w.system.planets.filter((p) => p.surface).length,
      voyageLog: [],
      voyages: [],
      surveyed: [],
      colonyFields: [...COLONY_FIELDS],
      colonySeatFields: [...COLONY_SEAT_FIELDS],
      colonies: [],
    };
  }

  /** Sample at the end of game day `day` (0 is the first). */
  day(day: number): void {
    const w = this.w;
    const d = this.data;
    const voyages = w.voyages;
    if (voyages) {
      const tick = w.tick;
      const sd = (t: number): number => (t < 0 ? -1 : Math.round((t / w.economy.dayTicks) * 10) / 10);
      for (const v of voyages.list) {
        const key = `${v.state}:${v.founders.length}`;
        if (this.seen.get(v.id) === key) continue;
        this.seen.set(v.id, key);
        d.voyageLog.push([day, v.kind, v.owner, v.from, v.to, v.state, v.founders.length || v.settlers]);
      }
      d.surveyed = [...voyages.surveyed];
      d.voyages = voyages.list.map((v) => [v.kind, v.owner, v.to, v.state, sd(v.departs), sd(v.arrives), v.founders.length]);
      void tick;
    }
    w.colonies.forEach((c, planet) => {
      if (!c) return;
      let colony = this.byPlanet.get(planet);
      if (!colony) {
        const p = w.system.planets[planet];
        colony = { planet, name: p?.name ?? String(planet), size: p?.size ?? "", gravity: p?.gravity ?? 1, foundedDay: day, bloomDay: -1, days: [], seatDays: [], terraWorks: [] };
        this.byPlanet.set(planet, colony);
        d.colonies.push(colony);
      }
      const a = c.atmosphere;
      if (a.bloom && colony.bloomDay < 0) colony.bloomDay = day;
      colony.days.push([a.pressure, a.oxygen, a.water, a.warming, a.cover, a.years, a.bloom ? 1 : 0, a.ice].map((x) => Math.round(x * 1000) / 1000));
      colony.seatDays.push(this.seats(c.economy, w.players));
      colony.terraWorks = this.works(c.economy, w.players);
    });
  }

  private seats(eco: Economy, players: number): number[][] {
    const out: number[][] = [];
    const land = eco.land;
    for (let p = 0; p < players; p++) {
      let built = 0;
      let lit = 0;
      let works = 0;
      for (const b of eco.buildings) {
        if (!b.alive || !b.built || b.owner !== p) continue;
        built++;
        if (b.lit) lit++;
        if (b.def.terra) works++;
      }
      let people = 0;
      for (const x of eco.people) if (x.alive && x.owner === p) people++;
      let territory = 0;
      for (let t = 0; t < land.territory.length; t++) if (land.territory[t] === p + 1 && land.isLand(t)) territory++;
      out.push([people, built, lit, territory, works, eco.rooted[p] ? 1 : 0]);
    }
    return out;
  }

  private works(eco: Economy, players: number): Record<string, number>[] {
    const out: Record<string, number>[] = Array.from({ length: players }, () => ({}));
    for (const b of eco.buildings) {
      if (!b.alive || !b.built || !b.def.terra) continue;
      const m = out[b.owner];
      if (m) m[b.def.terra] = (m[b.def.terra] ?? 0) + 1;
    }
    return out;
  }
}
