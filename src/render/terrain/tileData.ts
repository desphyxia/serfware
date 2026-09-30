import * as THREE from "three/webgpu";
import { float, int, ivec2, textureLoad } from "three/tsl";

type N = THREE.Node<"vec4">;

/**
 * Per-tile shading data shared by every terrain chunk and the sea: one texel per tile.
 * Channels: A = (wear, fog of war, snow, autumn), B = (mud, soil, shore, scorch or -ash),
 * C = (blown sand, glowcap light, -, -).
 * Shaders look it up by tile index in the vertex stage and interpolate across tiles.
 */
export class TileData {
  readonly width = 256;
  readonly height: number;
  readonly a: THREE.DataTexture;
  readonly b: THREE.DataTexture;
  readonly c: THREE.DataTexture;
  private readonly da: Float32Array;
  private readonly db: Float32Array;
  private readonly dc: Float32Array;

  constructor(readonly count: number) {
    this.height = Math.ceil(count / this.width);
    this.da = new Float32Array(this.width * this.height * 4);
    this.db = new Float32Array(this.width * this.height * 4);
    this.dc = new Float32Array(this.width * this.height * 4);
    const mk = (d: Float32Array) => {
      const t = new THREE.DataTexture(d, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this.a = mk(this.da);
    this.b = mk(this.db);
    this.c = mk(this.dc);
  }

  set(t: number, channel: "wear" | "fog" | "snow" | "autumn" | "mud" | "soil" | "shore" | "scorch" | "sand" | "glow", v: number): void {
    const i = t * 4;
    switch (channel) {
      case "sand":
        this.dc[i] = v;
        break;
      case "glow":
        this.dc[i + 1] = v;
        break;
      case "wear":
        this.da[i] = v;
        break;
      case "fog":
        this.da[i + 1] = v;
        break;
      case "snow":
        this.da[i + 2] = v;
        break;
      case "autumn":
        this.da[i + 3] = v;
        break;
      case "mud":
        this.db[i] = v;
        break;
      case "soil":
        this.db[i + 1] = v;
        break;
      case "shore":
        this.db[i + 2] = v;
        break;
      case "scorch":
        this.db[i + 3] = v;
        break;
    }
  }

  /** Mark the textures for upload after a batch of `set` calls. */
  commit(which: "a" | "b" | "c" | "both" = "both"): void {
    if (which === "c") {
      this.c.needsUpdate = true;
      return;
    }
    if (which !== "b") this.a.needsUpdate = true;
    if (which !== "a") this.b.needsUpdate = true;
  }

  /** Node looking up texture `tex` at a tile index node. */
  lookup(tex: THREE.DataTexture, tile: THREE.Node<"float">): N {
    const i = int(float(tile).add(0.5));
    return textureLoad(tex, ivec2(i.mod(this.width), i.div(this.width))) as unknown as N;
  }
}
