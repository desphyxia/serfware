import type { StateHasher } from "../hash";
import { mix32 } from "../rng";
import { goodsFor } from "./defs";
import type { Economy } from "./economy";
import { Feature, Use } from "./landuse";

/**
 * Adversity: floods, blight, cold snaps, meteor showers and pests (wildfire, eruptions and
 * sandstorms come from their own systems). Each is foretold before it strikes, and most leave
 * something behind: silt on flooded ground, hardier seed after a blight, iron and gold in the
 * meteorites, frost that clears the vermin. How hard they bite is the difficulty setting.
 *
 * Draws come from hashes of the tick, never from the world's random streams, so a world without
 * adversity (or before it starts) unfolds exactly as before.
 */

export type Difficulty = "gentle" | "honest" | "hard";
export type AdversityKind = "flood" | "blight" | "coldsnap" | "meteors" | "pests";

/** What the difficulty changes: how often trouble comes, and how hard. */
export const DIFFICULTY: Record<Difficulty, { chance: number; severity: number; label: string; note: string }> = {
  gentle: { chance: 12, severity: 0.5, label: "Gentle", note: "Trouble is rare and mild: nothing burns down, floods spare the crops, meteors miss the houses." },
  honest: { chance: 22, severity: 1, label: "Honest", note: "The world as it is: warnings first, then real losses, and something gained after." },
  hard: { chance: 35, severity: 1.5, label: "Hard", note: "Trouble comes often and bites deep: fires spread to roofs faster, floods take crops, meteors flatten what they hit." },
};

/** No adversity in the first days of a new settlement. */
export const GRACE_DAYS = 5;

export interface Event {
  id: number;
  kind: AdversityKind;
  owner: number;
  /** Where it centres (a river, a field, a storehouse); -1 for a world-wide cold snap. */
  tile: number;
  /** Warned at, strikes at, over at (ticks). */
  warned: number;
  at: number;
  until: number;
  /** Struck yet, and over. */
  started: boolean;
  done: boolean;
  /** Floods: tiles under water. Meteors: impact tiles (with their tick). */
  tiles: number[];
  times: number[];
}

const LEAD_HOURS: Record<AdversityKind, number> = { flood: 8, blight: 6, coldsnap: 20, meteors: 6, pests: 4 };
const LENGTH_HOURS: Record<AdversityKind, number> = { flood: 14, blight: 36, coldsnap: 40, meteors: 4, pests: 36 };

export class Adversity {
  difficulty: Difficulty = "honest";
  readonly events: Event[] = [];
  /** Per tile: blighted fields (1). */
  readonly blight: Uint8Array;
  blightVersion = 0;
  /** Per player: fields grow faster until this tick (hardy seed kept after a blight). */
  readonly hardyUntil: number[] = [];
  /** The cold snap in force, °C (negative), for the climate. */
  cold = 0;

  constructor(private readonly eco: Economy) {
    this.blight = new Uint8Array(eco.land.planet.grid.count);
  }

  private get hour(): number {
    return Math.max(1, Math.round(this.eco.dayTicks / 24));
  }

  get severity(): number {
    return DIFFICULTY[this.difficulty].severity;
  }

  /** Active or foretold events (for the HUD and the renderer). */
  live(): Event[] {
    return this.events.filter((e) => !e.done);
  }

  step(tick: number): void {
    const eco = this.eco;
    // Each morning: perhaps something is coming.
    if (tick % eco.dayTicks === Math.round(eco.dayTicks * 0.3) && tick >= GRACE_DAYS * eco.dayTicks) this.roll(tick);
    if (tick % 25 !== 0) return;
    for (const e of this.events) {
      if (e.done) continue;
      if (!e.started && tick >= e.at) this.strike(e, tick);
      else if (e.started && tick < e.until) this.during(e, tick);
      else if (e.started && tick >= e.until) this.end(e, tick);
    }
  }

