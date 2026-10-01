import { mix32 } from "../rng";
import { Biome } from "../planet/terrain";
import type { StateHasher } from "../hash";
import { Feature, TREE_GROWTH_TICKS, TREE_MATURE, Use, type LandUse } from "./landuse";

/** Fire burns and spreads in steps of this many ticks. */
export const FIRE_STEP = 5;
/** Succession, erosion and cover visit every tile once in this many ticks (a quarter day). */
const VISIT_TICKS = 1800;
const VISIT_EVERY = 10;
/** A well protects and quenches fires within this many steps. */
export const WELL_REACH = 5;
/** A well can be dug where the aquifer is at least this full. */
export const WELL_AQUIFER = 0.35;

/** What the ecology needs from the economy: buildings, wells, the seedlings list, and notices. */
export interface EcologyHost {
  readonly dayLength: number;
  /** Is there a built well within reach of this tile (and water in it)? */
  wellCovers(t: number): boolean;
  /** A building stands on this tile: fire reaches it. */
  scorchBuilding(t: number): void;
  /** A new tree seedling has sprung up and should grow. */
  seedling(t: number): void;
  /** An apiary's bees work the flowers around this tile. */
  beesBoost(t: number): boolean;
  /** Temperature (°C) and rain (0..1) right now. */
  temp(t: number): number;
  rain(t: number): number;
  notifyFire(t: number): void;
}

/** Ground cover each biome grows back to (255 = lush grass). */
function coverCap(b: Biome): number {
  switch (b) {
    case Biome.Desert:
      return 50;
    case Biome.Rock:
      return 40;
    case Biome.Snow:
      return 20;
    case Biome.Beach:
      return 60;
    case Biome.Steppe:
      return 170;
    case Biome.Tundra:
      return 140;
    default:
      return 255;
  }
}

/** How readily shrubs take over a clearing (0 = never, e.g. deserts and bare rock). */
function woody(b: Biome): number {
  switch (b) {
    case Biome.DeepForest:
      return 1.3;
    case Biome.Forest:
      return 1;
    case Biome.Meadow:
      return 0.6;
    case Biome.Marsh:
      return 0.7;
    case Biome.Steppe:
      return 0.15;
    case Biome.Tundra:
      return 0.2;
    default:
      return 0;
  }
}

/** Wildlife each biome can carry (0..255). */
function gameCap(b: Biome): number {
  switch (b) {
    case Biome.DeepForest:
      return 110;
    case Biome.Forest:
      return 90;
    case Biome.Meadow:
      return 60;
    case Biome.Marsh:
      return 55;
    case Biome.Steppe:
      return 40;
    case Biome.Tundra:
      return 25;
    default:
      return 0;
  }
}

/**
 * The living land: how dry it is, fire, plant succession (clearing → grass → shrubs → forest,
 * seeded from nearby trees), erosion of bare slopes and deposition downhill and at river mouths,
 * groundwater for wells, wildlife that grows and crashes, and pollinators that help fields.
 *
 * Deterministic: randomness comes from hashing the tile and tick, never from shared state.
 */
export class Ecology {
  /** 0 (wet) .. 1 (tinder dry). */
  readonly dry: Float32Array;
  /** Fire steps left on a burning tile (0 = not burning). */
  readonly fire: Uint8Array;
  /** Burnt ground, fading as it greens again (0..255). */
  readonly scorch: Uint8Array;
  /** Grass and herb cover (0..255): holds the soil, feeds fires when dry. */
  readonly cover: Uint8Array;
  /** Wildlife density (0..255). */
  readonly game: Uint8Array;
  /** Pollinators (0..255), from wild ground nearby in the warm months. */
  readonly bees: Uint8Array;
  /** How much groundwater the ground can hold (0..1), and how full it is now. */
  readonly aquifer: Float32Array;
  readonly table: Float32Array;
  /** Silt laid down at river mouths (0..255): deltas. */
  readonly silt: Uint8Array;
  /** Tiles on fire right now. */
  readonly burning: number[] = [];
  /** Bumped when fire, scorch or silt change (renderers follow it). */
  version = 0;
  /** Bumped when ground cover changes a lot: a tile burns out, and once a day as it regrows. */
  groundVersion = 0;
  private visit = 0;

