import type { Planet } from "../planet/planet";
import { Biome } from "../planet/terrain";
import { SimNoise } from "../noise";
import { mix32, type Rng } from "../rng";
import type { BuildingDef } from "./defs";
import { MinHeap } from "./heap";
import { computeHydrology, type Hydrology } from "../planet/hydrology";
import { Region, REGIONS, regionFor, type RegionDef } from "../biomes/regions";
import { TIDE_MEAN, TIDE_RANGE } from "../biomes/tides";
import { sunHeight } from "../biomes/sun";

/** What stands on a tile. */
export enum Use {
  Free = 0,
  Flag = 1,
  Road = 2,
  Building = 3,
  /** Next to a large building: nothing else may be placed, but walking is fine. */
  Blocked = 4,
}

export enum Feature {
  None = 0,
  Tree = 1,
  Rock = 2,
  Stump = 3,
  /** A grain field; amount is its growth stage. */
  Field = 4,
  /** Scrub and young woody growth on an old clearing (succession); cleared by any building. */
  Shrub = 5,
  /** A planted hedgerow: shelters fields, feeds pollinators; blocks roads and buildings. */
  Hedge = 6,
  /** An ancient giant (Canopy Deeps). Amount: logs left; variety 1 = marked for felling. */
  Giant = 7,
  /** A geothermal vent (Emberglass Steppe). Amount: pressure 0..255; it erupts when full. */
  Vent = 8,
  /** A salt-crystal spire (Saltglass Flats): a landmark that blocks the way and lifts Glow's beauty. */
  Spire = 9,
  /** Glowcap fungus (Lumen Mire): amount is its growth stage 0..4; variety 1 = wild. Glows from stage 2. */
  Glowcap = 10,
  /**
   * Precursor ruins beside a Star Well. Amount: digs left for an excavation; variety 1 once
   * dug out (the ruin stays, open to the sky).
   */
  Ruin = 11,
}

export const GLOWCAP_RIPE = 4;
/** Digs an excavation takes to empty a ruin. */
export const RUIN_DIGS = 6;

/** Tree varieties: 0..3 are wild or planted timber; these are special and never felled. */
export const MEMORIAL = 7;
export const ORCHARD = 8;
/** Logs in an ancient giant. */
export const GIANT_LOGS = 10;

/** A mature timber tree a woodcutter may fell. */
export function fellable(land: { feature: Uint8Array; amount: Uint8Array; variety: Uint8Array }, t: number): boolean {
  return land.feature[t] === Feature.Tree && land.amount[t] === TREE_MATURE && (land.variety[t] as number) <= 3;
}

/** Underground deposits found by geologists and dug by mines. */
export enum Deposit {
  None = 0,
  Coal = 1,
  Iron = 2,
  Gold = 3,
  Granite = 4,
}

export const DEPOSIT_IDS = ["none", "coal", "iron", "gold", "granite"] as const;

export const FIELD_RIPE = 4;
export const FIELD_GROWTH_TICKS = 450;
/** How long a geologist's signpost stands. */
export const SIGN_TICKS = 6000;

export const TREE_MATURE = 4;
/** Ticks between growth stages of a planted tree (about two in-game hours each). */
export const TREE_GROWTH_TICKS = 600;

/**
 * Per-tile land use and natural features (trees, rocks). Also answers walkability, slope and
 * path queries. All state lives in typed arrays indexed by tile.
 */
