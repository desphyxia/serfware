// Render cost per graphics preset at a busy close-up: visible meshes (about one draw call each,
// before shadows), triangles including instances, and the time for a few frames. Software
// rendering makes the times relative only; compare presets and runs.
// Usage: node scripts/perf.mjs [seed]
import { launch, openGame } from "./browser.mjs";

const seed = process.argv[2] ?? "russet-heron-417";
// With BUDGET=1 (or --budget) the run fails when a preset draws more than its budget; the budgets sit
// well above what the busy close-up draws (it varies by a fifth or more between runs, as terrain and
// wildlife stream in), so only a large regression trips them.
const BUDGET = process.env.BUDGET === "1" || process.argv.includes("--budget");
const LIMITS = { low: { meshes: 450, ktriangles: 700 }, medium: { meshes: 450, ktriangles: 900 }, high: { meshes: 450, ktriangles: 1100 }, deck: { meshes: 450, ktriangles: 800 }, handheld: { meshes: 450, ktriangles: 650 } };
const only = (process.env.PRESETS ?? process.argv.find((a) => a.startsWith("--presets="))?.slice(10))?.split(",");
const browser = await launch();
try {
  const rows = [];
  for (const preset of ["low", "medium", "high", "deck", "handheld"].filter((p) => !only || only.includes(p))) {
    const { page } = await openGame(browser, { seed, width: 960, height: 600 });
    // Terrain detail applies at load: store the preset, then reload.
    await page.evaluate((preset) => window.__seedfall.game.settings.applyPreset(preset), preset);
    await page.reload();
    await page.waitForFunction(() => window.__seedfall?.ready === true, null, { timeout: 60000 });
    const r = await page.evaluate((preset) => {
      const g = window.__seedfall.game;
      window.__seedfall.demo();
      for (let i = 0; i < 6000; i++) g.world.step();
      g.focusPlayer(0, 20);
      g.setHour(15);
      g.setView(20, 0.8, 0.08);
      g.hold = true;
      // Terrain chunks stream in over time; build them all so the count does not depend on how long the page ran.
      g.view.terrain.buildAll(g.cam.focus.clone().multiplyScalar(g.world.planet.params.radius * 4));
      g.renderFrames(20);
      const top = [];
      let meshes = 0;
      let triangles = 0;
      const visible = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      g.scene.traverse((o) => {
        if (!o.isMesh || !visible(o)) return;
        const geo = o.geometry;
        const n = o.isInstancedMesh ? o.count : (geo.instanceCount ?? 1);
        if (!n) return;
        const verts = geo.index ? geo.index.count : (geo.getAttribute("position")?.count ?? 0);
        const range = Math.min(verts, geo.drawRange?.count ?? Infinity);
        meshes++;
        const tri = (range / 3) * (Number.isFinite(n) ? n : 1);
        triangles += tri;
        let name = o.name;
        for (let p = o.parent; !name && p; p = p.parent) name = p.name;
        top.push([`${name || "?"}:${Math.round(range / 3)}x${n}`, Math.round(tri / 1000)]);
      });
      top.sort((a, b) => b[1] - a[1]);
      return { preset, top: top.slice(0, 10).map(([k, v]) => `${k}=${v}k`).join(" "), meshes, ktriangles: Math.round(triangles / 1000), };
    }, preset);
    rows.push(r);
    await page.close();
  }
  for (const r of rows) console.log(r.preset, r.top);
  console.table(rows.map((r) => ({ preset: r.preset, meshes: r.meshes, ktriangles: r.ktriangles })));
  if (BUDGET) {
    const over = rows.filter((r) => r.meshes > LIMITS[r.preset].meshes || r.ktriangles > LIMITS[r.preset].ktriangles);
    if (over.length) {
      console.error("Over budget:", over.map((r) => `${r.preset} ${r.meshes} meshes ${r.ktriangles}k triangles (limit ${LIMITS[r.preset].meshes} / ${LIMITS[r.preset].ktriangles}k)`).join("; "));
      process.exitCode = 1;
    }
    const { statSync } = await import("node:fs");
    const kb = Math.round(statSync("dist-single/index.html").size / 1024);
    console.log(`single-file build: ${kb} KB (budget 2200 KB)`);
    if (kb > 2200) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