  constructor(
    private readonly land: LandUse,
    private readonly host: EcologyHost,
  ) {
    const n = land.planet.grid.count;
    const terrain = land.planet.terrain;
    this.dry = new Float32Array(n);
    this.fire = new Uint8Array(n);
    this.scorch = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    this.game = new Uint8Array(n);
    this.bees = new Uint8Array(n);
    this.aquifer = new Float32Array(n);
    this.table = new Float32Array(n);
    this.silt = new Uint8Array(n);
    const peak = terrain.params.mountainHeight;
    for (let t = 0; t < n; t++) {
      if (!land.isLand(t)) continue;
      const b = terrain.biome[t] as Biome;
      this.cover[t] = coverCap(b);
      this.game[t] = Math.round(gameCap(b) * 0.7);
      // Groundwater: wet ground and valleys near rivers and lakes hold more; mountains little.
      let water = 0;
      for (const m of land.planet.grid.neighborsOf(t)) if (!land.isLand(m) || land.isRiver(m)) water = 1;
      const high = Math.max(0, (terrain.elevation[t] as number) / peak);
      const a = 0.15 + 0.6 * (terrain.moisture[t] as number) + (land.isRiver(t) ? 0.3 : 0) + water * 0.15 - high * 0.6;
      this.aquifer[t] = Math.max(0, Math.min(1, a));
      this.table[t] = this.aquifer[t] as number;
    }
  }

  /** Called every tick by the economy. */
  step(tick: number, climateStep: boolean): void {
    if (climateStep) this.stepWeather(tick);
    if (tick % FIRE_STEP === 0 && this.burning.length) this.stepFire(tick);
    if (tick % VISIT_EVERY === 0) this.stepVisits(tick);
    if (tick % this.host.dayLength === 0) this.stepDaily();
  }

  /** Fuel on a tile: what a fire can burn there right now. */
  fuel(t: number): number {
    const land = this.land;
    if (!land.isLand(t) || land.use[t] === Use.Road || land.use[t] === Use.Flag || land.use[t] === Use.Building) return 0;
    if ((land.snowCover[t] as number) > 0.2 || (land.mud[t] as number) > 0.5) return 0;
    const f = land.feature[t] as Feature;
    const grass = ((this.cover[t] as number) / 255) * 0.3;
    if (f === Feature.Tree) return 0.35 + 0.65 * ((land.amount[t] as number) / TREE_MATURE);
    if (f === Feature.Shrub) return 0.8;
    if (f === Feature.Hedge) return 0.6;
    if (f === Feature.Giant) return 1;
    if (f === Feature.Field) return (land.amount[t] as number) >= 3 ? 0.7 : 0.1;
    if (f === Feature.Rock) return 0;
    return grass;
  }

  /** Light a fire on a tile if there is anything to burn. */
  ignite(t: number): boolean {
    if ((this.fire[t] as number) > 0 || this.fuel(t) <= 0.05) return false;
    this.fire[t] = 12 + Math.round(this.fuel(t) * 24);
    this.burning.push(t);
    this.version++;
    return true;
  }

  private rand(t: number, tick: number, salt: number): number {
    return mix32(t, (tick * 2654435761) ^ salt) / 4294967296;
  }

