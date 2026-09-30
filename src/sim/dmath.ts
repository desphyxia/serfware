/**
 * Deterministic math for the simulation.
 *
 * JavaScript guarantees IEEE-754 double results for + - * / and (in every shipping engine)
 * correctly rounded Math.sqrt, but Math.sin, Math.cos, Math.atan2, Math.exp and friends may
 * differ in the last bits between engines and CPUs. Lockstep multiplayer and golden replays need
 * bit-identical results, so the simulation uses these polynomial versions built only from basic
 * operations. They are accurate to about 1e-9, which is far below anything a game can see.
 *
 * Lint forbids the non-deterministic Math functions inside src/sim.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Reduce an angle to [-PI, PI]. */
export function wrapAngle(x: number): number {
  if (x >= -PI && x <= PI) return x;
  const k = Math.floor((x + PI) / TAU);
  return x - k * TAU;
}

/** sin(x) via symmetric reduction to [-PI/2, PI/2] and a degree-15 odd Taylor polynomial. */
export function sin(x: number): number {
  let r = wrapAngle(x);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 *
                (-1 / 5040 +
                  r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))))
  );
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** atan(x) for |x| <= 1 using range reduction by the half-angle identity and an odd series. */
function atanUnit(x: number): number {
  // Two half-angle reductions bring |x| below tan(PI/16) ≈ 0.199, where the series converges fast.
  const y1 = x / (1 + Math.sqrt(1 + x * x));
  const y2 = y1 / (1 + Math.sqrt(1 + y1 * y1));
  const z = y2 * y2;
  let term = y2;
  let sum = y2;
  for (let n = 1; n <= 9; n++) {
    term *= -z;
    sum += term / (2 * n + 1);
  }
  return 4 * sum;
}

export function atan(x: number): number {
  if (x > 1) return HALF_PI - atanUnit(1 / x);
  if (x < -1) return -HALF_PI - atanUnit(1 / x);
  return atanUnit(x);
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function asin(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return atan2(c, Math.sqrt(1 - c * c));
}

export function acos(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return atan2(Math.sqrt(1 - c * c), c);
}

/** exp(x) via range reduction by powers of two and a Taylor series. */
export function exp(x: number): number {
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const LN2 = 0.6931471805599453;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 16; n++) {
    term *= r / n;
    sum += term;
  }
  let p = 1;
  const base = k >= 0 ? 2 : 0.5;
  for (let i = 0, n = Math.abs(k); i < n; i++) p *= base;
  return sum * p;
}

const LN2 = 0.6931471805599453;

/** Natural logarithm from basic arithmetic only (halving to [1, 2), then an atanh series). */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let k = 0;
  while (x >= 2) {
    x /= 2;
    k++;
  }
  while (x < 1) {
    x *= 2;
    k--;
  }
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let n = 1; n < 41; n += 2) {
    sum += term / n;
    term *= z2;
  }
  return 2 * sum + k * LN2;
}

/** x to the power y for x > 0 (0 for x = 0), deterministic across engines. */
export function pow(x: number, y: number): number {
  if (x === 0) return 0;
  return exp(y * log(x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