export class LandUse {
  readonly use: Uint8Array;
  /** Id of the flag, road or building on the tile, or -1. */
  readonly ref: Int32Array;
  readonly feature: Uint8Array;
  /** Tree: growth stage 0..TREE_MATURE. Rock: stone left. Stump: ticks until it rots away / 16. */
  readonly amount: Uint8Array;
  /** Tick at which a growing tree reaches its next stage. */
  readonly nextGrowth: Int32Array;
  /** Tree variety (0..3) for visuals. */
  readonly variety: Uint8Array;
  /** Owner of each tile's land: 0 = nobody, otherwise player index + 1. */
  readonly territory: Uint8Array;
  readonly deposit: Uint8Array;
  readonly depositAmount: Uint8Array;
  /** Fish stock in water tiles. */
  readonly fish: Uint8Array;
  /** Geologist signposts: 0 none, 1 nothing found, 2.. Deposit + 1. */
  readonly sign: Uint8Array;
  readonly signExpire: Int32Array;
  signVersion = 0;
  /** Footpath wear from settlers walking off-road (desire paths). */
  readonly wear: Uint16Array;
  wearVersion = 0;
  /** Bumped whenever features change; renderers rebuild when it moves. */
  featureVersion = 0;
  useVersion = 0;
  territoryVersion = 0;
  /** Typical angle between neighbouring tile centres. */
  readonly spacing: number;
  /** Rivers and lakes. */
  readonly hydro: Hydrology;
  /** Soil nitrogen per tile, 0..1: fields drain it, rest and hedgerows restore it. */
  readonly soil: Float32Array;
  /** Groundwater capacity per tile (set by the ecology), for siting wells. */
  aquifer: Float32Array | null = null;
  /** Weather on the ground, kept up to date by the climate: mud (0..1) and snow cover (0..1). */
  readonly mud: Float32Array;
  readonly snowCover: Float32Array;
  /** Region (game biome) of each tile; 0 for water. */
  readonly region: Uint8Array;
  /** Lake tiles frozen hard enough to walk and lay roads on (set by the climate). */
  readonly frozen: Uint8Array;
  iceVersion = 0;
  /** Bitter cold right now (below -2 °C, set by the climate): walking off-road is slow unless warm. */
  readonly chill: Uint8Array;
  /** Within reach of a hearth or a heated waystation (set by the economy). */
  readonly warm: Uint8Array;
  /** Volcanic ash on the ground after an eruption (0..1): richer soil, grey until it weathers in. */
  readonly ash: Float32Array;
  ashVersion = 0;
  /** Tidewater flats: land the highest tides cover (1), and whether the sea covers it now. */
  readonly tidal: Uint8Array;
  readonly flooded: Uint8Array;
  /** Shared roads (diplomacy): per player, a bit per partner whose land they may lay roads on. */
  readonly roadShare: number[] = [];
  floodVersion = 0;
  /** Raised causeways over the flats: roads that stay dry at high tide. */
  readonly causeway: Uint8Array;
  causewayVersion = 0;
  /** Shellfish on the flats, gathered at low tide. */
  readonly shell: Uint8Array;
  /** Sand blown over the ground by storms (0..1): slows roads until traffic clears it. */
  readonly sand: Float32Array;
  sandVersion = 0;
  /** Lit by glowcaps (1) and, in the Lumen Mire, too dark to hurry (dim, 1). Set by the economy. */
  readonly glow: Uint8Array;
  readonly dim: Uint8Array;
  glowVersion = 0;
  /**
   * Life on the ground: 0 barren rock and dust, 1 lichen, 2 moss, 3 grass, 4 woodland. Living
   * worlds are 4 everywhere; terraformed worlds climb the stages (see sim/climate/atmosphere).
   */
  readonly life: Uint8Array;
  /** Native life mats (1) on worlds that had life of their own before anyone came. */
  readonly native: Uint8Array;
  lifeVersion = 0;
  /** Walking effort from gravity: under 1 on a light world (faster), over 1 on a heavy one (slower). */
  readonly lightness: number;

