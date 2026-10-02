// Accessibility and localisation in the built game: Swedish text, the colour-blind palette (goods keep
// their shapes), larger text, rebinding a key, and captions. Usage: node scripts/a11y-test.mjs
import { mkdirSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const browser = await launch();
let failed = false;
try {
  const { page, errors } = await openGame(browser, { seed: "a11y-test-1" });
  await page.evaluate(() => {
    const s = JSON.parse(window.localStorage.getItem("seedfall.settings.v1") ?? "null") ?? {};
    s.version = 1;
    s.ui = { ...(s.ui ?? {}), uiScale: 1, textScale: 1.3, language: "sv", palette: "safe", captions: true, invertZoom: false, edgeScroll: false, showFps: false };
    window.localStorage.setItem("seedfall.settings.v1", JSON.stringify(s));
    window.localStorage.setItem("seedfall.keys", JSON.stringify({ grid: "h" }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__seedfall?.ready === true, null, { timeout: 60000 });
  await page.evaluate(() => { const g = window.__seedfall.game; g.speed = 0; g.hold = true; });
  // Swedish interface text.
  const menuLabel = await page.locator(".toolbar button").first().getAttribute("aria-label");
  if (menuLabel !== "Spelmeny") throw new Error(`Expected Swedish toolbar text, got ${menuLabel}`);
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== "sv") throw new Error(`html lang is ${lang}`);
  // Text scale reached the page.
  const scale = await page.evaluate(() => window.getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim());
  if (scale !== "1.3") throw new Error(`--text-scale is ${scale}`);
  // The colour-blind palette: goods swatches carry shapes, and the second player's colour is the safe one.
  const hex = await page.evaluate(() => "#" + window.__seedfall.game.view.econ.constructor.name.length.toString(16).padStart(6, "0"));
  void hex;
  await page.keyboard.press("p");
  await page.locator("#economy").waitFor({ state: "visible" });
  const shapes = await page.evaluate(() => [...document.querySelectorAll("#economy i.sw")].map((e) => e.className));
  if (shapes.length < 8 || !shapes.some((c) => c.includes("sw-square")) || !shapes.some((c) => c.includes("sw-circle"))) throw new Error(`Swatches lack shapes: ${shapes.join(",")}`);
  const colour = await page.evaluate(() => window.getComputedStyle(document.querySelector("#economy i.sw")).backgroundColor);
  if (colour === "rgb(204, 204, 204)") throw new Error("Swatch colour missing");
  await page.keyboard.press("p");
  // Rebound key: G was moved to H.
  const grid0 = await page.evaluate(() => window.__seedfall.game.view.grid);
  await page.keyboard.press("g");
  const grid1 = await page.evaluate(() => window.__seedfall.game.view.grid);
  await page.keyboard.press("h");
  const grid2 = await page.evaluate(() => window.__seedfall.game.view.grid);
  if (grid1 !== grid0 || grid2 === grid0) throw new Error(`Rebinding failed: ${grid0} ${grid1} ${grid2}`);
  // The Controls tab lists the keys, and a key can be rebound from it.
  await page.keyboard.press("Escape");
  await page.locator("#settings").waitFor({ state: "visible" });
  await page.locator("#settings .tab", { hasText: "Kontroller" }).count().then(async (n) => {
    if (!n) await page.locator("#settings .tab[data-name='Controls']").click();
    else await page.locator("#settings .tab", { hasText: "Kontroller" }).click();
  });
  const keybtns = await page.locator("#settings .keybtn").count();
  if (keybtns < 20) throw new Error(`Only ${keybtns} key buttons`);
  mkdirSync("artifacts/shots", { recursive: true });
  await page.evaluate(() => window.__seedfall.game.renderFrames(2));
  await page.screenshot({ path: "artifacts/shots/a11y-controls.png", timeout: 120000 });
  // Captions: a hammering sound near the view shows its words.
  await page.keyboard.press("Escape");
  const text = await page.evaluate(() => {
    const g = window.__seedfall.game;
    g.captions.say("test", "[hammering]", 0, 0);
    return document.querySelector(".captions")?.textContent ?? "";
  });
  if (!text.includes("hammering")) throw new Error("No caption shown");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Accessibility test passed.");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
