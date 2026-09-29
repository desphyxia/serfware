/**
 * Smooth 3D value noise for visuals only (colour variation, cloud shapes, sway phases).
 * Gameplay data never comes from here; it comes from the deterministic simulation.
 */
export class Noise3 {
  private readonly perm: Uint8Array;
  private readonly vals: Float32Array;

  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j] as number, p[i] as number];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] as number;
    for (let i = 0; i < 256; i++) this.vals[i] = rnd() * 2 - 1;
  }

  private v(x: number, y: number, z: number): number {
    const P = this.perm;
    return this.vals[P[(P[(P[x & 255] as number) + (y & 255)] as number) + (z & 255)] as number] as number;
  }

  /** Noise in roughly [-1, 1]. */
  get(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const x00 = l(this.v(xi, yi, zi), this.v(xi + 1, yi, zi), u);
    const x10 = l(this.v(xi, yi + 1, zi), this.v(xi + 1, yi + 1, zi), u);
    const x01 = l(this.v(xi, yi, zi + 1), this.v(xi + 1, yi, zi + 1), u);
    const x11 = l(this.v(xi, yi + 1, zi + 1), this.v(xi + 1, yi + 1, zi + 1), u);
    return l(l(x00, x10, v), l(x01, x11, v), w);
  }

  fbm(x: number, y: number, z: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.get(x * f, y * f, z * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
}
