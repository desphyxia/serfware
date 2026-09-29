// Progress screenshots. Usage: node scripts/screenshots.mjs [outDir] [seed]
// Each shot can run a setup function inside the page via window.__seedfall.game.
import { mkdirSync } from "node:fs";
import { launch, openGame } from "./browser.mjs";

const outDir = process.argv[2] ?? "artifacts/shots";
const seed = process.argv[3] ?? "russet-heron-417";
mkdirSync(outDir, { recursive: true });

// Shots can be selected with SHOTS=name1,name2
const all = [
  { name: "orbit", wait: 2500, setup: () => { const g = window.__seedfall.game; g.setHour(10); g.setView(g.cam.maxDistance * 0.62); } },
  { name: "region", wait: 2500, setup: () => { const g = window.__seedfall.game; g.setHour(9); g.setView(60, 0.4); } },
  { name: "ground", wait: 3000, setup: () => { const g = window.__seedfall.game; g.setHour(8); g.setView(16, 0.8, 0.12); } },
  { name: "grid", wait: 2500, setup: () => { const g = window.__seedfall.game; g.setHour(13); g.setView(28, 0.2); g.view.setGrid(true); } },
  { name: "dusk", wait: 2500, setup: () => { const g = window.__seedfall.game; g.setHour(19.2); g.setView(22, 1.2, 0.2); } },
  { name: "night", wait: 2500, setup: () => { const g = window.__seedfall.game; g.setHour(23.5); g.setView(g.cam.maxDistance * 0.55); } },
  { name: "dialogs", wait: 1500, keys: ["Escape", "F3"] },
  { name: "settlement", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4500; i++) g.world.step(); g.setHour(10); g.setView(34, 0.6, 0.05); } },
  { name: "closeup", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 5200; i++) g.world.step(); g.setHour(16); g.setView(9, 2.2, 0.15); } },
  { name: "buildmode", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 1500; i++) g.world.step(); g.setHour(11); g.setView(26, 0.3); g.view.setGrid(true); g.tools.set("woodcutter"); } },
];
const only = process.env.SHOTS?.split(",");
const shots = only ? all.filter((s) => only.includes(s.name)) : all;

const browser = await launch();
try {
  for (const shot of shots) {
    const { page, errors } = await openGame(browser, { seed, width: 1440, height: 900 });
    if (shot.setup) {
      await page.evaluate(shot.setup);
      await page.evaluate(() => {
        const g = window.__seedfall.game;
        g.speed = 0;
        g.renderFrames(40);
      });
    }
    for (const k of shot.keys ?? []) await page.keyboard.press(k);
    await page.waitForTimeout(shot.wait);
    await page.screenshot({ path: `${outDir}/${shot.name}.png` });
    console.log(`${outDir}/${shot.name}.png${errors.length ? ` (errors: ${errors.join("; ")})` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