  constructor(readonly planet: Planet) {
    const n = planet.grid.count;
    this.use = new Uint8Array(n);
    this.ref = new Int32Array(n).fill(-1);
    this.feature = new Uint8Array(n);
    this.amount = new Uint8Array(n);
    this.nextGrowth = new Int32Array(n);
    this.variety = new Uint8Array(n);
    this.territory = new Uint8Array(n);
    this.wear = new Uint16Array(n);
    this.deposit = new Uint8Array(n);
    this.depositAmount = new Uint8Array(n);
    this.fish = new Uint8Array(n);
    this.sign = new Uint8Array(n);
    this.signExpire = new Int32Array(n);
    this.spacing = Math.sqrt((4 * Math.PI) / n);
    this.mud = new Float32Array(n);
    this.snowCover = new Float32Array(n);
    this.hydro = computeHydrology(planet);
    this.region = new Uint8Array(n);
    this.frozen = new Uint8Array(n);
    this.chill = new Uint8Array(n);
    this.warm = new Uint8Array(n);
    this.ash = new Float32Array(n);
    this.tidal = new Uint8Array(n);
    this.flooded = new Uint8Array(n);
    this.causeway = new Uint8Array(n);
    this.shell = new Uint8Array(n);
    this.sand = new Float32Array(n);
    this.glow = new Uint8Array(n);
    this.life = new Uint8Array(n).fill(4);
    this.native = new Uint8Array(n);
    this.dim = new Uint8Array(n);
    this.lightness = Math.min(1.2, 0.5 + 0.5 * planet.params.gravity);
    const { biome, temperature, moisture } = planet.terrain;
    const peak = planet.terrain.params.mountainHeight;
    for (let t = 0; t < n; t++) if (this.isLand(t)) this.region[t] = regionFor(biome[t] as Biome, temperature[t] as number, moisture[t] as number, this.isCoast(t), (planet.terrain.elevation[t] as number) / peak);
    // A locked planet: the wet twilight ring is Lumen Mire; the far side is frozen tundra.
    if (planet.params.locked) {
      for (let t = 0; t < n; t++) {
        if (!this.isLand(t)) continue;
        const s = sunHeight(planet, t);
        if (Math.abs(s) < 0.22 && (moisture[t] as number) > 0.3 && this.region[t] !== Region.Skyreef) this.region[t] = Region.LumenMire;
        else if (s < -0.3 && this.region[t] !== Region.Skyreef) this.region[t] = Region.RimefallTundra;
      }
    }
    for (let t = 0; t < n; t++) {
      if (this.region[t] !== Region.TidewaterReach || (planet.terrain.elevation[t] as number) >= TIDE_MEAN + TIDE_RANGE) continue;
      this.tidal[t] = 1;
      this.shell[t] = 6 + (t % 5);
    }
    this.soil = new Float32Array(n);
    for (let t = 0; t < n; t++) this.soil[t] = Math.min(1, 0.35 + 0.5 * (planet.terrain.moisture[t] as number) + (this.isRiver(t) ? 0.15 : 0));
  }

  /** The region (game biome) a tile belongs to. */
  regionOf(t: number): RegionDef {
    return REGIONS[(this.region[t] ?? 0) as Region];
  }

  /** A lake frozen over: walkable, and roads may cross it until the thaw. */
  isIce(t: number): boolean {
    return this.frozen[t] === 1 && this.hydro.lake[t] === 1;
  }

  /** A river runs through this tile. */
  isRiver(t: number): boolean {
    return this.isLand(t) && (this.hydro.flow[t] as number) >= this.hydro.riverFlow;
  }

  /** A geothermal vent next door (or within `r` steps). */
  nearVent(t: number, r = 1): boolean {
    for (const n of r === 1 ? this.planet.grid.neighborsOf(t) : this.ring(t, r)) if (this.feature[n] === Feature.Vent) return true;
    return false;
  }

  /** Fresh or salt water within `r` steps, for irrigation. */
  nearWater(t: number, r = 2): boolean {
    if (this.isRiver(t)) return true;
    for (const n of this.ring(t, r)) if (!this.isLand(n) || this.isRiver(n)) return true;
    return false;
  }