  /** Dryness follows heat and rain; lightning at the edge of storms can start fires. */
  private stepWeather(tick: number): void {
    const land = this.land;
    const n = land.planet.grid.count;
    for (let t = 0; t < n; t++) {
      if (!land.isLand(t)) continue;
      const temp = this.host.temp(t);
      const rain = this.host.rain(t);
      let d = this.dry[t] as number;
      d += temp > 12 ? 0.0025 * Math.min(2, (temp - 12) / 10) : -0.001;
      d -= rain * 0.25 + (land.mud[t] as number) * 0.01;
      if ((land.snowCover[t] as number) > 0.1) d = 0;
      this.dry[t] = Math.max(0, Math.min(1, d));
      // Groundwater: rain recharges it, it drains slowly toward a dry-season level.
      const a = this.aquifer[t] as number;
      let w = (this.table[t] as number) + rain * 0.02 * a;
      if (w > a * 0.35) w -= 0.0008;
      this.table[t] = Math.max(0, Math.min(a, w));
    }
    // Dry lightning: a few strikes on dry, hot ground under the ragged edge of a storm.
    for (let k = 0; k < 4; k++) {
      const t = mix32(tick, 7919 + k) % n;
      if (!land.isLand(t)) continue;
      const rain = this.host.rain(t);
      if (rain < 0.04 || rain > 0.3 || (this.dry[t] as number) < 0.75 || this.host.temp(t) < 18) continue;
      if (this.rand(t, tick, 31) < 0.25 && this.ignite(t)) this.host.notifyFire(t);
    }
  }

  /** Burning tiles spread to their neighbours by fuel, dryness and wind, then burn out. */
  private stepFire(tick: number): void {
    const land = this.land;
    const grid = land.planet.grid;
    const c = grid.center;
    const list = this.burning.splice(0);
    for (const t of list) {
      const quench = this.host.wellCovers(t);
      const left = Math.max(0, (this.fire[t] as number) - (quench ? 4 : 1));
      // Spread: the wind (westerly or trade) pushes fire along its direction.
      const ty = c[t * 3 + 1] as number;
      const east = Math.abs(ty) > 0.5 ? 1 : -1;
      for (const m of grid.neighborsOf(t)) {
        if ((this.fire[m] as number) > 0) continue;
        if (land.use[m] === Use.Building) {
          if (!quench && this.rand(m, tick, 5) < 0.3) this.host.scorchBuilding(m);
          continue;
        }
        const fuel = this.fuel(m);
        if (fuel <= 0.05) continue;
        // Longitude step toward the neighbour, in the wind's direction.
        const dx = (c[m * 3] as number) - (c[t * 3] as number);
        const dz = (c[m * 3 + 2] as number) - (c[t * 3 + 2] as number);
        const lonStep = (-(c[t * 3 + 2] as number) * dx + (c[t * 3] as number) * dz) * east;
        const wind = lonStep > 0 ? 1.8 : 0.7;
        const p = fuel * (0.2 + (this.dry[m] as number)) * 0.05 * wind * (this.host.wellCovers(m) ? 0.2 : 1);
        if (this.rand(m, tick, 11) < p) this.ignite(m);
      }
      if (left > 0) {
        this.fire[t] = left;
        this.burning.push(t);
        continue;
      }
      // Burnt out: trees become charred stumps, scrub and crops are gone, the ground is black.
      this.fire[t] = 0;
      const f = land.feature[t] as Feature;
      if (f === Feature.Tree || f === Feature.Giant) {
        land.feature[t] = Feature.Stump;
        land.amount[t] = f === Feature.Giant ? 60 : 12;
        land.variety[t] = 0;
      } else if (f === Feature.Shrub || f === Feature.Field || f === Feature.Hedge) {
        land.feature[t] = Feature.None;
        land.amount[t] = 0;
      }
      land.featureVersion++;
      this.scorch[t] = 255;
      this.cover[t] = 0;
      this.game[t] = Math.round((this.game[t] as number) * 0.3);
      this.dry[t] = 0;
      this.groundVersion++;
    }
    this.version++;
  }

