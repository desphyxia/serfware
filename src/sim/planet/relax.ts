import type { Rings } from "./geodesic";
import { norm, type Vec3 } from "./wells";

/**
 * Moves the twelve degree-5 vertices from their icosahedral spots to seeded targets in small
 * steps, smoothing every other vertex toward the average of its neighbours after each step.
 * The mesh topology never changes, so the dual grid keeps exactly twelve pentagons.
 * Returns false if any triangle folded over (the caller then retries with gentler targets).
 */
export function relaxToTargets(
  pos: Float64Array,
  tris: Uint32Array,
  rings: Rings,
  anchors: readonly number[],
  targets: readonly Vec3[],
  opts: { steps?: number; sweepsPerStep?: number; finalSweeps?: number } = {},
): boolean {
  const steps = opts.steps ?? 24;
  const sweeps = opts.sweepsPerStep ?? 6;
  const finalSweeps = opts.finalSweeps ?? 40;
  const V = pos.length / 3;
  const isAnchor = new Uint8Array(V);
  for (const a of anchors) isAnchor[a] = 1;
  const starts: Vec3[] = anchors.map((a) => [pos[a * 3] as number, pos[a * 3 + 1] as number, pos[a * 3 + 2] as number]);

  const sweep = () => {
    for (let v = 0; v < V; v++) {
      if (isAnchor[v]) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      const s = rings.start[v] as number;
      const e = rings.start[v + 1] as number;
      for (let k = s; k < e; k++) {
        const n = rings.neighbors[k] as number;
        x += pos[n * 3] as number;
        y += pos[n * 3 + 1] as number;
        z += pos[n * 3 + 2] as number;
      }
      const l = Math.sqrt(x * x + y * y + z * z);
      pos[v * 3] = x / l;
      pos[v * 3 + 1] = y / l;
      pos[v * 3 + 2] = z / l;
    }
  };

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    anchors.forEach((a, i) => {
      const p0 = starts[i] as Vec3;
      const p1 = targets[i] as Vec3;
      const p = norm([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t]);
      pos[a * 3] = p[0];
      pos[a * 3 + 1] = p[1];
      pos[a * 3 + 2] = p[2];
    });
    for (let k = 0; k < sweeps; k++) sweep();
  }
  for (let k = 0; k < finalSweeps; k++) sweep();
  return countFolds(pos, tris) === 0;
}

/** Number of triangles whose winding flipped (normal pointing into the sphere). */
export function countFolds(pos: Float64Array, tris: Uint32Array): number {
  let folds = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = (tris[i] as number) * 3;
    const b = (tris[i + 1] as number) * 3;
    const c = (tris[i + 2] as number) * 3;
    const abx = (pos[b] as number) - (pos[a] as number);
    const aby = (pos[b + 1] as number) - (pos[a + 1] as number);
    const abz = (pos[b + 2] as number) - (pos[a + 2] as number);
    const acx = (pos[c] as number) - (pos[a] as number);
    const acy = (pos[c + 1] as number) - (pos[a + 1] as number);
    const acz = (pos[c + 2] as number) - (pos[a + 2] as number);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const mx = (pos[a] as number) + (pos[b] as number) + (pos[c] as number);
    const my = (pos[a + 1] as number) + (pos[b + 1] as number) + (pos[c + 1] as number);
    const mz = (pos[a + 2] as number) + (pos[b + 2] as number) + (pos[c + 2] as number);
    if (nx * mx + ny * my + nz * mz <= 0) folds++;
  }
  return folds;
}
