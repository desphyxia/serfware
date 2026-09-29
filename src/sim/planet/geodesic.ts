/**
 * Geodesic triangulation of the sphere: an icosahedron with each face split into freq² triangles.
 * Every vertex has six neighbours except the twelve original corners, which have five. The dual
 * of this triangulation is a hex grid with exactly twelve pentagons, which later get moved to
 * seeded positions (see wells.ts and relax.ts).
 */

const T = (1 + Math.sqrt(5)) / 2;

export const ICO_VERTICES: readonly number[] = [
  -1, T, 0, 1, T, 0, -1, -T, 0, 1, -T, 0, 0, -1, T, 0, 1, T, 0, -1, -T, 0, 1, -T, T, 0, -1, T, 0, 1, -T, 0, -1, -T, 0, 1,
];

export const ICO_FACES: readonly number[] = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3,
  6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

export interface Triangulation {
  /** Unit-sphere positions, xyz per vertex. */
  pos: Float64Array;
  /** Vertex indices, three per triangle, counter-clockwise seen from outside. */
  tris: Uint32Array;
  vertexCount: number;
}

export function vertexCountFor(freq: number): number {
  return 10 * freq * freq + 2;
}

export function buildGeodesic(freq: number): Triangulation {
  if (freq < 1 || !Number.isInteger(freq)) throw new Error(`Invalid frequency ${freq}`);
  const V = vertexCountFor(freq);
  const pos = new Float64Array(V * 3);
  let next = 0;
  const add = (x: number, y: number, z: number): number => {
    const l = Math.sqrt(x * x + y * y + z * z);
    pos[next * 3] = x / l;
    pos[next * 3 + 1] = y / l;
    pos[next * 3 + 2] = z / l;
    return next++;
  };
  const corner = (i: number): [number, number, number] => [
    ICO_VERTICES[i * 3] as number,
    ICO_VERTICES[i * 3 + 1] as number,
    ICO_VERTICES[i * 3 + 2] as number,
  ];
  for (let i = 0; i < 12; i++) add(...corner(i));

  // Points along each of the 30 edges, stored from the lower to the higher corner index.
  const edges = new Map<number, number[]>();
  const edgePoints = (u: number, v: number): number[] => {
    const lo = Math.min(u, v);
    const hi = Math.max(u, v);
    const key = lo * 12 + hi;
    let arr = edges.get(key);
    if (!arr) {
      arr = [];
      const [ax, ay, az] = corner(lo);
      const [bx, by, bz] = corner(hi);
      for (let k = 1; k < freq; k++) {
        const t = k / freq;
        arr.push(add(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
      }
      edges.set(key, arr);
    }
    return arr;
  };
  const onEdge = (u: number, v: number, k: number): number => {
    const arr = edgePoints(u, v);
    return (u < v ? arr[k - 1] : arr[freq - 1 - k]) as number;
  };

  const tris: number[] = [];
  for (let f = 0; f < 20; f++) {
    const a = ICO_FACES[f * 3] as number;
    const b = ICO_FACES[f * 3 + 1] as number;
    const c = ICO_FACES[f * 3 + 2] as number;
    // Make sure all three edges exist before interior points, for a stable vertex order.
    edgePoints(a, b);
    edgePoints(a, c);
    edgePoints(b, c);
    const [ax, ay, az] = corner(a);
    const [bx, by, bz] = corner(b);
    const [cx, cy, cz] = corner(c);
    const interior = new Map<number, number>();
    const idx = (i: number, j: number): number => {
      if (i === 0 && j === 0) return a;
      if (i === freq) return b;
      if (j === freq) return c;
      if (j === 0) return onEdge(a, b, i);
      if (i === 0) return onEdge(a, c, j);
      if (i + j === freq) return onEdge(b, c, j);
      const key = i * (freq + 1) + j;
      let v = interior.get(key);
      if (v === undefined) {
        const wa = (freq - i - j) / freq;
        const wb = i / freq;
        const wc = j / freq;
        v = add(ax * wa + bx * wb + cx * wc, ay * wa + by * wb + cy * wc, az * wa + bz * wb + cz * wc);
        interior.set(key, v);
      }
      return v;
    };
    for (let i = 0; i < freq; i++) {
      for (let j = 0; j < freq - i; j++) {
        tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1));
        if (i + j < freq - 1) tris.push(idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
      }
    }
  }
  if (next !== V) throw new Error(`Geodesic vertex count mismatch: ${next} != ${V}`);
  return { pos, tris: Uint32Array.from(tris), vertexCount: V };
}

/**
 * For every vertex, its neighbours and incident triangles in counter-clockwise order.
 * Built by walking triangle fans, so no angle sorting (and no trigonometry) is needed.
 */
export interface Rings {
  start: Int32Array; // CSR offsets, length V + 1
  neighbors: Int32Array; // neighbour vertex per ring slot
  triangles: Int32Array; // triangle between neighbors[k] and neighbors[k + 1] per ring slot
}

export function buildRings(t: Triangulation): Rings {
  const V = t.vertexCount;
  const triCount = t.tris.length / 3;
  const degree = new Int32Array(V);
  for (let i = 0; i < t.tris.length; i++) degree[t.tris[i] as number]!++;
  const start = new Int32Array(V + 1);
  for (let v = 0; v < V; v++) start[v + 1] = (start[v] as number) + (degree[v] as number);
  const total = start[V] as number;
  // For each vertex: for the triangle (v, x, y) in CCW order, record x -> (y, tri).
  const nextOf = new Int32Array(total).fill(-1);
  const fromOf = new Int32Array(total);
  const triOf = new Int32Array(total);
  const fill = new Int32Array(V);
  for (let tr = 0; tr < triCount; tr++) {
    for (let k = 0; k < 3; k++) {
      const v = t.tris[tr * 3 + k] as number;
      const x = t.tris[tr * 3 + ((k + 1) % 3)] as number;
      const y = t.tris[tr * 3 + ((k + 2) % 3)] as number;
      const slot = (start[v] as number) + fill[v]!++;
      fromOf[slot] = x;
      nextOf[slot] = y;
      triOf[slot] = tr;
    }
  }
  const neighbors = new Int32Array(total);
  const triangles = new Int32Array(total);
  for (let v = 0; v < V; v++) {
    const s = start[v] as number;
    const d = (start[v + 1] as number) - s;
    // Start from the slot whose "from" vertex is smallest, for a canonical order.
    let cur = s;
    for (let k = s + 1; k < s + d; k++) if ((fromOf[k] as number) < (fromOf[cur] as number)) cur = k;
    for (let k = 0; k < d; k++) {
      neighbors[s + k] = fromOf[cur] as number;
      triangles[s + k] = triOf[cur] as number;
      const want = nextOf[cur] as number;
      let found = -1;
      for (let m = s; m < s + d; m++) {
        if (fromOf[m] === want) {
          found = m;
          break;
        }
      }
      if (found < 0 && k < d - 1) throw new Error(`Broken fan around vertex ${v}`);
      cur = found;
    }
  }
  return { start, neighbors, triangles };
}