  /** A rotating slice of tiles: grass regrows, scrub takes clearings, seedlings rise, slopes wash. */
  private stepVisits(tick: number): void {
    const land = this.land;
    const grid = land.planet.grid;
    const terrain = land.planet.terrain;
    const n = grid.count;
    const slice = Math.ceil(n / (VISIT_TICKS / VISIT_EVERY));
    let changed = false;
    for (let k = 0; k < slice; k++) {
      const t = this.visit;
      this.visit = (this.visit + 1) % n;
      if (!land.isLand(t)) continue;
      const b = terrain.biome[t] as Biome;
      const growing = this.host.temp(t) > 4 && (land.snowCover[t] as number) < 0.3;
      // Burnt ground greens again over a few days.
      if ((this.scorch[t] as number) > 0) {
        this.scorch[t] = Math.max(0, (this.scorch[t] as number) - (growing ? 14 : 4));
        changed = true;
      }
      let cover = this.cover[t] as number;
      const cap = Math.max(0, coverCap(b) - (land.wear[t] as number) * 2);
      // Grass creeps back over burnt ground slowly, from the edges.
      const burnt = (this.scorch[t] as number) > 40;
      if (growing) cover += (cap - cover) * (burnt ? 0.04 : 0.2) + (cap > cover ? 1 : 0);
      if (land.use[t] === Use.Road || land.use[t] === Use.Flag || land.use[t] === Use.Building) cover = Math.min(cover, 30);
      this.cover[t] = Math.max(0, Math.min(255, Math.round(cover)));
      this.succession(t, b, tick, growing);
      if (this.erode(t)) changed = true;
    }
    if (changed) this.version++;
  }

  /** A tile's neighbours and theirs: is a mature tree close enough to seed it? */
  seedTreeNear(t: number): boolean {
    const land = this.land;
    const grid = land.planet.grid;
    for (const m of grid.neighborsOf(t)) {
      if (land.feature[m] === Feature.Tree && (land.amount[m] as number) >= TREE_MATURE) return true;
      for (const q of grid.neighborsOf(m)) if (land.feature[q] === Feature.Tree && (land.amount[q] as number) >= TREE_MATURE) return true;
    }
    return false;
  }

  private succession(t: number, b: Biome, tick: number, growing: boolean): void {
    const land = this.land;
    if (!growing || (land.use[t] !== Use.Free && land.use[t] !== Use.Blocked) || (land.wear[t] as number) > 20) return;
    const w = woody(b);
    // Scrub needs grassland under it, and trees need a woodland soil (terraformed worlds).
    if (w <= 0 || (land.life[t] as number) < 3) return;
    const f = land.feature[t] as Feature;
    if (f !== Feature.None && f !== Feature.Shrub) return;
    // Ground next to roads, flags and buildings is kept clear by the people who pass.
    for (const m of land.planet.grid.neighborsOf(t)) {
      const u = land.use[m];
      if (u === Use.Road || u === Use.Flag || u === Use.Building) return;
    }
    const seed = this.seedTreeNear(t);
    const r = this.rand(t, tick, 97);
    if (f === Feature.None) {
      if ((this.cover[t] as number) < 180 || (this.scorch[t] as number) > 60) return;
      if (r < w * (seed ? 0.05 : 0.006)) {
        land.feature[t] = Feature.Shrub;
        land.amount[t] = 0;
        land.featureVersion++;
      }
    } else if (seed && r < w * 0.03 && (land.life[t] as number) >= 4) {
      land.feature[t] = Feature.Tree;
      land.amount[t] = 0;
      land.variety[t] = mix32(t, 3) & 3;
      land.nextGrowth[t] = tick + TREE_GROWTH_TICKS * 2;
      land.featureVersion++;
      this.host.seedling(t);
    }
  }

  /** Rain washes soil off bare slopes; it settles downhill, and silt builds deltas at river mouths. */
  private erode(t: number): boolean {
    const land = this.land;
    const grid = land.planet.grid;
    const e = land.planet.terrain.elevation;
    const mud = land.mud[t] as number;
    if (mud < 0.15) return false;
    // River mouths: silt settles where the river meets still water.
    if (land.isRiver(t)) {
      let mouth = false;
      for (const m of grid.neighborsOf(t)) if (!land.isLand(m)) mouth = true;
      if (mouth && (this.silt[t] as number) < 255) {
        this.silt[t] = Math.min(255, (this.silt[t] as number) + 2);
        land.soil[t] = Math.min(1, (land.soil[t] as number) + 0.004);
        return true;
      }
      return false;
    }
    const f = land.feature[t] as Feature;
    if (f === Feature.Tree || f === Feature.Shrub) return false;
    const slope = land.slope(t);
    if (slope < 0.9) return false;
    const bare = 1 - ((this.cover[t] as number) / 255) * 0.85;
    const loss = Math.min(land.soil[t] as number, 0.006 * (slope - 0.9) * mud * bare);
    if (loss < 1e-4) return false;
    let low = -1;
    let lowE = e[t] as number;
    for (const m of grid.neighborsOf(t)) {
      if ((e[m] as number) < lowE) {
        lowE = e[m] as number;
        low = m;
      }
    }
    land.soil[t] = Math.max(0.03, (land.soil[t] as number) - loss);
    if (low >= 0 && land.isLand(low)) land.soil[low] = Math.min(1, (land.soil[low] as number) + loss * 0.9);
    return false;
  }

