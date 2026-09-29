// Progress screenshots. Usage: node scripts/screenshots.mjs [outDir] [seed]
// Each shot can run a setup function inside the page via window.__seedfall.game.
import { mkdirSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const outDir = process.argv[2] ?? "artifacts/shots";
const seed = process.argv[3] ?? "russet-heron-417";
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: "overview", wait: 2500 },
  { name: "dialogs", wait: 1500, keys: ["Escape", "F3"] },
];

const browser = await launch();
try {
  for (const shot of shots) {
    const { page, errors } = await openGame(browser, { seed, width: 1440, height: 900 });
    if (shot.setup) await page.evaluate(shot.setup);
    for (const k of shot.keys ?? []) await page.keyboard.press(k);
    await page.waitForTimeout(shot.wait);
    await page.screenshot({ path: `${outDir}/${shot.name}.png` });
    console.log(`${outDir}/${shot.name}.png${errors.length ? ` (errors: ${errors.join("; ")})` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
