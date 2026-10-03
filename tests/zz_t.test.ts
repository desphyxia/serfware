import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { goodId } from "../src/sim/econ/defs";
import { VoyagePlanner } from "../src/sim/ai/voyage";
import { World } from "../src/sim/world";
it("x", { timeout: 3000000 }, () => {
  VoyagePlanner.found = { population: 20, idle: 0 };
  const w = new World("amber-fern-212", { size: "small", rivals: 1, personalities: ["builder"], peaceDays: 99 });
  w.recordAi = true;
  const eco = w.economy;
  const keep = eco.buildings[eco.keeps[1]!]!;
  const out: string[] = [];
  for (let i = 0; i <= 150 * eco.dayTicks; i++) {
    if (i % eco.dayTicks === 0) for (const g of ["iron", "plank", "stone", "log", "bread"]) (keep.stock as number[])[goodId(g)] = Math.max((keep.stock as number[])[goodId(g)] ?? 0, 40);
    w.step();
    if (i % (15 * eco.dayTicks) === 0) out.push(`d${(i / eco.dayTicks).toFixed(0)} voyages ${JSON.stringify(w.voyages!.list.map((v) => [v.owner, v.kind, v.to, v.state]))} colonies ${w.colonies.map((c, k) => (c ? `${k}:keeps${JSON.stringify(c.economy.keeps)} built${c.economy.buildings.filter((b) => b.alive && b.built && b.owner === 1).length} ai${(c as any).ai.length}` : "")).filter(Boolean).join(" ")}`);
  }
  writeFileSync("/tmp/t.txt", out.join("\n"));
});
