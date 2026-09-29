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
  { name: "evening", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4500; i++) g.world.step(); g.setHour(20.6); g.setView(24, 0.9, 0.1); } },
  { name: "farmland", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 16000; i++) g.world.step(); g.setHour(15); g.setView(40, 1.4, 0.05); } },
  { name: "person", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 9000; i++) g.world.step(); g.setHour(9.5); g.showPerson(true); g.setView(16, 0.7, 0.1); } },
  { name: "people", wait: 2000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 9000; i++) g.world.step(); g.setHour(16); g.setView(28, 1.1); g.economyTab("People"); } },
  { name: "economy", wait: 2000, keys: ["p"], setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 9000; i++) g.world.step(); g.setHour(11); g.setView(30, 0.4); } },
  { name: "territory", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 12000; i++) g.world.step(); g.setHour(19); g.setView(70, 0.5, 0.1); } },
  { name: "lanterns", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 12000; i++) g.world.step(); g.focusBuilding("beacon", 22); g.setHour(21.5); g.setView(22, 2.4, 0.15); } },
  { name: "rival", wait: 3000, setup: () => { const g = window.__seedfall.game; for (let i = 0; i < 30000; i++) g.world.step(); g.setFog(false); g.focusPlayer(1, 60); g.setHour(16.5); g.setView(60, 0.8, 0.1); } },
  { name: "fog", wait: 2500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 12000; i++) g.world.step(); g.focusPlayer(1, g.cam.maxDistance * 0.55); g.setHour(12); g.setView(g.cam.maxDistance * 0.55); } },
  { name: "battle", seed: "amber-fox-12", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); const id = window.__seedfall.battle(); const b = g.world.economy.buildings[id]; for (let i = 0; i < 20000 && b && !b.duel; i++) g.world.step(); for (let i = 0; i < 12; i++) g.world.step(); g.setFog(false); if (b) g.focusTile(b.tile, 12); g.setHour(15); g.setView(12, 2.0, 0.15); if (b) g.selectBuilding(id); } },
  { name: "river", wait: 3000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.focusRiver(12); g.setHour(9.5); g.setView(12, 1.0, 0.1); } },
  { name: "rain", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4000; i++) g.world.step(); g.setHour(14); g.setView(20, 0.7, 0.1); g.summonWeather(1); for (let i = 0; i < 40; i++) g.world.climate.step(g.world.tick); } },
  { name: "winter", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4000; i++) g.world.step(); g.skipDays(17); g.setFog(false); g.focusSnow(34); g.setHour(12); g.setView(34, 0.6, 0.05); } },
  { name: "autumn", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4000; i++) g.world.step(); g.skipDays(11); g.setHour(15.5); g.setView(30, 1.2, 0.05); } },
  { name: "menu", wait: 1500, keys: ["m"], after: () => { const t = document.querySelectorAll("#menu .tab"); t[1]?.click(); } },
  { name: "buildmode", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 1500; i++) g.world.step(); g.setHour(11); g.setView(26, 0.3); g.view.setGrid(true); g.tools.set("woodcutter"); } },
];
// The art shot list (docs/ART_DIRECTION.md § How we check it): rendered after every art batch.
const ART = ["autumn-close", "forest-edge", "figures", "kit-house", "kit-sawmill", "kit-fisher", "hamlet-dawn", "hamlet-noon", "hamlet-dusk", "hamlet-night", "closeup-art", "region-art", "river", "battle", "orbit"];
all.push(
  { name: "hamlet-noon", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 34); g.clearWeather(); g.setHour(12); g.setView(34, 0.5); } },
  { name: "hamlet-dawn", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.clearWeather(); g.setHour(6.4); g.setView(30, 5.2); } },
  { name: "hamlet-dusk", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.clearWeather(); g.setHour(19.4); g.setView(30, 2.4); } },
  { name: "hamlet-night", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.setHour(23.5); g.setView(30, 1.2); } },
  { name: "closeup-art", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 9); g.setHour(10); g.setView(9, 2.2); } },
  { name: "autumn-close", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4000; i++) g.world.step(); g.skipDays(11); g.focusBuilding("woodcutter", 7); g.clearWeather(); g.setHour(15.5); g.setView(7, 2.0); } },
  { name: "forest-edge", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("woodcutter", 9); g.clearWeather(); g.setHour(16.5); g.setView(9, 1.4); } },
  { name: "figures", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusSettler("carrier", 4); g.clearWeather(); g.setHour(11); g.setView(4, 0.9); } },
  { name: "kit-house", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("house", 6); g.clearWeather(); g.setHour(10.5); g.setView(6, 0.6); } },
  { name: "kit-sawmill", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("sawmill", 6); g.clearWeather(); g.setHour(15.5); g.setView(6, 2.6); } },
  { name: "kit-fisher", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("fisher", 6); g.clearWeather(); g.setHour(8.5); g.setView(6, 4.2); } },
  { name: "region-art", wait: 3000, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 70); g.setHour(15); g.setView(70, 0.3); } },
);
const only = process.env.SHOTS === "art" ? ART : process.env.SHOTS?.split(",");
const shots = only ? all.filter((s) => only.includes(s.name)) : all;

const browser = await launch();
try {
  for (const shot of shots) {
    const { page, errors } = await openGame(browser, { seed: shot.seed ?? seed, width: 1440, height: 900 });
    if (shot.setup) {
      await page.evaluate(shot.setup);
      await page.evaluate(() => {
        const g = window.__seedfall.game;
        g.speed = 0;
        g.hold = true;
        g.renderFrames(60);
      });
    }
    for (const k of shot.keys ?? []) await page.keyboard.press(k);
    if (shot.after) await page.evaluate(shot.after);
    await page.waitForTimeout(shot.setup ? 300 : shot.wait);
    // The software GPU is slow: freeze the loop, draw the last frames on demand, then capture.
    // Then let the live loop present a few real frames (a held canvas can show a stale image).
    await page.evaluate(() => {
      const g = window.__seedfall.game;
      g.hold = true;
      g.renderFrames(3);
      g.hold = false;
    });
    await page.evaluate(
      () => new Promise((done) => { let n = 0; const tick = () => (++n >= 3 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }),
    );
    await page.evaluate(() => { window.__seedfall.game.hold = true; });
    await page.screenshot({ path: `${outDir}/${shot.name}.png`, timeout: 180000 });
    console.log(`${outDir}/${shot.name}.png${errors.length ? ` (errors: ${errors.join("; ")})` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
