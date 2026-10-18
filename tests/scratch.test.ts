import { it } from "vitest";
import { World } from "../src/sim/world";
import { BUILDINGS, buildingType } from "../src/sim/econ/defs";
it("x", async () => {
  const fs = await import("node:fs");
  const w = new World("quiet-cairn-171", { size: "small", rivals: 0, latticeRoads: true } as never);
  const land = w.land, eco = w.economy;
  const quay = BUILDINGS.find((d) => d.ferry !== undefined && d.id === "quay")!;
  const sites: {n:number,f:number}[] = [];
  const near = new Set<number>();
  const keep = eco.buildings[eco.keeps[0]!]!;
  for (const t of land.ring(keep.tile, 14)) for (const m of [t, ...Array.from(land.nbrs(t))]) near.add(m);
  for (const n of near) { const f = land.bestFlagTile(n, 0); if (f >= 0 && land.canBuildDef(n, f, quay, 0)) sites.push({n,f}); }
  let out = `sites ${sites.length}\n`;
  let pairs = 0;
  for (let i = 0; i < sites.length && pairs < 5; i++) for (let j = i + 1; j < sites.length && pairs < 5; j++) {
    const r = eco.ferryRoute(sites[i]!.f, sites[j]!.f, 6);
    if (r) { pairs++; out += `${JSON.stringify(sites[i])} ${JSON.stringify(sites[j])} steps ${r.steps}\n`; }
  }
  fs.writeFileSync(process.env.HOUT as string, out);
});
