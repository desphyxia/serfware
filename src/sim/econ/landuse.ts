import type { Planet } from "../planet/planet";
import { Biome } from "../planet/terrain";
import type { Rng } from "../rng";
import { MinHeap } from "./heap";

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
}

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
  /** Footpath wear from settlers walking off-road (desire paths). */
  readonly wear: Uint16Array;
  wearVersion = 0;
  /** Bumped whenever features change; renderers rebuild when it moves. */
  featureVersion = 0;
  useVersion = 0;
  territoryVersion = 0;
  /** Typical angle between neighbouring tile centres. */
  readonly spacing: number;

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
    this.spacing = Math.sqrt((4 * Math.PI) / n);
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
      } else if (r < tree + rock) {
        this.feature[t] = Feature.Rock;
        this.amount[t] = rng.int(4, 9);
        this.variety[t] = rng.int(0, 3);
      }
    }
    this.featureVersion++;
  }

  isLand(t: number): boolean {
    return (this.planet.terrain.elevation[t] as number) > 0.05;
  }

  /** Height difference to the steepest neighbour, in world units. */
  slope(t: number): number {
    const e = this.planet.terrain.elevation;
    const h = e[t] as number;
    let m = 0;
    for (const n of this.planet.grid.neighborsOf(t)) m = Math.max(m, Math.abs((e[n] as number) - h));
    return m;
  }

  /** Settlers can walk here (land, not a building, no rock, not too steep). */
  walkable(t: number): boolean {
    return this.isLand(t) && this.use[t] !== Use.Building && this.feature[t] !== Feature.Rock;
  }

  /** A flag or road of `owner` may go here. */
  roadable(t: number, owner = 0): boolean {
    return (
      this.isLand(t) &&
      this.territory[t] === owner + 1 &&
      (this.use[t] === Use.Free || this.use[t] === Use.Blocked) &&
      this.feature[t] !== Feature.Tree &&
      this.feature[t] !== Feature.Rock &&
      this.slope(t) < 2.2
    );
  }

  canPlaceFlag(t: number, owner = 0): boolean {
    if (!(this.roadable(t, owner) || this.use[t] === Use.Road)) return false;
    if (this.use[t] === Use.Blocked) return false;
    // Flags need breathing room: no neighbouring flag.
    for (const n of this.planet.grid.neighborsOf(t)) if (this.use[n] === Use.Flag) return false;
    return this.territory[t] === owner + 1;
  }

  /** A building may stand on `t` with its flag on `flagTile` (a neighbour). */
  canBuild(t: number, flagTile: number, large = false, owner = 0): boolean {
    const grid = this.planet.grid;
    if (!this.isLand(t) || this.territory[t] !== owner + 1) return false;
    if (this.use[t] !== Use.Free || this.feature[t] === Feature.Tree || this.feature[t] === Feature.Rock) return false;
    if (grid.degree(t) === 5) return false; // Star Wells are sacred ground.
    if (this.slope(t) > 1.3) return false;
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
    const e = this.planet.terrain.elevation;
    const dh = (e[b] as number) - (e[a] as number);
    const base = this.use[b] === Use.Road || this.use[b] === Use.Flag ? 0.7 : 1;
    return base * (1 + Math.max(0, dh) * 0.6 + Math.max(0, -dh) * 0.15);
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
