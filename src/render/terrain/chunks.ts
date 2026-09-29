import * as THREE from "three/webgpu";
import type { Planet } from "../../sim/planet/planet";
import type { TerrainField } from "./field";

/** Tiles per chunk (grown by breadth-first search, so chunks are compact patches). */
const CHUNK_TILES = 48;
/** Skirts hang this far below chunk borders to hide cracks between detail levels. */
const SKIRT = 1.2;
/** Seconds a chunk takes to morph between detail levels (no popping). */
const MORPH_TIME = 0.3;

interface Chunk {
  id: number;
  tiles: number[];
  /** Unit direction of the chunk's middle. */
  center: THREE.Vector3;
  level: number;
  mesh: THREE.Mesh | null;
  dirty: boolean;
  /** 0 = showing the next-coarser shape, 1 = the full detail of `level`. */
  morph: number;
  /** Level being faded down to before the mesh is swapped, or -1. */
  coarsenTo: number;
}

export interface ChunkStats {
  chunks: number;
  built: number;
  triangles: number;
  levels: number[];
}

/**
 * The planet's ground, split into chunks that refine near the camera: detail level 0 (tile fans)
 * far away up to level 3 (each tile fan subdivided three times, several hundred vertices per tile)
 * close in. Vertices sit on the terrain field; normals come from the field itself, so lighting
 * is continuous across chunks, and skirts hide the small gaps where detail levels meet.
 */
export class ChunkedTerrain {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  readonly tileChunk: Int32Array;
  private maxLevel: number;
  private triangles = 0;
  private lastUpdate = 0;

  constructor(
    private readonly planet: Planet,
    private readonly field: TerrainField,
    readonly material: THREE.Material,
    detail: "low" | "medium" | "high",
  ) {
    this.maxLevel = detail === "low" ? 2 : detail === "medium" ? 3 : 3;
    const { grid } = planet;
    this.tileChunk = new Int32Array(grid.count).fill(-1);
    for (let seed = 0; seed < grid.count; seed++) {
      if (this.tileChunk[seed] !== -1) continue;
      const id = this.chunks.length;
      const tiles: number[] = [];
      const queue = [seed];
      this.tileChunk[seed] = id;
      for (let i = 0; i < queue.length && tiles.length < CHUNK_TILES; i++) {
        const t = queue[i] as number;
        tiles.push(t);
        for (const n of grid.neighborsOf(t)) {
          if (this.tileChunk[n] !== -1 || queue.length >= CHUNK_TILES) continue;
          this.tileChunk[n] = id;
          queue.push(n);
        }
      }
      // Anything queued but not taken goes back to the pool.
      for (const t of queue) if (!tiles.includes(t)) this.tileChunk[t] = -1;
      const center = new THREE.Vector3();
      for (const t of tiles) center.add(new THREE.Vector3(...grid.centerOf(t)));
      center.normalize();
      this.chunks.push({ id, tiles, center, level: -1, mesh: null, dirty: true, morph: 1, coarsenTo: -1 });
    }
    this.group.name = "terrain";
  }

  /** Detail level a chunk should have for a camera at `cam` (world position). */
  private wantLevel(c: Chunk, cam: THREE.Vector3): number {
    const R = this.planet.params.radius;
    const d = cam.distanceTo(c.center.clone().multiplyScalar(R));
    const s = this.field.spacing * R; // world units per tile
    const lvl = d < s * 15 ? 3 : d < s * 30 ? 2 : d < s * 60 ? 1 : 0;
    // Chunks on the far side of the planet stay coarse.
    const facing = c.center.dot(cam.clone().normalize());
    return Math.min(this.maxLevel, facing < -0.2 ? 0 : lvl);
  }

