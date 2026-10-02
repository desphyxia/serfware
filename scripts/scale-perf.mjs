// CPU cost of drawing many settlers: the econ view's per-frame update with 0.5k, 4k and 12k settlers,
// close up (far ones are skipped) and from orbit (everyone counts). Usage: node scripts/scale-perf.mjs
// (needs `npm run build:single`). Synthetic settlers are standing carriers on random land, so this
// measures the view code, not the simulation (see `npm run soak -- scale` for that).
import { launch, openGame } from "./browser.mjs";

const browser = await launch();
try {
  const { page, errors } = await openGame(browser, { seed: "russet-heron-417", width: 1000, height: 640 });
  const rows = await page.evaluate(() => {
    const g = window.__seedfall.game;
    g.speed = 0;
    g.hold = true;
    window.__seedfall.demo();
    for (let i = 0; i < 3000; i++) g.world.step();
    const eco = g.world.economy;
    const land = g.world.land;
    const grid = g.world.planet.grid;
    const tiles = [];
    for (let t = 0; t < grid.count; t++) if (land.isLand(t)) tiles.push(t);
    const template = eco.settlers.find((s) => s.alive && s.role === "carrier") ?? eco.settlers.find((s) => s.alive);
    const base = eco.settlers.length;
    const out = [];
    const time = (label, n, dist) => {
      while (eco.settlers.length < n) {
        const t = tiles[(eco.settlers.length * 7919) % tiles.length];
        const nb = grid.neighborsOf(t)[0];
        eco.settlers.push({ ...template, id: eco.settlers.length, path: [t, nb], pi: 0, prog: (eco.settlers.length * 37) % 1000, state: "idle", carrying: -1, alive: true });
      }
      g.setView(dist, 0.6, 0.1);
      g.renderFrames(3);
      const econ = g.view.econ;
      const t0 = performance.now();
      const reps = 10;
      for (let i = 0; i < reps; i++) econ.update(i * 0.016, 0.016);
      out.push({ label, settlers: eco.settlers.filter((s) => s.alive).length, distance: Math.round(g.cam.distance), drawn: econ.figureCount, msPerUpdate: Math.round(((performance.now() - t0) / reps) * 100) / 100 });
    };
    time("500", 500, 30);
    time("4000 close", 4000, 30);
    time("12000 close", 12000, 30);
    time("12000 orbit", 12000, g.cam.maxDistance * 0.9);
    void base;
    return out;
  });
  for (const r of rows) console.log(JSON.stringify(r));
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
