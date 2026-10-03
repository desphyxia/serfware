// Starting a new world must not leave GPU textures behind. Starts nine worlds in the built game and
// counts the renderer's textures after each; from the fifth on (when drawing has begun) the count may
// grow by at most 4 a world. (It used to grow by 12: the tile-data textures, and a pair of screen-
// space textures for each water node, were never freed. Three depth textures per world still leak,
// from three.js's own render-object bookkeeping; see README.) Usage: node scripts/swap-leak.mjs
import { launch, openGame } from "./browser.mjs";

const browser = await launch();
let failed = false;
try {
  const { page, errors } = await openGame(browser, { seed: "swap-0" });
  const counts = await page.evaluate(async () => {
    const g = window.__seedfall.game;
    g.speed = 0;
    g.hold = true;
    const out = [];
    for (let i = 1; i <= 9; i++) {
      await g.newWorld(`swap-${i}`);
      g.renderFrames(3);
      out.push(g.gfx.stats().textures);
    }
    return out;
  });
  console.log("textures after each new world:", counts.join(" "));
  const tail = counts.slice(4);
  const growth = (tail[tail.length - 1] - tail[0]) / (tail.length - 1);
  console.log(`growth ${growth.toFixed(1)} a world`);
  if (growth > 4) throw new Error(`Textures leak: ${growth.toFixed(1)} a world`);
  if (errors.length) throw new Error(errors.join("\n"));
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