  /** Scatter trees and rocks from terrain. */
  populate(rng: Rng): void {
    const { grid, terrain } = this.planet;
    for (let t = 0; t < grid.count; t++) {
      if (!this.isLand(t) || grid.degree(t) === 5) continue;
      const b = terrain.biome[t] as Biome;
      const r = rng.next();
      let tree = 0;
      let rock = 0;
      switch (b) {
        case Biome.DeepForest: tree = 0.85; rock = 0.03; break;
        case Biome.Forest: tree = 0.6; rock = 0.04; break;
        case Biome.Meadow: tree = 0.1; rock = 0.03; break;
        case Biome.Marsh: tree = 0.25; break;
        case Biome.Steppe: tree = 0.04; rock = 0.06; break;
        case Biome.Tundra: tree = 0.08; rock = 0.1; break;
        case Biome.Rock: rock = 0.45; break;
        case Biome.Beach: rock = 0.02; break;
        default: break;
      }
      if (r < tree) {
        this.feature[t] = Feature.Tree;
        this.amount[t] = TREE_MATURE;
        this.variety[t] = rng.int(0, 3);
        // In the Canopy Deeps some trees are ancient giants, never two side by side.
        const giants = this.regionOf(t).rules.giants;
        if (giants > 0 && rng.next() < giants && !grid.neighborsOf(t).some((m) => this.feature[m] === Feature.Giant)) {
          this.feature[t] = Feature.Giant;
          this.amount[t] = GIANT_LOGS;
          this.variety[t] = 0;
        }
      } else if (r < tree + rock) {
        this.feature[t] = Feature.Rock;
        this.amount[t] = rng.int(4, 9);
        this.variety[t] = rng.int(0, 3);
      } else if (this.region[t] === Region.LumenMire && r > 0.93) {
        // Wild glowcaps in the mire.
        this.feature[t] = Feature.Glowcap;
        this.amount[t] = GLOWCAP_RIPE;
        this.variety[t] = 1;
      } else if (this.region[t] === Region.SaltglassFlats && r > 0.965 && !grid.neighborsOf(t).some((m) => this.feature[m] === Feature.Spire)) {
        // Salt-crystal spires stand over the flats.
        this.feature[t] = Feature.Spire;
        this.amount[t] = 0;
        this.variety[t] = rng.int(0, 3);
      } else if (this.region[t] === Region.EmberglassSteppe && r > 0.975 && this.slope(t) < 1.2 && !grid.neighborsOf(t).some((m) => this.feature[m] === Feature.Vent)) {
        // Geothermal vents: steam, free heat for forges, and now and then an eruption.
        this.feature[t] = Feature.Vent;
        this.amount[t] = rng.int(0, 100);
      }
    }
    this.populateRuins();
    this.featureVersion++;
    this.populateGeology(rng);
  }

  /**
   * Ruins of whoever came before: one beside each Star Well on land, placed by hash (not drawn
   * from the world's random stream, so nothing else about the world changes).
   */
  private populateRuins(): void {
    const grid = this.planet.grid;
    for (let t = 0; t < grid.count; t++) {
      if (grid.degree(t) !== 5 || !this.isLand(t)) continue;
      const ns = grid.neighborsOf(t).filter((n) => this.isLand(n) && grid.degree(n) === 6);
      if (!ns.length) continue;
      const r = ns[mix32(t, 1777) % ns.length] as number;
      this.feature[r] = Feature.Ruin;
      this.amount[r] = RUIN_DIGS;
      this.variety[r] = 0;
    }
  }

