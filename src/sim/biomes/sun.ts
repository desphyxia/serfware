import type { Planet } from "../planet/planet";

/**
 * The sun on a tidally locked planet stands still over one point: longitude 0 on the equator
 * (+x). Its day side bakes, its far side freezes, and between them runs a ring of twilight.
 */
export const SUBSOLAR: readonly [number, number, number] = [1, 0, 0];

/** Height of the fixed sun at a tile (-1 far side .. 1 under it); only meaningful when locked. */
export function sunHeight(planet: Planet, t: number): number {
  const c = planet.grid.center;
  return (c[t * 3] as number) * SUBSOLAR[0] + (c[t * 3 + 1] as number) * SUBSOLAR[1] + (c[t * 3 + 2] as number) * SUBSOLAR[2];
}

/** Within the twilight ring of a locked planet. */
export function twilight(planet: Planet, t: number): boolean {
  return Math.abs(sunHeight(planet, t)) < 0.22;
}
