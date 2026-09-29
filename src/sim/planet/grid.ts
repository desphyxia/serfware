import type { Rng } from "../rng";
import { buildGeodesic, buildRings, vertexCountFor } from "./geodesic";
import { relaxToTargets } from "./relax";
import { assignTargets, generateWellTargets, norm, randomRotation, rotate, WELL_STYLES, type Vec3, type WellStyle } from "./wells";

/**
 * The planet's tile grid. Tiles are the vertices of a relaxed geodesic triangulation; a tile's
 * polygon corners are the centroids of the triangles around it. 12 tiles are pentagons (Star
 * Wells), every other tile is a hexagon.
 */
export class PlanetGrid {
  constructor(
    readonly count: number,
    /** Unit-sphere tile centres, xyz per tile. */
    readonly center: Float64Array,
    /** CSR offsets into `neighbors` / `cornerOf`, length count + 1. Ring order is counter-clockwise. */
    readonly start: Int32Array,
    readonly neighbors: Int32Array,
    /** Corner index per ring slot (corner k lies between neighbors[k] and neighbors[k + 1]). */
    readonly cornerOf: Int32Array,
    /** Unit-sphere corner positions, xyz per corner (one per triangle). */
    readonly corners: Float64Array,
    /** The three tiles around each corner. */
    readonly cornerTiles: Uint32Array,
    /** Tile area relative to the average tile (1 = average). */
    readonly area: Float64Array,
    readonly pentagons: readonly number[],
    readonly wellStyle: WellStyle,
  ) {}

  degree(t: number): number {
    return (this.start[t + 1] as number) - (this.start[t] as number);
  }

  neighborsOf(t: number): Int32Array {
    return this.neighbors.subarray(this.start[t] as number, this.start[t + 1] as number);
  }

  cornersOf(t: number): Int32Array {
    return this.cornerOf.subarray(this.start[t] as number, this.start[t + 1] as number);
  }

  centerOf(t: number): Vec3 {
    return [this.center[t * 3] as number, this.center[t * 3 + 1] as number, this.center[t * 3 + 2] as number];
  }

  /** Walk from a start tile toward the direction d until no neighbour is closer. */
  nearestTile(d: Vec3, from = 0): number {
    let cur = from;
    let best = this.dotTo(cur, d);
    for (;;) {
      let next = cur;
      for (const n of this.neighborsOf(cur)) {
        const s = this.dotTo(n, d);
        if (s > best) {
          best = s;
          next = n;
        }
      }
      if (next === cur) return cur;
      cur = next;
    }
  }

  private dotTo(t: number, d: Vec3): number {
    return (this.center[t * 3] as number) * d[0] + (this.center[t * 3 + 1] as number) * d[1] + (this.center[t * 3 + 2] as number) * d[2];
  }
}

export const GRID_SIZES = {
  tiny: 16, // 2,562 tiles
  small: 20, // 4,002 tiles
  medium: 32, // 10,242 tiles
  large: 41, // 16,812 tiles
  huge: 64, // 40,962 tiles
} as const;

export type GridSize = keyof typeof GRID_SIZES;

export function tileCount(size: GridSize): number {
  return vertexCountFor(GRID_SIZES[size]);
}

export function buildPlanetGrid(freq: number, rng: Rng, forcedStyle?: WellStyle): PlanetGrid {
  const geo = buildGeodesic(freq);
  const rings = buildRings(geo);
  const V = geo.vertexCount;
  const pentagons = Array.from({ length: 12 }, (_, i) => i);

  // Randomly orient the icosahedron, then move its twelve corners to seeded Star Well targets.
  const rot = randomRotation(rng);
  const rotated = new Float64Array(V * 3);
  for (let v = 0; v < V; v++) {
    const p = rotate(rot, [geo.pos[v * 3] as number, geo.pos[v * 3 + 1] as number, geo.pos[v * 3 + 2] as number]);
    rotated[v * 3] = p[0];
    rotated[v * 3 + 1] = p[1];
    rotated[v * 3 + 2] = p[2];
  }
  const style = forcedStyle ?? rng.pick(WELL_STYLES);
  const sources: Vec3[] = pentagons.map((p) => [rotated[p * 3] as number, rotated[p * 3 + 1] as number, rotated[p * 3 + 2] as number]);
  const wanted = generateWellTargets(rng, style, sources);
  const assignment = assignTargets(sources, wanted);
  let targets: Vec3[] = pentagons.map((_, i) => wanted[assignment[i] as number] as Vec3);

  let pos = rotated;
  for (let attempt = 0; attempt < 6; attempt++) {
    pos = rotated.slice();
    if (relaxToTargets(pos, geo.tris, rings, pentagons, targets)) break;
    // Folded: pull targets 35 % back toward the regular positions and try again.
    targets = targets.map((t, i) => {
      const s = sources[i] as Vec3;
      return norm([t[0] + (s[0] - t[0]) * 0.35, t[1] + (s[1] - t[1]) * 0.35, t[2] + (s[2] - t[2]) * 0.35]);
    });
  }

  // Corners: centroid of each triangle.
  const triCount = geo.tris.length / 3;
  const corners = new Float64Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = (geo.tris[t * 3] as number) * 3;
    const b = (geo.tris[t * 3 + 1] as number) * 3;
    const c = (geo.tris[t * 3 + 2] as number) * 3;
    const p = norm([
      (pos[a] as number) + (pos[b] as number) + (pos[c] as number),
      (pos[a + 1] as number) + (pos[b + 1] as number) + (pos[c + 1] as number),
      (pos[a + 2] as number) + (pos[b + 2] as number) + (pos[c + 2] as number),
    ]);
    corners[t * 3] = p[0];
    corners[t * 3 + 1] = p[1];
    corners[t * 3 + 2] = p[2];
  }

  // Tile areas as planar fans on the unit sphere, normalised to the mean.
  const area = new Float64Array(V);
  let sum = 0;
  for (let v = 0; v < V; v++) {
    const s = rings.start[v] as number;
    const e = rings.start[v + 1] as number;
    const cx = pos[v * 3] as number;
    const cy = pos[v * 3 + 1] as number;
    const cz = pos[v * 3 + 2] as number;
    let acc = 0;
    for (let k = s; k < e; k++) {
      const c1 = (rings.triangles[k] as number) * 3;
      const c2 = (rings.triangles[k + 1 < e ? k + 1 : s] as number) * 3;
      const ax = (corners[c1] as number) - cx;
      const ay = (corners[c1 + 1] as number) - cy;
      const az = (corners[c1 + 2] as number) - cz;
      const bx = (corners[c2] as number) - cx;
      const by = (corners[c2 + 1] as number) - cy;
      const bz = (corners[c2 + 2] as number) - cz;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      acc += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    }
    area[v] = acc;
    sum += acc;
  }
  const mean = sum / V;
  for (let v = 0; v < V; v++) area[v] = (area[v] as number) / mean;

  return new PlanetGrid(V, pos, rings.start, rings.neighbors, rings.triangles, corners, geo.tris, area, pentagons, style);
}
