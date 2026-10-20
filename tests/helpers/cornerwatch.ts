import type { World } from "../../src/sim/world";

/** Record every place a corner id (>= tileCount) reaches a lookup that only knows tile ids. */
export function watchCornerIds(w: World): Map<string, number> {
  const hits = new Map<string, number>();
  const land = w.land;
  const n = land.tileCount;
  const note = (what: string) => {
    const frames = (new Error().stack ?? "").split("\n").slice(3).filter((l) => !l.includes("latticesafe")).slice(0, 4).map((l) => l.trim().replace(/^at /, "").replace(/\(.*[\\/]src[\\/]/, "(").replace(/file:\/\/.*[\\/]src[\\/]/, ""));
    const key = `${what} <- ${frames.join(" < ")}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  };
  const grid = w.planet.grid as unknown as Record<string, (...a: number[]) => unknown>;
  for (const name of ["degree", "neighborsOf", "cornersOf", "centerOf"]) {
    const orig = grid[name]!.bind(grid);
    grid[name] = (t: number, ...rest: number[]) => {
      if (t >= n) note(`grid.${name}(corner)`);
      return orig(t, ...rest);
    };
  }
  /** Wrap a typed array of `per` numbers a tile, so that an index past the tiles' own is noted. */
  const wrap = (owner: object, key: string, per = 1) => {
    const arr = (owner as Record<string, unknown>)[key];
    if (!ArrayBuffer.isView(arr) || (arr as unknown as { length: number }).length !== n * per) return;
    const past = (k: string | symbol) => typeof k === "string" && k.length > 0 && k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57 && Number(k) >= n * per;
    const proxy = new Proxy(arr as object, {
      get(target, k) {
        if (past(k)) note(`${key}[corner]`);
        const v = Reflect.get(target, k, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
      set(target, k, v) {
        if (past(k)) note(`${key}[corner]=`);
        return Reflect.set(target, k, v, target);
      },
    });
    Object.defineProperty(owner, key, { value: proxy, configurable: true });
  };
  for (const key of Object.keys(land)) wrap(land, key);
  for (const key of Object.keys(w.planet.terrain)) wrap(w.planet.terrain, key);
  // The tile centres: three numbers a tile. A lattice node (corner) past them has its position in `land.lattice.pos`.
  wrap(w.planet.grid, "center", 3);
  return hits;
}

