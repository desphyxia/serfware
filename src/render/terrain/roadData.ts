import * as THREE from "three/webgpu";
import { Fn, If, clamp, dot, float, int, ivec2, length, max, min, normalize, positionWorld, textureLoad } from "three/tsl";
import type { TerrainField } from "./field";

/** Road segments kept per tile. */
const SLOTS = 12;

type V4 = THREE.Node<"vec4">;

/**
 * Lattice-mode road segments for the ground shader, so roads are drawn exactly per pixel instead of
 * from per-vertex distances (which break wherever the mesh is coarser than the road is wide).
 * Each tile holds up to SLOTS segments (a tile has twelve: six spokes and six borders), two texels each: the end points on the unit sphere, with 1 in
 * the first texel's w for a used slot.
 */
export class RoadData {
  readonly width = 1024;
  readonly height: number;
  readonly texture: THREE.DataTexture;
  private readonly data: Float32Array;

  constructor(private readonly count: number) {
    this.height = Math.max(1, Math.ceil((count * SLOTS * 2) / this.width));
    this.data = new Float32Array(this.width * this.height * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  /** Reload the segments from the field's current roads. */
  update(field: TerrainField): void {
    this.data.fill(0);
    const used = new Uint8Array(this.count);
    const seen = new Set<string>();
    for (const list of field.roadEdgesByTile().values()) {
      for (const [a, b] of list) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // A pixel near a segment sits in a ground triangle that has one of these tiles: the tile a spoke
        // starts from, or the two tiles a border runs between. Fewer slots used than every tile it touches.
        const ta = field.tilesOf(a);
        const tb = field.tilesOf(b);
        const tiles = a < this.count ? ta : b < this.count ? tb : ta.filter((t) => tb.includes(t));
        const pa = field.nodeXYZ(a);
        const pb = field.nodeXYZ(b);
        for (const t of tiles) {
          const s = used[t] as number;
          if (s >= SLOTS) continue;
          used[t] = s + 1;
          const o = (t * SLOTS + s) * 2 * 4;
          this.data.set(pa, o);
          this.data[o + 3] = 1;
          this.data.set(pb, o + 4);
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  private load(tile: THREE.Node<"float">, slot: number, which: number): V4 {
    const i = int(float(tile).add(0.5)).mul(SLOTS * 2).add(slot * 2 + which);
    return textureLoad(this.texture, ivec2(i.mod(this.width), i.div(this.width))) as unknown as V4;
  }

  /** Distance (world units) from this pixel to the nearest road centreline among the triangle's three tiles. */
  distance(tiles: THREE.Node<"vec3">, radius: number): THREE.Node<"float"> {
    return Fn(() => {
      const p = normalize(positionWorld);
      const best = float(99).toVar();
      for (const tile of [tiles.x, tiles.y, tiles.z]) {
        If(this.load(tile, 0, 0).w.greaterThan(0.5), () => {
          for (let s = 0; s < SLOTS; s++) {
            const a = this.load(tile, s, 0);
            const b = this.load(tile, s, 1);
            const ab = b.xyz.sub(a.xyz);
            const k = clamp(dot(p.sub(a.xyz), ab).div(max(dot(ab, ab), 1e-9)), 0, 1);
            const d = length(p.sub(a.xyz.add(ab.mul(k)))).mul(radius);
            If(a.w.greaterThan(0.5), () => {
              best.assign(min(best, d));
            });
          }
        });
      }
      return best;
    })();
  }
}