  /** Once a day: wildlife breeds, spreads, overshoots and crashes; pollinators follow wild ground. */
  private stepDaily(): void {
    this.groundVersion++;
    const land = this.land;
    const grid = land.planet.grid;
    const terrain = land.planet.terrain;
    const n = grid.count;
    const next = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      if (!land.isLand(t)) continue;
      const b = terrain.biome[t] as Biome;
      let cap = gameCap(b) * land.regionOf(t).rules.game * (1 - 0.5 * (land.snowCover[t] as number));
      if (land.use[t] !== Use.Free && land.use[t] !== Use.Blocked) cap *= 0.1;
      const g = this.game[t] as number;
      // Herds breed in the warm months and thin out in winter. When the land carries fewer
      // (snow, new buildings) an overgrown herd crashes.
      const breeding = this.host.temp(t) > 8;
      let v = cap > 0 ? (breeding ? g + 0.45 * g * (1 - g / cap) + (g < 3 && cap > 20 ? 1 : 0) : g * 0.97) : g * 0.5;
      if (cap > 0 && g > cap * 1.25) v = g * 0.55;
      // Wander: a tenth of the herd mixes with the neighbours.
      let sum = 0;
      let k = 0;
      for (const m of grid.neighborsOf(t)) {
        if (!land.isLand(m)) continue;
        sum += this.game[m] as number;
        k++;
      }
      if (k) v = v * 0.9 + (sum / k) * 0.1;
      next[t] = Math.max(0, Math.min(255, Math.round(v)));
    }
    this.game.set(next);
    // Pollinators: wild, flowering ground nearby in the warm months.
    for (let t = 0; t < n; t++) {
      if (!land.isLand(t)) continue;
      let wild = 0;
      let k = 0;
      for (const m of grid.neighborsOf(t)) {
        k++;
        const f = land.feature[m] as Feature;
        if (!land.isLand(m) || land.use[m] !== Use.Free) continue;
        if (f === Feature.Shrub || f === Feature.Hedge || (f === Feature.None && (this.cover[m] as number) > 180) || f === Feature.Tree) wild++;
      }
      const warm = this.host.temp(t) > 10 ? 1 : 0.2;
      const boost = this.host.beesBoost(t) ? 0.45 : 0;
      this.bees[t] = Math.round(Math.min(1, (k ? wild / k : 0) + boost) * 255 * warm);
    }
  }

  /** Take game from a tile (hunting); returns true if there was enough. */
  hunt(t: number): boolean {
    if ((this.game[t] as number) < 20) return false;
    this.game[t] = (this.game[t] as number) - 18;
    return true;
  }

  /** Field growth multiplier from pollinators (1 = none nearby, up to 1.25). */
  pollination(t: number): number {
    return 1 + ((this.bees[t] as number) / 255) * 0.25;
  }

  /** Wells draw down the water table around them each day. */
  draw(t: number, amount: number): void {
    this.table[t] = Math.max(0, (this.table[t] as number) - amount);
    for (const m of this.land.planet.grid.neighborsOf(t)) this.table[m] = Math.max(0, (this.table[m] as number) - amount * 0.5);
  }

  hash(h: StateHasher): void {
    let a = 0;
    for (let t = 0; t < this.fire.length; t += 11) a = (a + (this.fire[t] as number) * 7 + (this.game[t] as number) + (this.cover[t] as number) * 3 + (this.scorch[t] as number)) | 0;
    h.int(a).int(this.burning.length).int(this.visit);
  }
}