  /** Deposits under hills and mountains, fish in coastal waters. */
  private populateGeology(rng: Rng): void {
    const { grid, terrain } = this.planet;
    const peak = terrain.params.mountainHeight;
    const nCoal = new SimNoise(rng.nextU32());
    const nIron = new SimNoise(rng.nextU32());
    const nGold = new SimNoise(rng.nextU32());
    for (let t = 0; t < grid.count; t++) {
      const e = terrain.elevation[t] as number;
      if (e <= 0 || this.hydro.lake[t]) {
        if (e > -peak * 0.5) this.fish[t] = 6 + (t % 5);
        continue;
      }
      const m = e / peak;
      if (m < 0.18) continue;
      const x = grid.center[t * 3] as number;
      const y = grid.center[t * 3 + 1] as number;
      const z = grid.center[t * 3 + 2] as number;
      const coal = nCoal.fbm(x * 9, y * 9, z * 9, 3) + (m < 0.45 ? 0.15 : 0);
      const iron = nIron.fbm(x * 9 + 3, y * 9, z * 9, 3) + (m > 0.35 ? 0.1 : -0.2);
      const gold = nGold.fbm(x * 11, y * 11 - 5, z * 11, 3) + (m > 0.55 ? 0.05 : -0.5);
      const best = Math.max(coal, iron, gold);
      let d = Deposit.Granite;
      if (best > 0.12) d = best === coal ? Deposit.Coal : best === iron ? Deposit.Iron : Deposit.Gold;
      else if (m < 0.3) continue;
      this.deposit[t] = d;
      this.depositAmount[t] = Math.min(255, Math.round(8 + m * 20 + Math.max(0, best) * 30));
    }
  }

  isMountain(t: number): boolean {
    const e = this.planet.terrain.elevation[t] as number;
    const b = this.planet.terrain.biome[t] as Biome;
    return e > this.planet.terrain.params.mountainHeight * 0.3 || b === Biome.Rock || b === Biome.Snow;
  }

  /** Water within two steps. */
  isCoast(t: number): boolean {
    if (!this.isLand(t)) return false;
    for (const n of this.ring(t, 2)) if (!this.isLand(n)) return true;
    return false;
  }

  /** Building-specific placement: terrain rules on top of canBuild. */
  canBuildDef(t: number, flagTile: number, def: BuildingDef, owner = 0): boolean {
    if (def.terrain === "mountain") {
      if (!this.isMountain(t)) return false;
      return this.canBuild(t, flagTile, !!def.large, owner, 3.2);
    }
    if (def.terrain === "coast" && !this.isCoast(t)) return false;
    if (def.terrain === "aquifer" && (this.aquifer?.[t] ?? 0) < 0.35) return false;
    if (def.terrain === "vent" && !this.nearVent(t)) return false;
    if (def.terrain === "saltpan" && this.region[t] !== Region.SaltglassFlats && !this.isCoast(t)) return false;
    if (def.terrain === "skyreef" && this.region[t] !== Region.Skyreef && !this.ring(t, 2).some((m) => this.region[m] === Region.Skyreef)) return false;
    // Treehouses go up an ancient giant (which stays standing).
    if (def.terrain === "giant") return this.feature[t] === Feature.Giant && this.variety[t] === 0 && this.canBuild(t, flagTile, false, owner, 1.8, true);
    return this.canBuild(t, flagTile, !!def.large, owner);
  }

  isLand(t: number): boolean {
    return (this.planet.terrain.elevation[t] as number) > 0.05 && this.hydro?.lake[t] !== 1;
  }

  /** Height difference to the steepest neighbour, in world units. */
  slope(t: number): number {
    const e = this.planet.terrain.elevation;
    const h = e[t] as number;
    let m = 0;
    for (const n of this.planet.grid.neighborsOf(t)) m = Math.max(m, Math.abs((e[n] as number) - h));
    return m;
  }

  /** Settlers can walk here (land or lake ice, not a building, no rock, not too steep). */
  walkable(t: number): boolean {
    if (this.flooded[t] && !this.causeway[t]) return false;
    const f = this.feature[t];
    return (this.isLand(t) || this.isIce(t)) && this.use[t] !== Use.Building && f !== Feature.Rock && f !== Feature.Giant && f !== Feature.Vent && f !== Feature.Spire && f !== Feature.Ruin;
  }

