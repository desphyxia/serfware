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
const ART = ["terra-barren", "terra-works", "terra-green", "terra-bloom", "terra-map", "rail", "launch", "voyage-map", "orbit", "colony", "system-map", "survey-1", "survey-2", "skyreef", "ropeway", "lumen-mire", "locked-planet", "kit-heights", "tide-high", "tide-low", "spires", "spires-night", "sandstorm", "kit-coast", "ice-road", "vent", "eruption", "ash", "aurora", "kit-frontier", "canopy", "treehouse", "meadow-orchard", "apiary", "hedgerows", "radial", "radial-food", "deck", "wildfire", "burnt", "regrowth", "kit-well", "kit-hunter", "weathered", "hearthship", "grove-birch", "grove-pine", "grove-palm", "poses", "pasture", "gallery-1", "gallery-2", "gallery-3", "construction", "snow-roofs", "horizon-dusk", "winter-hamlet", "autumn-close", "forest-edge", "figures", "kit-house", "kit-sawmill", "kit-fisher", "hamlet-dawn", "hamlet-noon", "hamlet-dusk", "hamlet-night", "closeup-art", "region-art", "river", "battle", "orbit"];
all.push(
  { name: "terra-barren", wait: 4500, setup: () => { const g = window.__seedfall.game; g.terraDemo("barren"); g.clearWeather(); g.setHour(10); g.focusPlayer(0, 30); g.setView(30, 0.8, 0.25); } },
  { name: "terra-works", wait: 4500, setup: () => { const g = window.__seedfall.game; g.terraDemo("works"); g.clearWeather(); g.setHour(10.5); g.focusPlayer(0, 24); g.setView(24, 2.3, 0.2); } },
  { name: "terra-green", wait: 4500, setup: () => { const g = window.__seedfall.game; g.terraDemo("green"); g.clearWeather(); g.setHour(11); g.focusPlayer(0, 34); g.setView(34, 0.8, 0.3); } },
  { name: "terra-bloom", wait: 4500, setup: () => { const g = window.__seedfall.game; g.terraDemo("bloom"); g.clearWeather(); g.setHour(11); g.focusPlayer(0, 34); g.setView(34, 0.8, 0.3); } },
  { name: "terra-map", wait: 3000, setup: () => { const g = window.__seedfall.game; const to = g.terraDemo("green"); g.setHour(11); g.focusPlayer(0, 60); g.setView(60, 0.3); g.systemMap.show(); g.systemMap.select(to); } },
  { name: "rail", wait: 3000, setup: () => { const g = window.__seedfall.game; g.colonyDemo("rail"); g.clearWeather(); g.setHour(10.5); g.setView(11, 2.2, 0.45); } },
  { name: "launch", wait: 3000, setup: () => { const g = window.__seedfall.game; g.colonyDemo("launch"); g.clearWeather(); g.setHour(16); const w = g.session.world; w.voyages.list[0].departs = w.tick - 110; g.setView(26, 0.9, 0.3); } },
  { name: "voyage-map", wait: 3000, setup: () => { const g = window.__seedfall.game; g.colonyDemo("launch"); const w = g.session.world; const v = w.voyages.list[0]; v.departs = w.tick - 3000; v.arrives = w.tick + 4000; const ps = w.system.planets.filter((p) => p.surface && !p.home); g.setHour(11); g.setView(60, 0.3); g.systemMap.show(); g.systemMap.select((ps[1] ?? ps[0]).index); } },
  { name: "orbit", wait: 4500, setup: () => { const g = window.__seedfall.game; g.colonyDemo("orbit"); g.clearWeather(); g.setHour(11); g.setView(60, 0.4, 0.25); } },
  { name: "colony", wait: 4500, setup: () => { const g = window.__seedfall.game; g.colonyDemo("colony"); g.clearWeather(); g.setHour(10); const w = g.session.world; const run = w.voyages.list.find((v) => v.route >= 0); if (run) run.arrives = w.tick + 110; g.focusPlayer(0, 20); g.setView(20, 0.8, 0.1); } },
  { name: "system-map", wait: 3000, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 60); g.setHour(11); g.setView(60, 0.3); g.systemMap.show(); } },
  { name: "survey-1", wait: 4500, setup: () => { const g = window.__seedfall.game; g.session.world.voyages.surveyed[0] = 0xffff; const ps = g.system.planets.filter((p) => p.surface && !p.home); if (ps[0]) g.visitPlanet(ps[0].index, true); g.clearWeather(); g.setHour(11); g.setView(g.cam.maxDistance * 0.6, 0.3); } },
  { name: "survey-2", wait: 4500, setup: () => { const g = window.__seedfall.game; g.session.world.voyages.surveyed[0] = 0xffff; const ps = g.system.planets.filter((p) => p.surface && !p.home); const p = ps[1] ?? ps[0]; if (p) g.visitPlanet(p.index, true); g.clearWeather(); g.setHour(15); g.setView(26, 0.9, 0.1); } },
);
all.push(
  { name: "skyreef", seed: "ai-rival-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugSkyreef(false, 34); g.setHour(16.5); g.setView(34, 0.6, 0.45); } },
  { name: "ropeway", seed: "ai-rival-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugSkyreef(true, 24); g.setHour(11); g.setView(24, 1.2, 0.4); } },
  { name: "lumen-mire", seed: "lumen-28", wait: 4500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugLumen(14); g.setView(14, 1.1, 0.25); } },
  { name: "locked-planet", seed: "lumen-28", wait: 3000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusTwilight(1); g.setView(g.cam.maxDistance * 0.62, 0.3); } },
  { name: "kit-heights", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 14); g.clearWeather(); g.setHour(15); g.showcase(["glowcapfarm", "peatcutter", "ropeway"], 12); g.setView(12, 0.4); } },
);
all.push(
  { name: "tide-high", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugTidewater(true, 14); g.setView(14, 1.0, 0.12); } },
  { name: "tide-low", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugTidewater(false, 14); g.setView(14, 1.0, 0.12); } },
  { name: "spires", seed: "salt-1", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusRegion(5, 22); g.setHour(17.8); g.setView(22, 0.9, 0.12); } },
  { name: "spires-night", seed: "salt-1", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusRegion(5, 22); g.setHour(22.5); g.setView(22, 0.9, 0.12); } },
  { name: "sandstorm", seed: "salt-1", wait: 5000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusRegion(5, 24); g.debugStorm(3, 24); g.clearWeather(); g.setHour(14); g.setView(24, 0.9, 0.1); } },
  { name: "kit-coast", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 16); g.clearWeather(); g.setHour(15); g.showcase(["saltworks", "solarkiln", "dewcondenser", "shellfisher", "tidemill"], 16); g.setView(16, 0.4); } },
);
all.push(
  { name: "ice-road", seed: "hedge-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); const w = g.world; const lake = g.debugIceRoad(11); if (lake >= 0) { for (let i = 0; i < 2400; i++) { w.tick++; w.economy.step(w.tick); } g.focusTile(lake, 11); } g.setHour(13); g.setView(11, 1.1, 0.12); } },
  { name: "vent", seed: "frost-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); const t = g.debugVent(false, 11); if (t >= 0) g.world.land.amount[t] = 220; g.setHour(16.5); g.setView(11, 0.9, -0.05); } },
  { name: "eruption", seed: "frost-1", wait: 6000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.setHour(20.2); g.debugVent(true, 16); g.setView(16, 1.1, 0.1); } },
  { name: "ash", seed: "frost-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugVent(true, 18); for (let i = 0; i < 400; i++) g.world.step(); g.debugVent(false, 18); g.clearWeather(); g.setHour(11); g.setView(18, 1.2, 0.1); } },
  { name: "aurora", seed: "hedge-1", wait: 4000, setup: () => { const g = window.__seedfall.game; g.clearWeather(); g.setFog(false); g.focusRiver(30); g.sky.auroraForce = 1; g.setHour(23.2); g.setView(30, 1.6, 1.2); } },
  { name: "kit-frontier", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 14); g.clearWeather(); g.setHour(15); g.showcase(["waystation", "greenhouse"], 10); g.setView(10, 0.4); } },
);
all.push(
  { name: "canopy", seed: "deep-green-7", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusRegion(2, 30); g.setHour(10.5); g.setView(30, 0.8, 0.02); } },
  { name: "treehouse", seed: "deep-green-7", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.debugTreehouse(9); g.setHour(16.5); g.setView(9, 2.1, 0.14); } },
  { name: "meadow-orchard", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 16000; i++) g.world.step(); g.focusBuilding("orchard", 11); g.clearWeather(); g.setHour(11); g.setView(11, 1.0, 0.1); } },
  { name: "apiary", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 9000; i++) g.world.step(); g.focusBuilding("apiary", 5); g.clearWeather(); g.setHour(13); g.setView(5, 0.9); } },
  { name: "hedgerows", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 16000; i++) g.world.step(); const land = g.world.land; let h = -1; for (let t = 0; t < land.feature.length && h < 0; t++) if (land.feature[t] === 6) h = t; if (h >= 0) g.focusTile(h, 10); g.clearWeather(); g.setHour(15); g.setView(10, 0.9, 0.08); } },
  { name: "radial", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 28); g.clearWeather(); g.setHour(11); g.setView(28, 0.6); g.controllerPreview(); g.radial.show(); g.radial.aim(0.72, -0.7); } },
  { name: "radial-food", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 28); g.clearWeather(); g.setHour(11); g.setView(28, 0.6); g.controllerPreview(); g.radial.show(); g.radial.aim(0.34, 0.94); g.radial.confirm(); g.radial.aim(0.2, -0.98); } },
  { name: "deck", width: 1280, height: 800, wait: 3500, setup: () => { const g = window.__seedfall.game; g.settings.applyPreset("deck"); window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 22); g.clearWeather(); g.setHour(15); g.setView(22, 1.2); g.controllerPreview(); } },
  { name: "wildfire", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 20); g.clearWeather(); g.setFog(false); g.startFire(150, 15); g.setHour(19.9); g.setView(15, 1.3, 0.12); } },
  { name: "burnt", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 20); g.clearWeather(); g.setFog(false); g.startFire(2400, 16); g.setHour(11); g.setView(16, 1.3, 0.1); } },
  { name: "regrowth", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 20); g.clearWeather(); g.setFog(false); g.startFire(4000, 16); for (let i = 0; i < 7200 * 4; i++) g.world.step(); g.clearWeather(); g.setHour(10.5); g.setView(16, 1.3, 0.1); } },
  { name: "kit-well", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("well", 5); g.clearWeather(); g.setHour(10.5); g.setView(5, 0.8); } },
  { name: "kit-hunter", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("hunter", 6); g.clearWeather(); g.setHour(15); g.setView(6, 2.0); } },
  { name: "weathered", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(11); g.showcase(["house", "house", "smelter", "storehouse"], 16, [1, 1.5, 2, 2]); g.setView(16, 0.35); } },
  { name: "grove-birch", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusSpecies(2, 13); g.setHour(10.5); g.setView(13, 1.4, 0.12); } },
  { name: "grove-pine", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusSpecies(3, 13); g.setHour(10.5); g.setView(13, 1.4, 0.12); } },
  { name: "grove-palm", wait: 3500, setup: () => { const g = window.__seedfall.game; g.setFog(false); g.clearWeather(); g.focusSpecies(4, 13); g.setHour(10.5); g.setView(13, 1.4, 0.12); } },
  { name: "hearthship", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 14); g.clearWeather(); g.setHour(10); g.setView(14, 2.3, 0.1); } },
  { name: "hamlet-noon", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 34); g.clearWeather(); g.setHour(12); g.setView(34, 0.5); } },
  { name: "hamlet-dawn", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.clearWeather(); g.setHour(6.4); g.setView(30, 5.2); } },
  { name: "hamlet-dusk", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.clearWeather(); g.setHour(19.4); g.setView(30, 2.4); } },
  { name: "hamlet-night", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 30); g.setHour(23.5); g.setView(30, 1.2); } },
  { name: "closeup-art", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 9); g.setHour(10); g.setView(9, 2.2); } },
  { name: "horizon-dusk", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusPlayer(0, 16); g.clearWeather(); g.setHour(19.0); g.setView(16, 1.6, 0.55); } },
  { name: "poses", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(10.5); g.showPoses(7); g.setView(7, 0.2); } },
  { name: "pasture", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); g.focusBuilding("pasture", 6); g.clearWeather(); g.setHour(9.5); g.setView(6, 1.1); } },
  { name: "gallery-1", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(10.5); g.showcase(["keep", "storehouse", "farm", "mill", "bakery"], 21); g.setView(21, 0.35); } },
  { name: "gallery-2", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(14.5); g.showcase(["ironmine", "smelter", "goldsmith", "toolsmith", "quarry"], 20); g.setView(20, 0.35); } },
  { name: "gallery-3", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(16); g.showcase(["woodcutter", "forester", "butcher", "pasture", "lantern", "lamphouse", "beacon"], 21); g.setView(21, 0.35); } },
  { name: "construction", wait: 3500, setup: () => { const g = window.__seedfall.game; g.focusPlayer(0, 20); g.clearWeather(); g.setHour(11); g.showcase(["house", "house", "house", "house", "house", "woodcutter"], 17, [0.03, 0.25, 0.5, 0.8, 1, -1]); g.setView(17, 0.35); } },
  { name: "snow-roofs", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 6000; i++) g.world.step(); const sc = g.world.land.snowCover; for (let t = 0; t < sc.length; t++) sc[t] = 0.9; g.world.climate.version++; g.focusBuilding("sawmill", 9); g.clearWeather(); g.setHour(11); g.setView(9, 2.2); } },
  { name: "winter-hamlet", wait: 3500, setup: () => { const g = window.__seedfall.game; window.__seedfall.demo(); for (let i = 0; i < 4000; i++) g.world.step(); g.skipDays(17); g.focusPlayer(0, 22); g.clearWeather(); g.setHour(11); g.setView(22, 0.8); } },
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
    const { page, errors } = await openGame(browser, { seed: shot.seed ?? seed, width: shot.width ?? 1440, height: shot.height ?? 900 });
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
