import { expect, it } from "vitest";
import { Use } from "../src/sim/econ/landuse";
import { BUILDINGS, goodId } from "../src/sim/econ/defs";
import { World } from "../src/sim/world";
import { watchCornerIds } from "./helpers/cornerwatch";

function setup() {
  const w = new World("quiet-cairn-171", { size: "small", rivals: 1, latticeRoads: true } as never);
  const hits = watchCornerIds(w);
  const eco = w.economy, land = w.land;
  const keep = eco.buildings[eco.keeps[0]!]!;
  const kf = eco.flags[keep.flag]!;
  const top = () => { for (const g of ["stone", "plank", "log", "iron", "bread", "fish"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40); };
  const connect = (from: number, to: number) => {
    const rt = land.lattice!.findPath(from, to, (m) => land.roadable(m, 0) || land.use[m] === Use.Flag, 4000);
    if (!rt) return false; let last = 0;
    for (let i = 1; i < rt.length; i++) { const end = i === rt.length - 1; const isF = land.use[rt[i]!] === Use.Flag; if (!end && !isF && (i - last < 4 || !land.canPlaceFlag(rt[i]!, 0))) continue; if (!isF && !end && !w.command({ t: "flag", tile: rt[i]! }).ok) continue; if (!w.command({ t: "road", tiles: rt.slice(last, i + 1) }).ok) return false; last = i; }
    return true;
  };
  const run = (n: number) => { for (let i = 0; i < n; i++) { if (i % eco.dayTicks === 0) top(); w.step(); } };
  return { w, hits, eco, land, keep, kf, top, connect, run };
}

const report = (hits: Map<string, number>) => [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`).join("\n");

it("every building type stands and works on corner nodes without touching tile-only data wrongly", () => {
  const { w, hits, eco, land, keep, kf, connect, run } = setup();
  const placed: string[] = [];
  const cornersNear = () => [...new Set([...land.ring(keep.tile, 6)].flatMap((t) => Array.from(land.nbrs(t)).filter((m) => m >= land.tileCount)))];
  for (const def of BUILDINGS) {
    for (const nd of cornersNear()) {
      if (land.ring(keep.tile, 3).includes(land.pt(nd))) continue;
      const f = land.bestFlagTile(nd, 0);
      if (f < 0 || !land.canBuildDef(nd, f, def, 0)) continue;
      if (!w.command({ t: "build", type: def.id, tile: nd, flagTile: f }).ok) continue;
      connect(f, kf.tile);
      placed.push(def.id);
      break;
    }
  }
  expect(placed.length).toBeGreaterThanOrEqual(35);
  run(9000);
  expect(report(hits)).toBe("");
  expect(eco.buildings.filter((b) => b.alive && b.built).length).toBeGreaterThan(10);
}, 900000);

it("bridges carry corner roads over shallow water", () => {
  const { w, hits, land, run } = setup();
  const t0 = [...Array(land.tileCount).keys()].find((t) => land.bridgeBlocked(t, 0) === null) as number;
  expect(t0).toBeDefined();
  // Give the keep planks and bridge the tile, then a neighbouring water tile that can also be bridged.
  const keepStock = w.economy.buildings[w.economy.keeps[0]!]!.stock as number[];
  keepStock[goodId("plank")] = 40;
  expect(w.command({ t: "bridge", tile: t0 }).ok).toBe(true);
  expect(land.deck(t0)).toBe(true);
  expect(land.walkable(t0)).toBe(true);
  const next = Array.from(land.planet.grid.neighborsOf(t0)).find((n) => land.bridgeBlocked(n, 0) === null);
  if (next !== undefined) {
    expect(w.command({ t: "bridge", tile: next }).ok).toBe(true);
    const shared = Array.from(land.nbrs(t0)).filter((n) => n >= land.tileCount && Array.from(land.nbrs(next)).includes(n));
    expect(shared.length).toBeGreaterThan(0);
    for (const c of shared) expect(land.deck(c)).toBe(true);
  }
  // A corner bridge head: a corner counts as a bridge only once the water round it is spanned.
  run(600);
  expect(report(hits)).toBe("");
}, 120000);

it("a ferry links two corner quays and a boatman rows it", () => {
  const { w, hits, eco, land, keep, kf, connect, run } = setup();
  const quay = BUILDINGS.find((d) => d.id === "quay")!;
  const near = new Set<number>();
  for (const t of land.ring(keep.tile, 14)) for (const m of [t, ...Array.from(land.nbrs(t))]) near.add(m);
  const sites: { n: number; f: number }[] = [];
  for (const n of near) {
    const f = land.bestFlagTile(n, 0);
    if (f >= 0 && land.canBuildDef(n, f, quay, 0)) sites.push({ n, f });
  }
  let pair: [{ n: number; f: number }, { n: number; f: number }] | undefined;
  for (let i = 0; i < sites.length && !pair; i++)
    for (let j = i + 1; j < sites.length && !pair; j++) {
      const a = sites[i]!, b = sites[j]!;
      if (a.n >= land.tileCount && b.n >= land.tileCount && eco.ferryRoute(a.f, b.f, 6)?.steps && land.nbrs(a.f).every((m) => m !== b.f)) pair = [a, b];
    }
  expect(pair).toBeDefined();
  const ids: number[] = [];
  for (const s of pair!) {
    expect(w.command({ t: "build", type: "quay", tile: s.n, flagTile: s.f }).ok).toBe(true);
    ids.push(eco.buildings.length - 1);
    connect(s.f, kf.tile);
  }
  run(5000);
  const [qa, qb] = ids.map((i) => eco.buildings[i]!);
  expect(qa!.built && qb!.built).toBe(true);
  expect(w.command({ t: "ferry", from: qa!.id, to: qb!.id }).ok).toBe(true);
  run(3000);
  const link = eco.ferryBetween(qa!, qb!);
  expect(link?.alive).toBe(true);
  for (const t of link!.tiles.slice(1, -1)) expect(land.ferry[t]).toBe(1);
  expect(link!.carrier).toBeGreaterThanOrEqual(0);
  expect(report(hits)).toBe("");
}, 300000);