  /**
   * Bring chunks toward the detail they need, nearest first, within a time budget.
   * Returns how many chunks were rebuilt.
   */
  update(cam: THREE.Vector3, budgetMs = 6): number {
    const t0 = performance.now();
    const dt = this.lastUpdate ? Math.min(0.1, (t0 - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = t0;
    const instant = budgetMs === Infinity;
    const step = instant ? 1 : dt / MORPH_TIME;
    const todo: { c: Chunk; lvl: number; d: number }[] = [];
    for (const c of this.chunks) {
      const lvl = this.wantLevel(c, cam);
      // Morph newly refined chunks up to full detail.
      if (c.coarsenTo < 0 && c.morph < 1) c.morph = Math.min(1, c.morph + step);
      if (c.mesh) c.mesh.userData.morph = c.morph;
      if (c.dirty || c.level < 0 || instant) {
        if (lvl !== c.level || c.dirty) todo.push({ c, lvl, d: cam.distanceToSquared(c.center.clone().multiplyScalar(this.planet.params.radius)) });
        continue;
      }
      if (lvl < c.level) {
        // Coarsening: fade the current mesh down to its coarser shape first, then swap.
        if (c.coarsenTo < 0) c.coarsenTo = lvl;
        c.morph = Math.max(0, c.morph - step);
        if (c.mesh) c.mesh.userData.morph = c.morph;
        if (c.morph <= 0) todo.push({ c, lvl: c.level - 1, d: 0 });
        continue;
      }
      c.coarsenTo = -1;
      // Refining one level at a time, so each step can morph in from the shape before it.
      if (lvl > c.level && c.morph >= 1) todo.push({ c, lvl: c.level + 1, d: cam.distanceToSquared(c.center.clone().multiplyScalar(this.planet.params.radius)) });
    }
    todo.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const { c, lvl } of todo) {
      if (n > 0 && performance.now() - t0 > budgetMs) break;
      const refining = !instant && !c.dirty && c.level >= 0 && lvl > c.level;
      const coarsening = c.coarsenTo >= 0;
      this.build(c, lvl);
      // A refined chunk starts at its coarse shape and morphs in; a coarsened one arrives at
      // exactly the shape it faded to, and keeps fading if it must go coarser still.
      c.morph = refining ? 0 : 1;
      if (coarsening) {
        const target = c.coarsenTo;
        c.coarsenTo = lvl > target ? target : -1;
        c.morph = 1;
      }
      if (c.mesh) c.mesh.userData.morph = c.morph;
      n++;
    }
    return n;
  }

  /** Build every chunk now at the level it needs (initial load). */
  buildAll(cam: THREE.Vector3): void {
    this.update(cam, Infinity);
  }

  /** Rebuild the chunks containing these tiles or their neighbours (pads changed). */
  invalidate(tiles: readonly number[]): void {
    const { grid } = this.planet;
    for (const t of tiles) {
      for (const x of [t, ...grid.neighborsOf(t)]) {
        const c = this.chunks[this.tileChunk[x] as number];
        if (c) c.dirty = true;
      }
    }
  }

  setDetail(detail: "low" | "medium" | "high"): void {
    this.maxLevel = detail === "low" ? 2 : 3;
    for (const c of this.chunks) c.dirty = true;
  }

  stats(): ChunkStats {
    const levels = [0, 0, 0, 0];
    let built = 0;
    for (const c of this.chunks) {
      if (c.mesh) built++;
      if (c.level >= 0) levels[c.level] = (levels[c.level] as number) + 1;
    }
    return { chunks: this.chunks.length, built, triangles: this.triangles, levels };
  }

  private build(c: Chunk, level: number): void {
    const { grid } = this.planet;
    const field = this.field;
    const R = this.planet.params.radius;
    // Vertex store: unit direction, owning tile, edge value (1 at tile centre, 0 on borders).
    const dx: number[] = [];
    const dy: number[] = [];
    const dz: number[] = [];
    const owner: number[] = [];
    const edge: number[] = [];
    const keyed = new Map<string, number>();
    const add = (x: number, y: number, z: number, t: number, e: number) => {
      const l = Math.sqrt(x * x + y * y + z * z);
      dx.push(x / l);
      dy.push(y / l);
      dz.push(z / l);
      owner.push(t);
      edge.push(e);
      return dx.length - 1;
    };
    const centerV = (t: number) => {
      const k = `t${t}`;
      let v = keyed.get(k);
      if (v === undefined) {
        v = add(grid.center[t * 3] as number, grid.center[t * 3 + 1] as number, grid.center[t * 3 + 2] as number, t, 1);
        keyed.set(k, v);
      }
      return v;
    };
    const cornerV = (k: number, t: number) => {
      const key = `c${k}`;
      let v = keyed.get(key);
      if (v === undefined) {
        v = add(grid.corners[k * 3] as number, grid.corners[k * 3 + 1] as number, grid.corners[k * 3 + 2] as number, t, 0);
        keyed.set(key, v);
      }
      return v;
    };
    const mids = new Map<number, number>();
    /** Parents of vertices added by the last subdivision step (their coarse shape is the parents' midpoint). */
    const parents = new Map<number, [number, number]>();
    let lastStep = level === 0;
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 2097152 + b : b * 2097152 + a;
      let m = mids.get(key);
      if (m === undefined) {
        m = add((dx[a] as number) + (dx[b] as number), (dy[a] as number) + (dy[b] as number), (dz[a] as number) + (dz[b] as number), (edge[a] as number) >= (edge[b] as number) ? (owner[a] as number) : (owner[b] as number), ((edge[a] as number) + (edge[b] as number)) / 2);
        mids.set(key, m);
        if (lastStep) parents.set(m, [a, b]);
      }
      return m;
    };
    let tris: number[] = [];
    const boundary: [number, number][] = [];
    const inChunk = (t: number) => this.tileChunk[t] === c.id;
    for (const t of c.tiles) {
      const cs = grid.cornersOf(t);
      const ns = grid.neighborsOf(t);
      const cv = centerV(t);
      for (let k = 0; k < cs.length; k++) {
        const a = cornerV(cs[k] as number, t);
        const b = cornerV(cs[(k + 1) % cs.length] as number, t);
        tris.push(cv, a, b);
      }
      // Border edges shared with another chunk get skirts. Edge (cs[k-1], cs[k]) faces ns[k].
      for (let k = 0; k < ns.length; k++) {
        if (inChunk(ns[k] as number)) continue;
        boundary.push([cornerV(cs[(k - 1 + cs.length) % cs.length] as number, t), cornerV(cs[k] as number, t)]);
      }
    }
    for (let s = 0; s < level; s++) {
      lastStep = s === level - 1;
      const next: number[] = [];
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i] as number;
        const b = tris[i + 1] as number;
        const d = tris[i + 2] as number;
        const ab = mid(a, b);
        const bd = mid(b, d);
        const da = mid(d, a);
        next.push(a, ab, da, ab, b, bd, da, bd, d, ab, bd, da);
      }
      tris = next;
    }
    // Skirt chains: the subdivided border edges (same midpoints as the triangles).
    const chain = (a: number, b: number, depth: number): number[] => {
      if (depth === 0) return [a, b];
      const m = mid(a, b);
      const left = chain(a, m, depth - 1);
      return [...left.slice(0, -1), ...chain(m, b, depth - 1)];
    };
    const skirtTop: number[] = [];
    for (const [a, b] of boundary) {
      const ch = chain(a, b, level);
      for (let i = 0; i < ch.length - 1; i++) skirtTop.push(ch[i] as number, ch[i + 1] as number);
    }

    // Evaluate positions, colours and normals on the field.
    const nv = dx.length;
    const skirtBase = nv;
    const total = nv + skirtTop.length;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const coarse = new Float32Array(total * 3);
    const tileAttr = new Float32Array(total);
    // Distances (world units) to the nearest road centreline and to the river's water edge,
    // interpolated per pixel by the ground material to draw roads and banks crisply.
    const roadAttr = new Float32Array(total);
    const riverAttr = new Float32Array(total);
    const edgeAttr = new Float32Array(total);
    const color = new THREE.Color();
    const e = field.spacing * 0.07;
    const p0 = new THREE.Vector3();
    const t1 = new THREE.Vector3();
    const t2 = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const q = new THREE.Vector3();
    const at = (x: number, y: number, z: number, hint: number, out: THREE.Vector3) => {
      out.set(x, y, z).normalize();
      return out.multiplyScalar(R + field.height(out.x, out.y, out.z, hint).h);
    };
    // Vertices on chunk borders get their normal from the field (so neighbouring chunks agree);
    // everywhere else the mesh's own normals are accurate enough and far cheaper.
    const onBorder = new Uint8Array(nv);
    for (const v of skirtTop) onBorder[v] = 1;
    for (let i = 0; i < nv; i++) {
      const x = dx[i] as number;
      const y = dy[i] as number;
      const z = dz[i] as number;
      const hint = owner[i] as number;
      const s = field.height(x, y, z, hint, color);
      const r = R + s.h;
      pos[i * 3] = x * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = z * r;
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
      tileAttr[i] = s.tile;
      edgeAttr[i] = edge[i] as number;
      roadAttr[i] = Math.min(9, field.roadDistance(x, y, z, hint));
      riverAttr[i] = Math.min(9, field.riverEdge(x, y, z, hint));
      if (!onBorder[i]) continue;
      // Normal from central differences on the field.
      p0.set(x, y, z);
      t1.set(0, 1, 0).cross(p0);
      if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0);
      t1.normalize();
      t2.crossVectors(p0, t1);
      at(x + t1.x * e, y + t1.y * e, z + t1.z * e, hint, a);
      at(x - t1.x * e, y - t1.y * e, z - t1.z * e, hint, q);
      a.sub(q);
      at(x + t2.x * e, y + t2.y * e, z + t2.z * e, hint, b);
      at(x - t2.x * e, y - t2.y * e, z - t2.z * e, hint, q);
      b.sub(q);
      const n = q.crossVectors(a, b).normalize();
      if (n.dot(p0) < 0) n.negate();
      nor[i * 3] = n.x;
      nor[i * 3 + 1] = n.y;
      nor[i * 3 + 2] = n.z;
    }
    // Interior normals from the triangles (area weighted).
    const acc = new Float32Array(nv * 3);
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fn = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) {
      const i0 = tris[i] as number;
      const i1 = tris[i + 1] as number;
      const i2 = tris[i + 2] as number;
      e1.set((pos[i1 * 3] as number) - (pos[i0 * 3] as number), (pos[i1 * 3 + 1] as number) - (pos[i0 * 3 + 1] as number), (pos[i1 * 3 + 2] as number) - (pos[i0 * 3 + 2] as number));
      e2.set((pos[i2 * 3] as number) - (pos[i0 * 3] as number), (pos[i2 * 3 + 1] as number) - (pos[i0 * 3 + 1] as number), (pos[i2 * 3 + 2] as number) - (pos[i0 * 3 + 2] as number));
      fn.crossVectors(e1, e2);
      // Winding varies between fans; orient every face outward.
      if (fn.x * (pos[i0 * 3] as number) + fn.y * (pos[i0 * 3 + 1] as number) + fn.z * (pos[i0 * 3 + 2] as number) < 0) fn.negate();
      for (const v of [i0, i1, i2]) {
        acc[v * 3] = (acc[v * 3] as number) + fn.x;
        acc[v * 3 + 1] = (acc[v * 3 + 1] as number) + fn.y;
        acc[v * 3 + 2] = (acc[v * 3 + 2] as number) + fn.z;
      }
    }
    for (let i = 0; i < nv; i++) {
      if (onBorder[i]) continue;
      fn.set(acc[i * 3] as number, acc[i * 3 + 1] as number, acc[i * 3 + 2] as number).normalize();
      nor[i * 3] = fn.x;
      nor[i * 3 + 1] = fn.y;
      nor[i * 3 + 2] = fn.z;
    }
    // Coarse shape: the last step's vertices sit on their parents' midpoint.
    coarse.set(pos.subarray(0, nv * 3));
    for (const [v, [pa, pb]] of parents) {
      for (let k = 0; k < 3; k++) coarse[v * 3 + k] = ((pos[pa * 3 + k] as number) + (pos[pb * 3 + k] as number)) / 2;
    }
    // Skirt vertices hang below their top vertex.
    for (let j = 0; j < skirtTop.length; j++) {
      const top = skirtTop[j] as number;
      const i = skirtBase + j;
      const k = 1 - SKIRT / R;
      pos[i * 3] = (pos[top * 3] as number) * k;
      pos[i * 3 + 1] = (pos[top * 3 + 1] as number) * k;
      pos[i * 3 + 2] = (pos[top * 3 + 2] as number) * k;
      for (let m = 0; m < 3; m++) coarse[i * 3 + m] = (coarse[top * 3 + m] as number) * k;
      nor.copyWithin(i * 3, top * 3, top * 3 + 3);
      col.copyWithin(i * 3, top * 3, top * 3 + 3);
      tileAttr[i] = tileAttr[top] as number;
      edgeAttr[i] = 0;
      roadAttr[i] = roadAttr[top] as number;
      riverAttr[i] = riverAttr[top] as number;
    }
    for (let j = 0; j < skirtTop.length; j += 2) {
      const a0 = skirtTop[j] as number;
      const b0 = skirtTop[j + 1] as number;
      const a1 = skirtBase + j;
      const b1 = skirtBase + j + 1;
      tris.push(a0, a1, b0, b0, a1, b1, a0, b0, a1, b0, b1, a1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("aCoarse", new THREE.BufferAttribute(coarse, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aTile", new THREE.BufferAttribute(tileAttr, 1));
    g.setAttribute("aEdge", new THREE.BufferAttribute(edgeAttr, 1));
    g.setAttribute("aRoad", new THREE.BufferAttribute(roadAttr, 1));
    g.setAttribute("aRiver", new THREE.BufferAttribute(riverAttr, 1));
    g.setIndex(total > 65535 ? new THREE.BufferAttribute(new Uint32Array(tris), 1) : new THREE.BufferAttribute(new Uint16Array(tris), 1));
    g.computeBoundingSphere();
    if (c.mesh) {
      this.triangles -= (c.mesh.geometry.index?.count ?? 0) / 3;
      c.mesh.geometry.dispose();
      c.mesh.geometry = g;
    } else {
      c.mesh = new THREE.Mesh(g, this.material);
      c.mesh.castShadow = true;
      c.mesh.receiveShadow = true;
      c.mesh.name = `chunk-${c.id}`;
      this.group.add(c.mesh);
    }
    this.triangles += tris.length / 3;
    c.level = level;
    c.dirty = false;
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh?.geometry.dispose();
  }
}
