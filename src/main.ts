import "./ui/styles.css";
import { crash } from "./core/crash";
import { captureConsole, log } from "./core/log";
import { SettingsStore, suggestPreset } from "./core/settings";
import { BUILD } from "./build";
import { Game } from "./game";
import { demoBattle, demoSettlement } from "./sim/econ/planner";
import { ReportPanel } from "./ui/reportPanel";
import { normaliseSeed, randomSeedWord } from "./sim/seedwords";

declare global {
  interface Window {
    __seedfall?: { ready: boolean; game?: Game; errors: () => number; lastError?: () => unknown; demo?: () => number; battle?: () => number };
  }
}

// The crash reporter goes first so failures during start-up are captured too.
crash.install(window);
captureConsole();
log.info(`Seedfall build ${BUILD.id} (${BUILD.date})`);
window.__seedfall = { ready: false, errors: () => crash.errors.length, lastError: () => crash.errors[crash.errors.length - 1] };

function initialSeed(): string {
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (fromHash) return normaliseSeed(fromHash);
  return randomSeedWord(Math.floor(Math.random() * 2 ** 32));
}

try {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const settings = SettingsStore.load(
    suggestPreset({
      cores: nav.hardwareConcurrency,
      memoryGB: nav.deviceMemory,
      mobile: /Mobi|Android/i.test(nav.userAgent),
    }),
  );
  const root = document.getElementById("app") ?? document.body;
  const game = new Game(root, settings, initialSeed());
  game.start();
  window.__seedfall.game = game;
  window.__seedfall.demo = () => demoSettlement(game.world);
  window.__seedfall.battle = () => demoBattle(game.world);
  window.__seedfall.ready = true;
} catch (err) {
  const e = err as Error;
  // The game UI never came up, so mount a standalone report dialog before capturing.
  document.body.append(new ReportPanel().root);
  crash.capture({ kind: "error", message: `Start-up failed: ${e.message}`, stack: e.stack });
}
