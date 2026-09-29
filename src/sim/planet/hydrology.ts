import { MinHeap } from "../econ/heap";
import type { Planet } from "./planet";

/**
 * Rivers and lakes from rainfall. Basins are filled up to the height where they spill
 * (priority flood from the sea), so every land tile drains to the sea along a downhill path.
 * Rain (from the terrain's moisture) is carried along that path and summed; tiles carrying
 * enough water are rivers. Filled basins deep and wide enough become lakes.
 */
export interface Hydrology {
  /** Tile each land tile drains into on its way to the sea, or -1 for water. */
  flowTo: Int32Array;
  /** Water carried through each tile, in units of one wet tile's rain. */
  flow: Float32Array;
  /** Flow above which a tile counts as a river. */
  riverFlow: number;
  /** 1 on lake tiles. */
  lake: Uint8Array;
  /** Lake surface height per lake tile (0 elsewhere). */
  lakeLevel: Float32Array;
}

const SEA = 0.05;

export function computeHydrology(planet: Planet): Hydrology {
  const { grid, terrain } = planet;
  const n = grid.count;
  const e = terrain.elevation;
  const flowTo = new Int32Array(n).fill(-1);
  const flow = new Float32Array(n);
  const lake = new Uint8Array(n);
  const lakeLevel = new Float32Array(n);
  const fill = new Float32Array(n);
  const done = new Uint8Array(n);
  const order: number[] = [];

  // Priority flood: grow inland from the sea, lowest first; each tile drains to the one that reached it.
  const heap = new MinHeap();
  for (let t = 0; t < n; t++) {
    if ((e[t] as number) <= SEA) {
      fill[t] = e[t] as number;
      done[t] = 1;
      heap.push(t, fill[t] as number);
    }
  }
  // A world with no sea at all: start from the lowest tile.
  if (heap.size === 0) {
    let low = 0;
    for (let t = 1; t < n; t++) if ((e[t] as number) < (e[low] as number)) low = t;
    fill[low] = e[low] as number;
    done[low] = 1;
    heap.push(low, fill[low] as number);
  }
  while (heap.size) {
    const t = heap.pop();
    order.push(t);
    for (const nb of grid.neighborsOf(t)) {
      if (done[nb]) continue;
      done[nb] = 1;
      fill[nb] = Math.max(e[nb] as number, (fill[t] as number) + 1e-4);
      flowTo[nb] = t;
      heap.push(nb, fill[nb] as number);
    }
  }
  // Water tiles don't flow anywhere.
  for (let t = 0; t < n; t++) if ((e[t] as number) <= SEA) flowTo[t] = -1;

  // Rain from the far inland end of each path down to the sea.
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i] as number;
    if ((e[t] as number) <= SEA) continue;
    flow[t] = (flow[t] as number) + 0.2 + (terrain.moisture[t] as number);
    const to = flowTo[t] as number;
    if (to >= 0 && (e[to] as number) > SEA) flow[to] = (flow[to] as number) + (flow[t] as number);
  }

  // Lakes: connected filled basins at least 0.12 deep somewhere and three tiles wide.
  const seen = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (seen[t] || (e[t] as number) <= SEA || (fill[t] as number) - (e[t] as number) < 0.04) continue;
    const comp: number[] = [];
    const stack = [t];
    seen[t] = 1;
    let deepest = 0;
    let level = 0;
    while (stack.length) {
      const x = stack.pop() as number;
      comp.push(x);
      deepest = Math.max(deepest, (fill[x] as number) - (e[x] as number));
      level = Math.max(level, fill[x] as number);
      for (const nb of grid.neighborsOf(x)) {
        if (seen[nb] || (e[nb] as number) <= SEA || (fill[nb] as number) - (e[nb] as number) < 0.04) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    if (comp.length < 3 || deepest < 0.12 || comp.some((x) => grid.degree(x) === 5)) continue;
    for (const x of comp) {
      lake[x] = 1;
      lakeLevel[x] = level + 0.03;
    }
  }
  const riverFlow = Math.max(10, n / 400);
  return { flowTo, flow, riverFlow, lake, lakeLevel };
}
