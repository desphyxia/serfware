import type { StateHasher } from "../hash";
import { mix32 } from "../rng";
import { goodsFor } from "./defs";
import type { Economy } from "./economy";
import { Feature } from "./landuse";
import { note } from "./people";

/**
 * Knowledge and culture: the Almanac (what a people has learned by watching their world, which
 * unlocks blueprints and forecasts), festivals on the world's own calendar, and the joy and
 * wonder they bring to Glow.
 */

export interface DiscoveryDef {
  title: string;
  /** The Almanac page: what was seen, and what it taught. */
  text: string;
  /** What the page unlocks: building ids, or "forecast" / "tides" for the weather chip. */
  unlocks: string[];
}

export const DISCOVERIES = {
  weather: {
    title: "Weather lore",
    text: "Clouds bunch and darken a day before the rain. Watching the sky each morning, we can tell tomorrow's weather.",
    unlocks: ["forecast"],
  },
  seasons: {
    title: "The turning year",
    text: "The days have shortened and the air has changed: this world has seasons, and they come round again. We will mark them with feasts.",
    unlocks: ["maypole", "flowerbed"],
  },
  springs: {
    title: "Springs and wells",
    text: "Water runs under the ground here, nearer the surface by rivers and in low places. Where it can be raised, it can be made to play.",
    unlocks: ["fountain"],
  },
  stars: {
    title: "The Star Wells",
    text: "The five-sided hollows hum at night. Beside each lies old worked stone: someone was here before us, and built at the wells.",
    unlocks: ["digsite"],
  },
  precursors: {
    title: "The Precursors",
    text: "From the ruin: carved tablets, a lens that still glows, tools of a metal we cannot name. They watched the stars from the wells, and then they left.",
    unlocks: ["statue"],
  },
  frost: {
    title: "Frost",
    text: "Water turns to stone in the cold: lakes freeze hard enough to walk on, and snow lies on the roofs.",
    unlocks: [],
  },
  tides: {
    title: "The tides",
    text: "The sea breathes in and out with the moons. Timing the flats by the moons, we can know when they will flood.",
    unlocks: ["tides"],
  },
  fire: {
    title: "Wildfire",
    text: "Dry growth burns fast once lightning finds it. Water near the homes is the best guard.",
    unlocks: [],
  },
  bees: {
    title: "Bees",
    text: "The bees work the flowers, and the flowers set more seed for it. Wild ground near the fields feeds them.",
    unlocks: [],
  },
  eruption: {
    title: "The vents",
    text: "The ground here is hot beneath: steam, then fire and ash. The ash, once weathered, is the richest soil of all.",
    unlocks: [],
  },
  storms: {
    title: "Sandstorms",
    text: "Heat over the salt flats raises the wind, and the wind carries the sand. They pass; the roads must be swept.",
    unlocks: [],
  },
  festival: {
    title: "Our first festival",
    text: "We danced around the pole and ate together. Nobody worked, and nobody minded.",
    unlocks: ["bench"],
  },
} satisfies Record<string, DiscoveryDef>;

export type DiscoveryId = keyof typeof DISCOVERIES;
export const DISCOVERY_IDS = Object.keys(DISCOVERIES) as DiscoveryId[];

/** What unlocks a building (if anything has to). */
export function unlockedBy(buildingId: string): DiscoveryId | null {
  for (const id of DISCOVERY_IDS) if ((DISCOVERIES[id].unlocks as string[]).includes(buildingId)) return id;
  return null;
}

/** Festivals on the world's calendar: four through the year, by the season. */
export const FESTIVALS = [
  { phase: 0.125, name: "the Sowing Feast" },
  { phase: 0.375, name: "Midsummer" },
  { phase: 0.625, name: "Harvest Home" },
  { phase: 0.875, name: "the Long Night" },
] as const;

/** Joy lasts this many days after a festival. */
const JOY_DAYS = 3;

export interface Page {
  id: DiscoveryId;
  day: number;
  /** Who noticed (a settler's name), if anyone in particular. */
  by: string;
}

export class Culture {
  /** Per player: the Almanac's pages, in the order found. */
  readonly pages: Page[][] = [];
  /** Per player: tick the last festival began (-1 never), and its name. */
  readonly festivalAt: number[] = [];
  readonly festivalName: string[] = [];
  private readonly firstSeason: string[] = [];
  /** Relics dug up, per player. */
  readonly relics: number[] = [];

  constructor(private readonly eco: Economy) {}

  has(p: number, id: string): boolean {
    return (this.pages[p] ?? []).some((x) => x.id === id);
  }

  /** Is a building (or "forecast"/"tides") unlocked for this player? */
  unlocked(p: number, what: string): boolean {
    const by = DISCOVERIES[what as DiscoveryId] ? null : unlockedBy(what);
    return !by || this.has(p, by);
  }

  discover(p: number, id: DiscoveryId, by = ""): boolean {
    if (p < 0 || this.eco.keeps[p] === undefined || this.has(p, id)) return false;
    const day = Math.floor(this.eco.tick / this.eco.dayTicks) + 1;
    (this.pages[p] ??= []).push({ id, day, by });
    const d: DiscoveryDef = DISCOVERIES[id];
    const unlocks = d.unlocks.filter((u) => u !== "forecast" && u !== "tides");
    const extra = d.unlocks.includes("forecast") ? " Forecasts now show tomorrow's weather." : d.unlocks.includes("tides") ? " The tide table is open." : "";
    this.eco.notify(p, `New in the Almanac: ${d.title}.${unlocks.length ? ` Unlocked: ${unlocks.join(", ")}.` : ""}${extra} (L)`);
    return true;
  }

