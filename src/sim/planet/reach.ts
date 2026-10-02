import type { PlanetGrid } from "./grid";

/** How far apart the lands may lie: the widest crossing a quay (8) or a harbour (14) can ferry, less a margin. */
export const SEAS = {
  close: { name: "Close (a quay can cross every gap)", gap: 6 },
  mixed: { name: "Mixed (some gaps need a harbour)", gap: 12 },
} as const;
export type SeaReach = keyof typeof SEAS;

/**
 * Makes every land reachable by ferry. Lands are joined nearest-first from the largest one (so the
 * widest crossing on the best route is as small as it can be), and wherever a crossing is wider than
 * `gap` steps of water, shoal islets are raised along it so no stretch is wider. Star Well islets
 * are lands like any other. Returns the number of islets added.
 */
export function reachSeas(grid: PlanetGrid, elevation: Float32Array, mode: SeaReach): number {
  return joinLands(grid, elevation, SEAS[mode].gap).added;
}

/** The widest crossing (tiles of water) on the best route that joins every land to the largest, with nothing raised. */
export function widestCrossing(grid: PlanetGrid, elevation: Float32Array): number {
  return joinLands(grid, Float32Array.from(elevation), Infinity).widest;
}

function joinLands(grid: PlanetGrid, elevation: Float32Array, gap: number): { added: number; widest: number } {
  const N = grid.count;
  let widest = 0;
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < N; s++) {
    if ((elevation[s] as number) < 0 || label[s] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const t = stack.pop() as number;
      n++;
      for (const o of grid.neighborsOf(t)) if ((elevation[o] as number) >= 0 && label[o] === -1) {
          label[o] = id;
          stack.push(o);
        }
    }
    sizes.push(n);
  }
  if (sizes.length < 2) return { added: 0, widest: 0 };
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if ((sizes[i] as number) > (sizes[main] as number)) main = i;
  const joined = new Uint8Array(sizes.length);
  joined[main] = 1;
  let added = 0;
  for (let left = sizes.length - 1; left > 0; left--) {
    // Breadth-first over water from everything joined so far, to the nearest land not yet joined.
    const parent = new Int32Array(N).fill(-2);
    let frontier: number[] = [];
    for (let t = 0; t < N; t++) if ((elevation[t] as number) >= 0 && joined[label[t] as number]) {
        parent[t] = -1;
        frontier.push(t);
      }
    let hit = -1;
    while (frontier.length && hit < 0) {
      const next: number[] = [];
      for (const t of frontier) {
        for (const o of grid.neighborsOf(t)) {
          if (parent[o] !== -2) continue;
          parent[o] = t;
          if ((elevation[o] as number) >= 0) {
            if (!joined[label[o] as number]) {
              hit = o;
              break;
            }
            continue;
          }
          next.push(o);
        }
        if (hit >= 0) break;
      }
      frontier = next;
    }
    if (hit < 0) break;
    // The water between, from the joined side to the new land.
    const water: number[] = [];
    for (let t = parent[hit] as number; t >= 0 && (elevation[t] as number) < 0; t = parent[t] as number) water.push(t);
    water.reverse();
    widest = Math.max(widest, water.length);
    // Stones: after every `gap` tiles of open water, a shoal islet.
    for (let i = gap; i < water.length; i += gap + 1) {
      if (water.length - i < 1) break;
      elevation[water[i] as number] = 0.12;
      label[water[i] as number] = label[hit] as number;
      added++;
    }
    joined[label[hit] as number] = 1;
  }
  return { added, widest };
}
