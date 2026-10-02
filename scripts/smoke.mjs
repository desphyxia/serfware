// Headless smoke test: the built game starts, renders, opens its dialogs, and reports no errors.
import { mkdirSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const browser = await launch();
let failed = false;
try {
  const { page, errors } = await openGame(browser, { seed: "smoke-test-1" });
  const tick0 = await page.evaluate(() => window.__seedfall.game.world.tick);
  await page.waitForTimeout(2500);
  // Software rendering on CI can take several seconds to compile and draw the first frames:
  // wait (bounded) for the simulation to move, and show any page errors if it never does.
  try {
    await page.waitForFunction((t0) => window.__seedfall.game.world.tick > t0, tick0, { timeout: 30000, polling: 250 });
  } catch {
    throw new Error(`Simulation did not advance from tick ${tick0} within 30 s. Page errors: ${JSON.stringify(errors.slice(0, 5))}`);
  }

  const bugLine = await page.locator(".bugline").textContent();
  if (!bugLine?.includes("seed smoke-test-1") || !bugLine.includes("build ") || !bugLine.includes("Day ")) {
    throw new Error(`Bug line incomplete: ${bugLine}`);
  }
  // It renders. Software rendering on CI takes seconds per frame, which starves the UI of input,
  // so pause the loop while driving the dialogs; frames are drawn on demand further down.
  const tick = await page.evaluate(() => {
    const g = window.__seedfall.game;
    g.hold = true;
    return g.world.tick;
  });
  if (!(tick > tick0)) throw new Error(`Simulation did not advance (tick ${tick0} → ${tick})`);

  await page.keyboard.press("Escape");
  await page.locator("#settings").waitFor({ state: "visible" });
  for (const preset of ["Low", "High", "Medium"]) {
    await page.locator("#settings .seg-b", { hasText: preset }).click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("F3");
  await page.locator("#debug").waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  // Presentation: photo mode and letters open and close, and the interface hides while photographing.
  await page.keyboard.press("F2");
  await page.locator("#photo").waitFor({ state: "visible" });
  if (!(await page.evaluate(() => document.body.classList.contains("photo-clean")))) throw new Error("Photo mode did not hide the interface");
  await page.keyboard.press("F2");
  await page.locator("#photo").waitFor({ state: "hidden" });
  await page.keyboard.press("F4");
  await page.locator("#letters").waitFor({ state: "visible" });
  await page.keyboard.press("F4");
  await page.locator("#letters").waitFor({ state: "hidden" });


  // Draw with the settings the dialogs left behind.
  await page.evaluate(() => window.__seedfall.game.renderFrames(2));
  const reportErrors = await page.evaluate(() => window.__seedfall.errors());
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/smoke.png", timeout: 120000 });
  if (errors.length || reportErrors) {
    throw new Error(`Errors during smoke test:\n${errors.join("\n")}\ncrash reporter errors: ${reportErrors}`);
  }
  console.log(`Smoke test passed. tick=${tick} bugline="${bugLine}"`);
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