  /** A relic dug up at a ruin. */
  relic(p: number, by: string): void {
    this.relics[p] = (this.relics[p] ?? 0) + 1;
    this.discover(p, "precursors", by);
  }

  /** Joy from festivals: full for a few days after one, fading. */
  festive(p: number): boolean {
    const at = this.festivalAt[p] ?? -1;
    return at >= 0 && this.eco.tick - at < this.eco.dayTicks;
  }

  joy(p: number): number {
    const at = this.festivalAt[p] ?? -1;
    if (at < 0) return 0;
    const days = (this.eco.tick - at) / this.eco.dayTicks;
    return days < JOY_DAYS ? 1 - days / (JOY_DAYS * 2) : 0;
  }

  /** Daily: notice what can be seen, and hold any festival that falls today. */
  daily(p: number): void {
    const eco = this.eco;
    const land = eco.land;
    const day = Math.floor(eco.tick / eco.dayTicks);
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    if (!keep) return;
    const someone = () => {
      const ps = eco.people.filter((q) => q.alive && q.owner === p && q.stage === "adult");
      return ps.length ? ps[mix32(day, p) % ps.length]! : null;
    };
    const by = () => {
      const q = someone();
      return q ? `${q.first} ${q.family}` : "";
    };
    if (day >= 2) this.discover(p, "weather", by());
    // The season, where there are seasons.
    const climate = eco.climate;
    if (climate && !land.planet.params.locked) {
      const y = land.planet.grid.center[keep.tile * 3 + 1] as number;
      const s = climate.season(eco.tick, y);
      this.firstSeason[p] ??= s;
      if (s !== this.firstSeason[p]) this.discover(p, "seasons", by());
    } else if (day >= 8) this.discover(p, "seasons", by());
    // What lies on their land.
    let wells = false;
    let frost = false;
    let tidal = false;
    for (let t = 0; t < land.territory.length; t += 1) {
      if (land.territory[t] !== p + 1) continue;
      if (land.planet.grid.degree(t) === 5) wells = true;
      if (land.frozen[t] || (land.snowCover[t] as number) > 0.4) frost = true;
      if (land.tidal[t]) tidal = true;
    }
    if (wells) this.discover(p, "stars", by());
    if (frost) this.discover(p, "frost", by());
    if (tidal) this.discover(p, "tides", by());
    for (const b of eco.buildings) {
      if (!b.alive || !b.built || b.owner !== p) continue;
      if (b.def.well) this.discover(p, "springs", by());
      if (b.def.job === "bees") this.discover(p, "bees", by());
    }
    this.festival(p, day);
  }

  /** The festivals of the year: on the day each falls, if there is a maypole and food to share. */
  private festival(p: number, day: number): void {
    const eco = this.eco;
    const climate = eco.climate;
    if (!climate) return;
    const pole = eco.buildings.some((b) => b.alive && b.built && b.owner === p && b.def.id === "maypole");
    if (!pole) return;
    let name = "";
    if (eco.land.planet.params.locked) {
      // Under a fixed sun there are no seasons: a feast every eighth day.
      if (day % 8 === 0) name = "the Sun Feast";
    } else {
      const now = climate.yearPhase(eco.tick);
      const before = climate.yearPhase(eco.tick - eco.dayTicks);
      for (const f of FESTIVALS) {
        const crossed = before <= now ? before < f.phase && f.phase <= now : before < f.phase || f.phase <= now;
        if (crossed) name = f.name;
      }
    }
    if (!name) return;
    // A feast needs food: a share for every four people.
    const people = eco.people.filter((q) => q.alive && q.owner === p).length;
    let need = Math.ceil(people / 4);
    const foods = goodsFor("food");
    let have = 0;
    for (const s of eco.buildings) if (s.alive && s.def.storage && s.owner === p) for (const g of foods) have += s.stock[g] as number;
    if (have < need) {
      eco.notify(p, `It is time for ${name}, but there is not enough food to share. Next time.`);
      return;
    }
    for (const s of eco.buildings) {
      if (!s.alive || !s.def.storage || s.owner !== p) continue;
      for (const g of foods)
        while (need > 0 && (s.stock[g] as number) > 0) {
          s.stock[g]!--;
          need--;
        }
    }
    this.festivalAt[p] = eco.tick;
    this.festivalName[p] = name;
    for (const q of eco.people) if (q.alive && q.owner === p) note(q, `Celebrated ${name}.`);
    eco.notify(p, `${name[0]!.toUpperCase()}${name.slice(1)}! Everyone gathers at the maypole: Glow rises with the joy of it.`);
    this.discover(p, "festival");
  }

  /** Beauty from decorations a player has built (flowerbeds to statues). */
  decor(p: number): number {
    let s = 0;
    for (const b of this.eco.buildings) if (b.alive && b.built && b.owner === p && b.def.beauty) s += b.def.beauty;
    return s;
  }

  /** How many kinds of food are in store (a varied table is a happier one). */
  variety(p: number): number {
    const eco = this.eco;
    let kinds = 0;
    for (const g of goodsFor("food")) if (eco.buildings.some((b) => b.alive && b.def.storage && b.owner === p && (b.stock[g] as number) > 0)) kinds++;
    return kinds;
  }

  hash(h: StateHasher): void {
    for (const ps of this.pages) h.int(ps?.length ?? 0);
    for (const f of this.festivalAt) h.int(f ?? -1);
    for (const r of this.relics) h.int(r ?? 0);
    h.int(Feature.Ruin);
  }
}
