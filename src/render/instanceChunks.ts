import * as THREE from "three/webgpu";

/** Each cube face of the planet is split into GRID x GRID cells. */
const GRID = 4;
const CELLS = 6 * GRID * GRID;
/** Wind and brush displacement move vertices a little past the instances' own bounds. */
const BOUNDS_MARGIN = 1.2;

/**
 * Splits one instanced mesh into regional chunks so three.js can frustum-cull them.
 *
 * Features are written into the source mesh as usual; `partition` then sorts its instances into
 * chunks by where they stand on the planet and gives each chunk a bounding sphere. A single
 * planet-wide instanced mesh cannot be culled, so every tree on the far side of the planet used to
 * be vertex-shaded each frame (and again for the shadow map).
 */
export class InstanceChunks {
  private readonly chunks: (THREE.InstancedMesh | null)[] = new Array<THREE.InstancedMesh | null>(CELLS).fill(null);
  private readonly cellOf: Uint16Array;
  private readonly counts = new Uint32Array(CELLS);

  constructor(
    private readonly source: THREE.InstancedMesh,
    private readonly parent: THREE.Object3D,
  ) {
    this.cellOf = new Uint16Array(source.instanceMatrix.count);
    // The source stays as the build buffer and is never drawn.
    source.visible = false;
  }

  /** Redistribute the source's first `count` instances (matrices and colours) into chunks. */
  partition(): void {
    const src = this.source;
    const n = Math.min(src.count, this.cellOf.length);
    const m = src.instanceMatrix.array as Float32Array;
    const col = src.instanceColor?.array as Float32Array | undefined;
    this.counts.fill(0);
    for (let i = 0; i < n; i++) {
      const x = m[i * 16 + 12] as number;
      const y = m[i * 16 + 13] as number;
      const z = m[i * 16 + 14] as number;
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      const az = Math.abs(z);
      let face: number;
      let a: number;
      let b: number;
      if (ax >= ay && ax >= az) {
        face = x >= 0 ? 0 : 1;
        a = y;
        b = z;
      } else if (ay >= az) {
        face = y >= 0 ? 2 : 3;
        a = x;
        b = z;
      } else {
        face = z >= 0 ? 4 : 5;
        a = x;
        b = y;
      }
      const major = Math.max(ax, ay, az) || 1;
      const gu = Math.min(GRID - 1, Math.floor(((a / major + 1) / 2) * GRID));
      const gv = Math.min(GRID - 1, Math.floor(((b / major + 1) / 2) * GRID));
      const cell = (face * GRID + gu) * GRID + gv;
      this.cellOf[i] = cell;
      this.counts[cell] = (this.counts[cell] as number) + 1;
    }
    for (let c = 0; c < CELLS; c++) {
      const need = this.counts[c] as number;
      let chunk = this.chunks[c] ?? null;
      if (need === 0) {
        if (chunk) {
          chunk.count = 0;
          chunk.visible = false;
        }
        continue;
      }
      if (!chunk || chunk.instanceMatrix.count < need) {
        if (chunk) {
          this.parent.remove(chunk);
          chunk.dispose();
        }
        // Headroom so a growing forest does not reallocate on every rebuild.
        const cap = Math.ceil(need * 1.25) + 8;
        chunk = new THREE.InstancedMesh(src.geometry, src.material, cap);
        chunk.name = src.name;
        chunk.castShadow = src.castShadow;
        chunk.receiveShadow = src.receiveShadow;
        chunk.renderOrder = src.renderOrder;
        if (col) chunk.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        this.parent.add(chunk);
        this.chunks[c] = chunk;
      }
      chunk.geometry = src.geometry;
      chunk.visible = true;
      chunk.count = 0;
    }
    // Copy each instance into its chunk.
    for (let i = 0; i < n; i++) {
      const chunk = this.chunks[this.cellOf[i] as number] as THREE.InstancedMesh;
      const k = chunk.count++;
      (chunk.instanceMatrix.array as Float32Array).set(m.subarray(i * 16, i * 16 + 16), k * 16);
      if (col && chunk.instanceColor) (chunk.instanceColor.array as Float32Array).set(col.subarray(i * 3, i * 3 + 3), k * 3);
    }
    for (const chunk of this.chunks) {
      if (!chunk || chunk.count === 0) continue;
      chunk.instanceMatrix.needsUpdate = true;
      if (chunk.instanceColor) chunk.instanceColor.needsUpdate = true;
      chunk.computeBoundingSphere();
      const sphere = chunk.boundingSphere as THREE.Sphere | null;
      if (sphere) sphere.radius += BOUNDS_MARGIN;
    }
  }
}