  /** A flag or road of `owner` may go here. */
  roadable(t: number, owner = 0): boolean {
    // Ice roads: frozen lakes can be crossed (until they thaw).
    if (this.isIce(t)) return this.mayRoad(t, owner) && this.use[t] === Use.Free;
    return (
      this.isLand(t) &&
      this.mayRoad(t, owner) &&
      (this.use[t] === Use.Free || this.use[t] === Use.Blocked) &&
      this.feature[t] !== Feature.Tree &&
      this.feature[t] !== Feature.Rock &&
      this.feature[t] !== Feature.Hedge &&
      this.feature[t] !== Feature.Giant &&
      this.feature[t] !== Feature.Field &&
      this.feature[t] !== Feature.Vent &&
      this.feature[t] !== Feature.Spire &&
      this.feature[t] !== Feature.Glowcap &&
      this.slope(t) < 2.2
    );
  }

  /** Own land, or a partner's under a shared-roads treaty. */
  mayRoad(t: number, owner: number): boolean {
    const o = this.territory[t] as number;
    return o === owner + 1 || (o > 0 && ((this.roadShare[owner] ?? 0) & (1 << (o - 1))) !== 0);
  }

  canPlaceFlag(t: number, owner = 0): boolean {
    if (!(this.roadable(t, owner) || this.use[t] === Use.Road)) return false;
    if (this.use[t] === Use.Blocked) return false;
    // Flags need breathing room: no neighbouring flag.
    for (const n of this.planet.grid.neighborsOf(t)) if (this.use[n] === Use.Flag) return false;
    return this.territory[t] === owner + 1;
  }

  /** A building may stand on `t` with its flag on `flagTile` (a neighbour). */
  canBuild(t: number, flagTile: number, large = false, owner = 0, maxSlope = 1.3, onGiant = false): boolean {
    const grid = this.planet.grid;
    if (!this.isLand(t) || this.territory[t] !== owner + 1) return false;
    const f = this.feature[t];
    if (this.use[t] !== Use.Free || (!onGiant && (f === Feature.Tree || f === Feature.Rock || f === Feature.Field || f === Feature.Hedge || f === Feature.Giant || f === Feature.Vent || f === Feature.Spire || f === Feature.Glowcap || f === Feature.Ruin))) return false;
    if (grid.degree(t) === 5) return false; // Star Wells are sacred ground.
    if (this.slope(t) > maxSlope) return false;
    if (!grid.neighborsOf(t).includes(flagTile)) return false;
    if (!(this.use[flagTile] === Use.Flag ? this.territory[flagTile] === owner + 1 : this.canPlaceFlag(flagTile, owner))) return false;
    for (const n of grid.neighborsOf(t)) {
      if (this.use[n] === Use.Building) return false;
      if (large && n !== flagTile && (this.use[n] !== Use.Free || this.feature[n] === Feature.Rock)) return false;
    }
    return true;
  }

  /** Neighbour of `t` best suited as its flag: an existing flag first, else the flattest valid spot. */
  bestFlagTile(t: number, owner = 0): number {
    const grid = this.planet.grid;
    let best = -1;
    let bestScore = Infinity;
    for (const n of grid.neighborsOf(t)) {
      if (this.use[n] === Use.Flag) return this.territory[n] === owner + 1 ? n : -1;
      if (!this.canPlaceFlag(n, owner)) continue;
      const s = Math.abs((this.planet.terrain.elevation[n] as number) - (this.planet.terrain.elevation[t] as number)) * 10 + n * 1e-9;
      if (s < bestScore) {
        bestScore = s;
        best = n;
      }
    }
    return best;
  }

