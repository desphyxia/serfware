// Leak hunt in the built game: it plays at speed for a while, swapping worlds, panning the camera and
// opening photo mode, and samples the JS heap (after a forced collection), GPU geometries, textures and
// programs. After a warm-up, a steady climb in any of them fails the run.
// Usage: LEAK_SECONDS=180 node scripts/leak-soak.mjs   (needs `npm run build:single`)
import { writeFileSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const SECONDS = Number(process.env.LEAK_SECONDS ?? 120);
const SWAP_EVERY = Number(process.env.LEAK_SWAP ?? 40);

/** Least-squares slope per minute, and r². */
function trend(ts, vs) {
  const n = ts.length;
  if (n < 4) return { slope: 0, r2: 0 };
  const mx = ts.reduce((a, b) => a + b, 0) / n;
  const my = vs.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (ts[i] - mx) ** 2;
    sxy += (ts[i] - mx) * (vs[i] - my);
    syy += (vs[i] - my) ** 2;
  }
  return { slope: sxx ? (sxy / sxx) * 60000 : 0, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

const browser = await launch();
let failed = false;
try {
  const { page, errors } = await openGame(browser, { seed: "leak-soak-1" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapMB = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "JSHeapUsedSize").value / 1e6;
  };
  await page.evaluate(() => {
    const g = window.__seedfall.game;
    window.__seedfall.demo();
    g.speed = 64;
    g.hold = true;
  });
  const samples = [];
  const t0 = Date.now();
  let lastSwap = t0;
  let swaps = 0;
  let round = 0;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    round++;
    await page.evaluate((round) => {
      const g = window.__seedfall.game;
      g.setView(10 + (round % 7) * 14, (round * 0.7) % 6.28, 0.1 + (round % 3) * 0.1);
      if (round % 5 === 0) g.photoPanel.toggle();
      g.renderFrames(4);
    }, round);
    if ((Date.now() - lastSwap) / 1000 >= SWAP_EVERY) {
      lastSwap = Date.now();
      swaps++;
      await page.evaluate((n) => window.__seedfall.game.newWorld(`leak-soak-${n + 1}`), swaps);
      await page.waitForTimeout(800);
      await page.evaluate(() => { const g = window.__seedfall.game; g.speed = 64; g.hold = true; window.__seedfall.demo(); });
    }
    if (round % 4 === 0) {
      const s = await page.evaluate(() => {
        const st = window.__seedfall.game.gfx.stats();
        let objects = 0;
        window.__seedfall.game.scene.traverse(() => objects++);
        return { geometries: st.geometries, textures: st.textures, programs: st.programs, objects };
      });
      samples.push({ t: Date.now() - t0, heapMB: await heapMB(), ...s });
    }
  }
  writeFileSync("leak-soak.json", JSON.stringify(samples, null, 1));
  // Judge the last two thirds: the first third is warm-up (shaders, caches).
  const tail = samples.slice(Math.floor(samples.length / 3));
  const limits = { heapMB: 6, geometries: 30, textures: 8, programs: 5, objects: 3000 };
  const report = [];
  for (const k of Object.keys(limits)) {
    const { slope, r2 } = trend(tail.map((s) => s.t), tail.map((s) => s[k]));
    const first = tail[0][k], last = tail[tail.length - 1][k];
    report.push(`${k}: ${first} → ${last} (${slope.toFixed(1)}/min, r²=${r2.toFixed(2)})`);
    // A climb counts only if it is steady (r² high) and over the limit per minute.
    if (slope > limits[k] && r2 > 0.6) {
      failed = true;
      report.push(`  ^ LEAK? over ${limits[k]}/min`);
    }
  }
  console.log(`${samples.length} samples over ${SECONDS}s, ${swaps} world swaps\n${report.join("\n")}`);
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
