// Presentation checks and pictures: photo mode, a time-lapse that ends in the same state, a postcard, letters.
// Usage: node scripts/presentation-shots.mjs [outDir]   (needs `npm run build:single` first)
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const outDir = process.argv[2] ?? "artifacts/shots";
mkdirSync(outDir, { recursive: true });
const browser = await launch();
let failed = false;

/** Freeze the loop, draw frames on demand, and let the live loop present a few (software GPUs are slow). */
async function settle(page) {
  await page.evaluate(() => { const g = window.__seedfall.game; g.hold = true; g.renderFrames(10); });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__seedfall.game.renderFrames(3));
  await page.waitForTimeout(300);
}

try {
  const { page, errors } = await openGame(browser, { seed: "russet-heron-417", width: 1440, height: 900 });
  // Everything the demo builds goes through the session, so the log can be replayed.
  await page.evaluate(() => {
    const g = window.__seedfall.game;
    const orig = g.world.command.bind(g.world);
    g.world.command = (c) => {
      const r = orig(c);
      if (r.ok) g.session.log.push({ tick: g.world.tick, cmd: { ...c, player: c.player ?? 0 } });
      return r;
    };
    window.__seedfall.demo();
    g.world.command = orig;
    for (let i = 0; i < 4500; i++) g.world.step();
    g.setFog(false);
    g.setView(34, 0.6, 0.05);
  });

  // A time-lapse of this game: it must end in the very same state.
  const result = await page.evaluate(async () => {
    const g = window.__seedfall.game;
    g.lettersPanel.hide();
    g.speed = 0;
    const endTick = g.world.tick;
    const checksum = g.world.checksum();
    g.startTimelapse();
    const s = g.session;
    s.speed = 100000;
    for (let i = 0; i < 4000 && s.finished === null; i++) s.advance(100);
    return { replay: typeof s.restart === "function" ? "ReplaySession" : "other", finished: s.finished, endTick, tick: g.world.tick, same: g.world.checksum() === checksum };
  });
  console.log("time-lapse", JSON.stringify(result));
  if (result.replay !== "ReplaySession" || result.finished !== true || !result.same) throw new Error("The time-lapse did not end in the same state");
  await page.evaluate(() => { const g = window.__seedfall.game; g.restartTimelapse(); g.session.speed = 128; g.session.advance(60000); g.clearWeather(); g.setView(60, 0.6, 0.05); g.renderFrames(3); });
  await settle(page);
  await page.screenshot({ path: `${outDir}/timelapse.png`, timeout: 180000 });
  await page.evaluate(() => window.__seedfall.game.endTimelapse());
  const back = await page.evaluate(() => typeof window.__seedfall.game.session.restart);
  if (back !== "undefined") throw new Error("Could not go back to the game");
  // The stills come from a fresh page: fair weather and a chosen hour change the simulation outside the log.
  const still = await openGame(browser, { seed: "russet-heron-417", width: 1000, height: 640 });
  const page2 = still.page;
  await page2.evaluate(() => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4500; i++) g.world.step(); g.setFog(false); g.clearWeather(); g.setHour(11); g.setView(30, 0.6, 0.05); g.speed = 0; g.hold = true; g.renderFrames(5); });
  // Photo mode: golden hour, blur, interface hidden except the panel.
  await page2.evaluate(() => {
    const g = window.__seedfall.game;
    g.photoPanel.show();
    g.photo.filter = "dusk";
    g.photo.dof = 0.6;
    g.photo.hourShift = 3;
    g.applyPhoto();
    g.setView(30, 0.6, 0.05);
    g.renderFrames(40);
  });
  await settle(page2);
  await page2.screenshot({ path: `${outDir}/photo-mode.png`, timeout: 180000 });

  // A postcard of the same view.
  const card = await page2.evaluate(async () => {
    const g = window.__seedfall.game;
    g.hold = false;
    const p = g.photoPanel.makePostcard("Smoke over the first lanterns");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return (await p).toDataURL("image/png");
  });
  writeFileSync(`${outDir}/postcard.png`, Buffer.from(card.split(",")[1], "base64"));

  // Back to the plain view; letters.
  await page2.evaluate(() => {
    const g = window.__seedfall.game;
    g.hold = true;
    g.photoPanel.hide();
    g.lettersPanel.receive(JSON.stringify({ format: "seedfall-letter", version: 1, from: "Bram", seed: "amber-fern-212", day: 14, to: "", text: "The lighthouse is lit and the first boat has crossed to the island. Come and see.", sent: "2026-10-01T09:00:00Z" }));
    g.lettersPanel.show();
    g.renderFrames(3);
  });
  await settle(page2);
  await page2.screenshot({ path: `${outDir}/letters.png`, timeout: 180000 });

  if (still.errors.length) throw new Error(still.errors.join("\n"));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Presentation checks passed.");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
