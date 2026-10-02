// GPU limits check. WebGPU allows 8 vertex buffers per draw (the spec's default, and all a lot
// of Windows GPUs offer); WebGL2 allows 16, so the other headless tests (on WebGL2, since this
// container cannot keep a WebGPU device) would never notice a draw that needs more. three.js
// builds the same render objects on both backends, so this counts each draw's vertex buffers
// on WebGL2 with the High preset and fails if any would be over WebGPU's limit.
import { launch, openGame } from "./browser.mjs";

const LIMIT = 8;
const HIGH = { resolutionScale: 1, shadows: "soft", shadowMapSize: 4096, msaa: 4, bloom: true, vegetation: 1, particles: 1, maxFps: 0, terrainDetail: "high", atmosphere: "scattering", ao: true, dof: true, backend: "auto" };

const browser = await launch();
const ctx = await browser.newContext();
await ctx.addInitScript((g) => {
  window.localStorage.setItem("seedfall.settings.v1", JSON.stringify({ version: 1, graphics: g }));
}, HIGH);
const { page, errors } = await openGame(ctx, { seed: "gpu-limits-1" });
const worst = await page.evaluate(async (limit) => {
  const game = window.__seedfall.game;
  const r = game.gfx.renderer;
  const found = new Map();
  let most = 0;
  const objects = r._objects;
  const get = objects.get.bind(objects);
  objects.get = (...args) => {
    const ro = get(...args);
    try {
      const n = ro.getVertexBuffers().length;
      most = Math.max(most, n);
      if (n > limit) {
        const o = ro.object;
        const key = `${o.name || o.type}/${ro.material.type}${ro.material.name ? ":" + ro.material.name : ""}`;
        found.set(key, `${n} buffers (${Object.keys(ro.geometry.attributes).join(", ")})`);
      }
    } catch {
      // A render object without a pipeline yet: counted on its next frame.
    }
    return ro;
  };
  // Everything the art shot list shows: a grown settlement, weather, night lights, the sky.
  window.__seedfall.demo?.();
  for (const h of [9, 13, 18, 22]) {
    game.setHour?.(h);
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { most, over: [...found.entries()] };
}, LIMIT);
await browser.close();
console.log(`most vertex buffers in one draw: ${worst.most} (WebGPU allows ${LIMIT})`);
for (const [k, v] of worst.over) console.log(`FAIL ${k}: ${v}`);
for (const e of errors) console.log(`page error: ${e}`);
if (worst.over.length || errors.length) process.exit(1);
console.log("GPU limits check passed.");
