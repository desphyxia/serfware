import { Use } from "../src/sim/econ/landuse";
import type { World } from "../src/sim/world";

/**
 * Rules that must hold at every moment of every game. Returns what is broken (empty when all is
 * well). Cheap enough to check once a game day.
 */
export function invariants(w: World): string[] {
  const out: string[] = [];
  const eco = w.economy;
  const land = w.land;
  const bad = (msg: string) => {
    if (out.length < 20) out.push(msg);
  };
  for (const b of eco.buildings) {
    if (!b.alive) continue;
    if (land.use[b.tile] !== Use.Building || land.ref[b.tile] !== b.id) bad(`building ${b.id} (${b.def.id}) is not on its tile`);
    const f = eco.flags[b.flag];
    if (!f?.alive) bad(`building ${b.id} (${b.def.id}) has no flag`);
    for (const [i, v] of b.stock.entries()) if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) bad(`building ${b.id} stock[${i}] = ${v}`);
    if (b.wear < 0 || b.wear > 1.0001 || Number.isNaN(b.wear)) bad(`building ${b.id} wear ${b.wear}`);
    for (const s of b.garrison) if (!eco.settlers[s]?.alive) bad(`building ${b.id} garrisons a settler ${s} who is gone`);
  }
  for (const f of eco.flags) {
    if (!f.alive) continue;
    if (land.use[f.tile] !== Use.Flag || land.ref[f.tile] !== f.id) bad(`flag ${f.id} is not on its tile`);
    if (f.goods.length > 8) bad(`flag ${f.id} holds ${f.goods.length} goods`);
    for (const g of f.goods) if (!eco.goods[g]?.alive) bad(`flag ${f.id} lists a good ${g} that is gone`);
    for (const r of f.roads) if (!eco.roads[r]?.alive) bad(`flag ${f.id} lists a road ${r} that is gone`);
  }
  for (const r of eco.roads) {
    if (!r.alive) continue;
    const a = eco.flags[r.a];
    const z = eco.flags[r.b];
    if (!a?.alive || !z?.alive) bad(`road ${r.id} ends at a flag that is gone`);
    if (r.tiles[0] !== a?.tile || r.tiles[r.tiles.length - 1] !== z?.tile) bad(`road ${r.id} does not run between its flags`);
  }
  for (const s of eco.settlers) {
    if (!s.alive) continue;
    const p = eco.people[s.person];
    if (s.person >= 0 && (!p || !p.alive)) bad(`settler ${s.id} is a person who is gone`);
    if (s.path.some((t) => t < 0 || t >= land.planet.grid.count)) bad(`settler ${s.id} walks off the world`);
  }
  for (let p = 0; p < eco.keeps.length; p++) {
    if (eco.keeps[p] === undefined) continue;
    const g = eco.glow[p];
    if (g !== undefined && (!Number.isFinite(g) || g < 0 || g > 100)) bad(`player ${p} Glow is ${g}`);
  }
  for (const p of eco.people) if (p.alive && p.settler >= 0 && !eco.settlers[p.settler]?.alive) bad(`person ${p.id} is out as a settler who is gone`);
  return out;
}
