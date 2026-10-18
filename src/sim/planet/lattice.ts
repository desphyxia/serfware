import { MinHeap } from "../econ/heap";
import type { PlanetGrid } from "./grid";

/**
 * Spike: a finer road lattice over the tile grid. Its nodes are the tile centres and the tile
 * corners; its edges are the hexagon borders (corner to corner) and the spokes (centre to its
 * corners). Every corner joins 3 borders and 3 spokes, every centre joins one spoke per corner
 * (6, or 5 at a Star Well), so the nodes form a triangular lattice, as Serf City's flags do, and
 * the ring of nodes around a tile centre is that tile's own border.
 *
 * Node `t` below `tiles` is tile t's centre; node `tiles + c` is grid corner c.
 */
export class HexLattice {
  readonly tiles: number;
  readonly count: number;
  /** Unit-sphere position per node, xyz. */
  readonly pos: Float64Array;
  readonly start: Int32Array;
  readonly nbrs: Int32Array;
  /** Mean edge length on the unit sphere, so costs are in "steps". */
  readonly unit: number;

  constructor(readonly grid: PlanetGrid) {
    const T = grid.count;
    const C = grid.corners.length / 3;
    this.tiles = T;
    this.count = T + C;
    this.pos = new Float64Array(this.count * 3);
    this.pos.set(grid.center, 0);
    this.pos.set(grid.corners, T * 3);
    const adj: Set<number>[] = Array.from({ length: this.count }, () => new Set<number>());
    const link = (a: number, b: number) => {
      adj[a]!.add(b);
      adj[b]!.add(a);
    };
    for (let t = 0; t < T; t++) {
      const cs = grid.cornersOf(t);
      for (let k = 0; k < cs.length; k++) {
        const c = T + (cs[k] as number);
        link(t, c); // the spoke
        link(c, T + (cs[(k + 1) % cs.length] as number)); // the border to the next corner
      }
    }
    const start = new Int32Array(this.count + 1);
    for (let n = 0; n < this.count; n++) start[n + 1] = (start[n] as number) + adj[n]!.size;
    const nbrs = new Int32Array(start[this.count] as number);
    let len = 0;
    let edges = 0;
    for (let n = 0; n < this.count; n++) {
      // Sorted so the lattice is the same everywhere (the order of a Set follows insertion).
      const list = [...adj[n]!].sort((a, b) => a - b);
      nbrs.set(list, start[n] as number);
      for (const m of list) if (m > n) {
        len += this.dist(n, m);
        edges++;
      }
    }
    this.start = start;
    this.nbrs = nbrs;
    this.unit = len / edges;
  }

  isCentre(n: number): boolean {
    return n < this.tiles;
  }

  /** The lattice node of grid corner c. */
  cornerNode(c: number): number {
    return this.tiles + c;
  }

  neighborsOf(n: number): Int32Array {
    return this.nbrs.subarray(this.start[n] as number, this.start[n + 1] as number);
  }

  degree(n: number): number {
    return (this.start[n + 1] as number) - (this.start[n] as number);
  }

  /** Straight-line distance between two nodes on the unit sphere. */
  dist(a: number, b: number): number {
    const p = this.pos;
    return Math.sqrt(((p[a * 3] as number) - (p[b * 3] as number)) ** 2 + ((p[a * 3 + 1] as number) - (p[b * 3 + 1] as number)) ** 2 + ((p[a * 3 + 2] as number) - (p[b * 3 + 2] as number)) ** 2);
  }

  /** The tile a node belongs to: itself for a centre, the first of its three tiles for a corner. */
  tileOf(n: number): number {
    return n < this.tiles ? n : (this.grid.cornerTiles[(n - this.tiles) * 3] as number);
  }

  /** Cost of the bend at `cur` when going prev -> cur -> next: free when straight, more for sharper turns. */
  private bend(prev: number, cur: number, next: number): number {
    const p = this.pos;
    let dot = 0;
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < 3; i++) {
      const a = (p[cur * 3 + i] as number) - (p[prev * 3 + i] as number);
      const b = (p[next * 3 + i] as number) - (p[cur * 3 + i] as number);
      dot += a * b;
      l1 += a * a;
      l2 += b * b;
    }
    const cos = dot / Math.sqrt(l1 * l2);
    return cos > 0.85 ? 0 : cos > 0 ? 1 : 2;
  }

  /** A* from one node to another over nodes `ok` allows; keeps straight and turns only when it pays. */
  findPath(from: number, to: number, ok: (n: number) => boolean = () => true, maxNodes = 20000): number[] | null {
    if (from === to) return [from];
    const N = this.count + 1;
    const none = this.count;
    const h = (n: number) => (this.dist(n, to) / this.unit) * 0.8;
    const g = new Map<number, number>([[from * N + none, 0]]);
    const came = new Map<number, number>();
    const open = new MinHeap();
    open.push(from * N + none, h(from));
    const closed = new Set<number>();
    let expanded = 0;
    let end = -1;
    while (open.size > 0) {
      const state = open.pop();
      const cur = Math.floor(state / N);
      const prev = state - cur * N;
      if (cur === to) {
        end = state;
        break;
      }
      if (closed.has(state)) continue;
      closed.add(state);
      if (++expanded > maxNodes) return null;
      const gc = g.get(state) as number;
      for (const nb of this.neighborsOf(cur)) {
        if (nb === prev || (nb !== to && !ok(nb))) continue;
        const ng = gc + this.dist(cur, nb) / this.unit + (prev === none ? 0 : this.bend(prev, cur, nb));
        const ns = nb * N + cur;
        const old = g.get(ns);
        if (old === undefined || ng < old) {
          g.set(ns, ng);
          came.set(ns, state);
          open.push(ns, ng + h(nb));
        }
      }
    }
    if (end < 0) return null;
    const path: number[] = [];
    for (let s = end; ; s = came.get(s) as number) {
      const n = Math.floor(s / N);
      path.push(n);
      if (n === from && !came.has(s)) break;
    }
    return path.reverse();
  }
}