  /** Claim unowned tiles within `radius` steps of `center` for `owner`. */
  claim(center: number, radius: number, owner = 0): void {
    const grid = this.planet.grid;
    const dist = new Map<number, number>([[center, 0]]);
    const queue = [center];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i] as number;
      const d = dist.get(t) as number;
      if (this.territory[t] === 0) this.territory[t] = owner + 1;
      if (d >= radius) continue;
      for (const n of grid.neighborsOf(t)) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
    this.territoryVersion++;
  }

  /** Tiles within `radius` steps of `center`, nearest first (ties by tile index). */
  ring(center: number, radius: number): number[] {
    const grid = this.planet.grid;
    const seen = new Set<number>([center]);
    let frontier = [center];
    const out: number[] = [];
    for (let d = 1; d <= radius; d++) {
      const next: number[] = [];
      for (const t of frontier) for (const n of grid.neighborsOf(t)) if (!seen.has(n)) {
        seen.add(n);
        next.push(n);
      }
      next.sort((a, b) => a - b);
      out.push(...next);
      frontier = next;
    }
    return out;
  }

  /** Cost of stepping from a to b: longer uphill, cheaper on roads. */
  stepCost(a: number, b: number): number {
    const road = this.use[b] === Use.Road || this.use[b] === Use.Flag;
    // Lake ice is flat: sledges fly over it on a road, feet slip and slide off one.
    if (this.isIce(b)) return road ? 0.5 : 1.15;
    const e = this.planet.terrain.elevation;
    const dh = (e[b] as number) - (e[a] as number);
    const snow = this.snowCover[b] as number;
    let base: number;
    if (road) {
      // Roads are packed and swept: on snow the carriers take to sledges and go faster.
      base = (snow > 0.3 ? 0.55 : 0.7) * (1 + 0.5 * (this.mud[b] as number)) * (1 + 1.5 * (this.sand[b] as number));
    } else {
      // Fording a river is slow; mud slows everyone; snow is deeper in the Rimefall drifts.
      const drift = this.region[b] === Region.RimefallTundra ? 0.9 : 0.4;
      base = (this.isRiver(b) ? 1.4 : 1) * (1 + 0.5 * (this.mud[b] as number) + drift * snow);
      // Bitter cold saps walkers far from any hearth.
      if (this.chill[b] && !this.warm[b]) base *= 1.35;
    }
    // Lumen Mire nights are dark: slow going where nothing glows.
    if (this.dim[b]) base *= 1.3;
    return base * (1 + Math.max(0, dh) * 0.6 + Math.max(0, -dh) * 0.15) * this.lightness;
  }

  /** Carriers here ride a sledge (a road over snow or ice); for visuals. */
  sledging(t: number): boolean {
    return (this.use[t] === Use.Road || this.use[t] === Use.Flag) && (this.isIce(t) || (this.snowCover[t] as number) > 0.3);
  }

  /** A* over tiles. `ok` decides which tiles may be entered (the goal is always allowed). */
  findPath(from: number, to: number, ok: (t: number) => boolean, maxNodes = 6000): number[] | null {
    if (from === to) return [from];
    const grid = this.planet.grid;
    const c = grid.center;
    const tx = c[to * 3] as number;
    const ty = c[to * 3 + 1] as number;
    const tz = c[to * 3 + 2] as number;
    const h = (t: number) => {
      const dx = (c[t * 3] as number) - tx;
      const dy = (c[t * 3 + 1] as number) - ty;
      const dz = (c[t * 3 + 2] as number) - tz;
      return (Math.sqrt(dx * dx + dy * dy + dz * dz) / this.spacing) * 0.7;
    };
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open = new MinHeap();
    open.push(from, h(from));
    const closed = new Set<number>();
    let expanded = 0;
    while (open.size > 0) {
      const cur = open.pop();
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (++expanded > maxNodes) return null;
      const gc = g.get(cur) as number;
      for (const n of grid.neighborsOf(cur)) {
        if (closed.has(n) || (n !== to && !ok(n))) continue;
        const ng = gc + this.stepCost(cur, n);
        const old = g.get(n);
        if (old === undefined || ng < old) {
          g.set(n, ng);
          came.set(n, cur);
          open.push(n, ng + h(n));
        }
      }
    }
    if (!came.has(to)) return null;
    const path = [to];
    let t = to;
    while (t !== from) {
      t = came.get(t) as number;
      path.push(t);
    }
    return path.reverse();
  }
}
