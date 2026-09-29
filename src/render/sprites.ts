import * as THREE from "three/webgpu";
import { attribute, cameraProjectionMatrix, length, modelViewMatrix, mrt, positionGeometry, smoothstep, uv, vec4, viewportSize } from "three/tsl";

export interface SpriteBatchOptions {
  additive?: boolean;
  /** "world": size in world units; "pixels": size in screen pixels (stars). */
  sizeMode?: "world" | "pixels";
  /** Soft round falloff (default) or a hard-edged disc. */
  soft?: boolean;
  depthTest?: boolean;
  renderOrder?: number;
  /** Also write into the emissive target so the sprites bloom (0 = no glow). */
  glow?: number;
}

/**
 * Many small camera-facing sprites in one draw call: stars, smoke, snowflakes, fireflies,
 * butterflies, lantern halos. Per-sprite position, colour, size and alpha; call `flush(n)`
 * after writing the arrays to draw the first `n`.
 */
export class SpriteBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  readonly pos: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];

  constructor(
    readonly capacity: number,
    o: SpriteBatchOptions = {},
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3).fill(1);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    const mk = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [mk(this.pos, 3), mk(this.color, 3), mk(this.size, 1), mk(this.alpha, 1)];
    g.setAttribute("iPos", this.attrs[0]!);
    g.setAttribute("iColor", this.attrs[1]!);
    g.setAttribute("iSize", this.attrs[2]!);
    g.setAttribute("iAlpha", this.attrs[3]!);
    g.instanceCount = 0;

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest ?? true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const center = attribute("iPos", "vec3");
    const size = attribute("iSize", "float");
    const mv = modelViewMatrix.mul(vec4(center, 1));
    if ((o.sizeMode ?? "world") === "world") {
      const offset = positionGeometry.xy.mul(size);
      mat.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset), mv.z, 1));
    } else {
      const clip = cameraProjectionMatrix.mul(mv);
      // Pixel size → clip-space offset.
      const offset = positionGeometry.xy.mul(size).mul(2).div(viewportSize).mul(clip.w);
      mat.vertexNode = vec4(clip.xy.add(offset), clip.z, clip.w);
    }
    const d = length(uv().sub(0.5));
    const shape = o.soft === false ? smoothstep(0.5, 0.42, d) : smoothstep(0.5, 0.0, d);
    mat.colorNode = attribute("iColor", "vec3");
    mat.opacityNode = shape.mul(attribute("iAlpha", "float"));
    if (o.glow) mat.mrtNode = mrt({ emissive: vec4(attribute("iColor", "vec3").mul(shape.mul(attribute("iAlpha", "float"))).mul(o.glow), 1) });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 7;
  }

  /** Upload the first `n` sprites and draw them. */
  flush(n: number): void {
    this.mesh.geometry.instanceCount = Math.min(n, this.capacity);
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, Math.min(n, this.capacity)) * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
