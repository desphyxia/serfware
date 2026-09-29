import { mix32 } from "./rng";

/**
 * Deterministic 3D value noise for world generation. Lattice values come from integer hashing,
 * and interpolation uses only basic arithmetic, so every peer computes identical terrain.
 */
export class SimNoise {
  constructor(private readonly seed: number) {}

  private lattice(x: number, y: number, z: number): number {
    const h = mix32(mix32(mix32(this.seed, x | 0), y | 0), z | 0);
    return (h / 4294967296) * 2 - 1;
  }

  get(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c000 = this.lattice(xi, yi, zi);
    const c100 = this.lattice(xi + 1, yi, zi);
    const c010 = this.lattice(xi, yi + 1, zi);
    const c110 = this.lattice(xi + 1, yi + 1, zi);
    const c001 = this.lattice(xi, yi, zi + 1);
    const c101 = this.lattice(xi + 1, yi, zi + 1);
    const c011 = this.lattice(xi, yi + 1, zi + 1);
    const c111 = this.lattice(xi + 1, yi + 1, zi + 1);
    return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w);
  }

  fbm(x: number, y: number, z: number, octaves = 5, lacunarity = 2.07, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.get(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal: sharp crests for mountain chains. */
  ridged(x: number, y: number, z: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.get(x * f + 31.1, y * f + 7.7, z * f - 3.3));
      n *= n * weight;
      weight = n > 1 ? 1 : n;
      sum += n * amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return sum;
  }
}