  /** Maybe foretell an event for one of the settlements. */
  private roll(tick: number): void {
    const eco = this.eco;
    const day = Math.floor(tick / eco.dayTicks);
    if (this.live().length >= 2) return;
    if (mix32(day, 0xadd1) % 100 >= DIFFICULTY[this.difficulty].chance) return;
    const owners = eco.keeps.map((k, p) => (k === undefined || eco.defeated[p] ? -1 : p)).filter((p) => p >= 0);
    if (!owners.length) return;
    const owner = owners[mix32(day, 0xadd2) % owners.length]!;
    const kinds: AdversityKind[] = ["flood", "blight", "coldsnap", "meteors", "pests"];
    const start = mix32(day, 0xadd3) % kinds.length;
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[(start + k) % kinds.length]!;
      if (this.live().some((e) => e.kind === kind)) continue;
      const tile = this.siteFor(kind, owner, day);
      if (tile === null) continue;
      this.foretell(kind, owner, tile, tick);
      return;
    }
  }

  /** Where an event would fall for a player, or null if it can't happen to them now. */
  private siteFor(kind: AdversityKind, p: number, day: number): number | null {
    const eco = this.eco;
    const land = eco.land;
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    if (!keep) return null;
    const mine = (t: number) => land.territory[t] === p + 1;
    const pick = (ts: number[]) => (ts.length ? ts[mix32(day, ts.length) % ts.length]! : null);
    switch (kind) {
      case "flood":
        return pick(land.ring(keep.tile, 10).filter((t) => mine(t) && land.isRiver(t)));
      case "blight":
        return pick(land.ring(keep.tile, 12).filter((t) => mine(t) && land.feature[t] === Feature.Field));
      case "coldsnap":
        // Not under a fixed sun's day side, and not where it's already freezing.
        return eco.climate && !land.planet.params.locked ? -1 : null;
      case "meteors":
        return keep.tile;
      case "pests": {
        const foods = goodsFor("food");
        const stores = eco.buildings.filter((b) => b.alive && b.built && b.owner === p && b.def.storage && foods.some((g) => (b.stock[g] as number) > 4));
        return stores.length ? stores[mix32(day, 7) % stores.length]!.tile : null;
      }
    }
  }

  foretell(kind: AdversityKind, owner: number, tile: number, tick: number): Event {
    const h = this.hour;
    const e: Event = { id: this.events.length, kind, owner, tile, warned: tick, at: tick + LEAD_HOURS[kind] * h, until: tick + (LEAD_HOURS[kind] + LENGTH_HOURS[kind]) * h, started: false, done: false, tiles: [], times: [] };
    this.events.push(e);
    const warn: Record<AdversityKind, string> = {
      flood: "Heavy rain upstream: the river is rising and will break its banks by tonight. Fields and roads by the water will flood; the silt will enrich them after.",
      blight: "Mould on the grain! A blight is starting in the fields and will spread from field to field. Harvest what is ripe now.",
      coldsnap: "The geese have gone south early: a cold snap is coming tomorrow. Stock fuel for the waystations and keep the food in.",
      meteors: "The stargazers see a swarm of shooting stars coming tonight. Some will reach the ground: keep clear of open fields, and look for the fallen stars after.",
      pests: "Droppings in the stores: rats have got into the food. A hunter nearby will keep them down; a frost would finish them.",
    };
    this.eco.notify(owner, warn[kind]);
    return e;
  }

  private strike(e: Event, tick: number): void {
    const eco = this.eco;
    const land = eco.land;
    e.started = true;
    const sev = this.severity;
    switch (e.kind) {
      case "flood": {
        // The river and the low ground beside it go under.
        const base = land.planet.terrain.elevation[e.tile] as number;
        const reach = this.difficulty === "hard" ? 3 : 2;
        for (const t of [e.tile, ...land.ring(e.tile, reach)]) {
          if (!land.isLand(t) || (land.planet.terrain.elevation[t] as number) > base + 0.12 * sev + 0.04) continue;
          e.tiles.push(t);
          land.flooded[t] = 1;
          // Crops under water: lost on Hard, set back on Honest, spared when Gentle.
          if (land.feature[t] === Feature.Field && this.difficulty !== "gentle") {
            if (this.difficulty === "hard") land.feature[t] = Feature.None;
            land.amount[t] = 0;
            land.featureVersion++;
          }
        }
        land.floodVersion++;
        eco.notify(e.owner, "The river has flooded! Carriers wait for the water to go down.");
        break;
      }
      case "blight":
        this.blight[e.tile] = 1;
        this.blightVersion++;
        break;
      case "coldsnap":
        this.cold = -Math.round(12 * sev);
        eco.notify(e.owner, `The cold snap is here: ${-this.cold} degrees colder for two days.`);
        break;
      case "meteors": {
        // Impacts over the next hours, a few near the settlement and more across the world.
        const n = Math.round(6 * sev) + 2;
        const grid = land.planet.grid;
        for (let i = 0; i < n; i++) {
          const near = i < 3;
          const ring = near ? land.ring(e.tile, 9) : [];
          const t = near && ring.length ? ring[mix32(e.id, i * 31) % ring.length]! : mix32(e.id, i * 17 + 5) % grid.count;
          e.tiles.push(t);
          e.times.push(tick + Math.round(((i + 0.5) / n) * LENGTH_HOURS.meteors * this.hour));
        }
        break;
      }
      case "pests":
        break;
    }
  }

  private during(e: Event, tick: number): void {
    const eco = this.eco;
    const land = eco.land;
    const hourly = tick % this.hour < 25;
    switch (e.kind) {
      case "blight":
        // It spreads to neighbouring fields every few hours.
        if (hourly && mix32(tick, e.id) % 3 === 0) {
          const spread: number[] = [];
          for (let t = 0; t < this.blight.length; t++) {
            if (!this.blight[t]) continue;
            for (const n of land.ring(t, 2)) if (land.feature[n] === Feature.Field && !this.blight[n] && mix32(n, tick) % 100 < 40 * this.severity) spread.push(n);
          }
          for (const t of spread) this.blight[t] = 1;
          if (spread.length) this.blightVersion++;
        }
        break;
      case "meteors":
        for (let i = 0; i < e.tiles.length; i++) {
          const at = e.times[i]!;
          if (at >= 0 && tick >= at) {
            this.impact(e, e.tiles[i]!);
            e.times[i] = -1;
          }
        }
        break;
      case "pests": {
        // Rats eat from the store each hour, unless a hunter is near or the frost has come.
        const store = eco.buildingAt(e.tile);
        const hunted = eco.buildings.some((b) => b.alive && b.built && b.def.job === "hunt" && b.owner === e.owner && land.ring(e.tile, 6).includes(b.tile));
        if (!store || !store.alive || hunted || this.cold < 0) {
          if (hunted) eco.notify(e.owner, "The hunter's dogs have cleared the rats out of the stores.");
          e.until = tick;
          break;
        }
        if (hourly) {
          const share = 0.02 * this.severity;
          for (const g of goodsFor("food")) store.stock[g] = Math.floor((store.stock[g] as number) * (1 - share));
        }
        break;
      }
      default:
        break;
    }
  }

  /** A meteorite lands: a crater, scorched ground, and a lump of iron and gold from the sky. */
  private impact(e: Event, t: number): void {
    const eco = this.eco;
    const land = eco.land;
    if (!land.isLand(t)) return;
    const b = land.use[t] === Use.Building ? eco.buildings[land.ref[t] as number] : undefined;
    if (b?.alive) {
      // Gentle: a near miss. Honest: damage. Hard: flattened (never a Hearthship).
      if (this.difficulty === "gentle") return;
      b.wear = Math.min(1, b.wear + 0.5);
      b.soot = Math.min(1, b.soot + 0.5);
      if (this.difficulty === "hard" && !eco.keeps.includes(b.id) && b.built) {
        eco.notify(b.owner, `A falling star has flattened your ${b.def.name.toLowerCase()}!`);
        eco.removeBuildingAt(t);
      } else eco.notify(b.owner, `A falling star has struck your ${b.def.name.toLowerCase()}.`);
      return;
    }
    if (land.use[t] !== Use.Free) return;
    land.feature[t] = Feature.Rock;
    land.amount[t] = 4;
    land.variety[t] = METEORITE;
    land.featureVersion++;
    for (const n of land.planet.grid.neighborsOf(t)) {
      if (land.feature[n] === Feature.Tree || land.feature[n] === Feature.Shrub || land.feature[n] === Feature.Field) eco.ecology.ignite(n);
    }
    const owner = (land.territory[t] as number) - 1;
    if (owner >= 0) eco.notify(owner, "A falling star has landed on your land! A quarry can break the meteorite for iron and gold.");
  }

  private end(e: Event, tick: number): void {
    const eco = this.eco;
    const land = eco.land;
    e.done = true;
    switch (e.kind) {
      case "flood":
        // The water goes down and leaves silt: the richest soil there is.
        for (const t of e.tiles) {
          if (!land.tidal[t]) land.flooded[t] = 0;
          land.soil[t] = Math.min(1, (land.soil[t] as number) + 0.35);
        }
        land.floodVersion++;
        eco.notify(e.owner, "The flood has gone down, leaving rich silt on the fields by the river.");
        break;
      case "blight":
        this.blight.fill(0);
        this.blightVersion++;
        // The fields that came through it give hardier seed.
        this.hardyUntil[e.owner] = tick + 6 * eco.dayTicks;
        eco.notify(e.owner, "The blight has passed. Seed from the fields that came through it is hardier: crops grow faster for a while.");
        break;
      case "coldsnap":
        this.cold = 0;
        // The frost has killed the vermin.
        for (const x of this.events) if (x.kind === "pests" && !x.done) x.until = tick;
        eco.notify(e.owner, "The cold snap is over. The frost has cleared the vermin out of the stores.");
        break;
      case "meteors":
        for (let i = 0; i < e.tiles.length; i++) if ((e.times[i] ?? -1) >= 0) this.impact(e, e.tiles[i]!);
        break;
      case "pests":
        break;
    }
  }

  hash(h: StateHasher): void {
    h.int(this.events.length).int(this.cold);
    for (const e of this.events) h.int(e.started ? 1 : 0).int(e.done ? 1 : 0).int(e.tiles.length);
    let b = 0;
    for (let t = 0; t < this.blight.length; t += 3) b = (b * 31 + (this.blight[t] as number)) | 0;
    h.int(b);
  }
}

/** Rock variety of a meteorite (quarried for iron and gold). */
export const METEORITE = 7;
