import { acos, cos, sin, TAU } from "../dmath";
import type { Rng } from "../rng";

/**
 * Star Wells: seeded target positions for the twelve pentagons of a planet's grid.
 * The icosahedral pattern (every pentagon 63.4° from its neighbours) is never used as is.
 */

export type Vec3 = [number, number, number];

export type WellStyle = "scatter" | "clusters" | "belt" | "drift";

export const WELL_STYLES: readonly WellStyle[] = ["scatter", "clusters", "belt", "drift"];

/** Minimum angle between two wells, in radians. Keeps the relaxed grid free of folds. */
export const MIN_WELL_ANGLE = (17 * Math.PI) / 180;

export function norm(v: Vec3): Vec3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function randomDir(r: Rng): Vec3 {
  const z = r.range(-1, 1);
  const a = r.range(0, TAU);
  const s = Math.sqrt(1 - z * z);
  return [s * cos(a), z, s * sin(a)];
}

/** Uniform random rotation as a 3×3 matrix (from a random unit quaternion). */
export function randomRotation(r: Rng): number[] {
  const u1 = r.next();
  const u2 = r.next() * TAU;
  const u3 = r.next() * TAU;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const x = a * sin(u2);
  const y = a * cos(u2);
  const z = b * sin(u3);
  const w = b * cos(u3);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function rotate(m: number[], v: Vec3): Vec3 {
  return [
    (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
    (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
    (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2],
  ];
}

function farEnough(p: Vec3, pts: readonly Vec3[], minAngle: number): boolean {
  const c = cos(minAngle);
  for (const q of pts) if (dot(p, q) > c) return false;
  return true;
}

function fill(r: Rng, pts: Vec3[], gen: () => Vec3, count: number, minAngle: number): void {
  for (let tries = 0; pts.length < count && tries < 20000; tries++) {
    const p = gen();
    if (farEnough(p, pts, minAngle)) pts.push(p);
  }
  // Fallback that always terminates: uniform points with the global minimum spacing.
  for (let tries = 0; pts.length < count && tries < 200000; tries++) {
    const p = randomDir(r);
    if (farEnough(p, pts, MIN_WELL_ANGLE)) pts.push(p);
  }
  if (pts.length < count) throw new Error("Could not place Star Wells");
}

/** Perturb p by a random angle up to maxAngle in a random direction. */
function jitter(r: Rng, p: Vec3, maxAngle: number): Vec3 {
  const d = randomDir(r);
  const t = r.range(0, maxAngle);
  return norm([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]);
}

export function generateWellTargets(r: Rng, style: WellStyle, icoRotated: readonly Vec3[]): Vec3[] {
  const pts: Vec3[] = [];
  const deg = Math.PI / 180;
  switch (style) {
    case "scatter":
      fill(r, pts, () => randomDir(r), 12, 28 * deg);
      break;
    case "clusters": {
      const centers: Vec3[] = [];
      fill(r, centers, () => randomDir(r), r.int(2, 3), 70 * deg);
      for (const c of centers) {
        const n = r.int(3, 4);
        const local: Vec3[] = [];
        fill(r, local, () => jitter(r, c, 0.45), n, MIN_WELL_ANGLE);
        for (const p of local) if (farEnough(p, pts, MIN_WELL_ANGLE)) pts.push(p);
      }
      fill(r, pts, () => randomDir(r), 12, 30 * deg);
      break;
    }
    case "belt": {
      // A chain of wells along a tilted great circle, the rest scattered.
      const axis = randomDir(r);
      const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm([
        axis[1] * helper[2] - axis[2] * helper[1],
        axis[2] * helper[0] - axis[0] * helper[2],
        axis[0] * helper[1] - axis[1] * helper[0],
      ]);
      const v: Vec3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
      const n = r.int(5, 7);
      const a0 = r.range(0, TAU);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i * TAU * r.range(0.45, 0.7)) / n;
        const off = r.range(-0.12, 0.12);
        const p = norm([
          u[0] * cos(a) + v[0] * sin(a) + axis[0] * off,
          u[1] * cos(a) + v[1] * sin(a) + axis[1] * off,
          u[2] * cos(a) + v[2] * sin(a) + axis[2] * off,
        ]);
        if (farEnough(p, pts, MIN_WELL_ANGLE)) pts.push(p);
      }
      fill(r, pts, () => randomDir(r), 12, 30 * deg);
      break;
    }
    case "drift":
      // Close to the rotated icosahedron, but every well pushed 12–24° away from its regular spot.
      for (const p of icoRotated) {
        let q = jitter(r, p, 0.42);
        for (let k = 0; k < 10 && acos(dot(p, q)) < 12 * deg; k++) q = jitter(r, p, 0.42);
        if (farEnough(q, pts, MIN_WELL_ANGLE)) pts.push(q);
      }
      fill(r, pts, () => randomDir(r), 12, 25 * deg);
      break;
  }
  return pts.slice(0, 12);
}

/** Pair each pentagon with a target so total movement is small (greedy closest pairs, deterministic). */
export function assignTargets(sources: readonly Vec3[], targets: readonly Vec3[]): number[] {
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < sources.length; i++)
    for (let j = 0; j < targets.length; j++) pairs.push([-dot(sources[i] as Vec3, targets[j] as Vec3), i, j]);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const out = new Array<number>(sources.length).fill(-1);
  const used = new Set<number>();
  for (const [, i, j] of pairs) {
    if (out[i] !== -1 || used.has(j)) continue;
    out[i] = j;
    used.add(j);
  }
  return out;
}
