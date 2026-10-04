import "./ui/styles.css";
import { crash } from "./core/crash";
import { captureConsole, log } from "./core/log";
import { setPalette } from "./core/access";
import { setLanguage } from "./core/i18n";
import "./locales";
import { applyPlayerPalette } from "./render/players";
import { SettingsStore, suggestPreset } from "./core/settings";
import { BUILD } from "./build";
import { Game } from "./game";
import { bootScreen } from "./ui/bootScreen";
import { demoBattle, demoSettlement, placeConnected } from "./sim/econ/planner";
import { ReportPanel } from "./ui/reportPanel";
import { normaliseSeed, randomSeedWord } from "./sim/seedwords";

declare global {
  interface Window {
    __seedfall?: { ready: boolean; game?: Game; errors: () => number; lastError?: () => unknown; demo?: () => number; battle?: () => number; place?: (type: string) => boolean };
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

async function boot(): Promise<void> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const settings = SettingsStore.load(
    suggestPreset({
      cores: nav.hardwareConcurrency,
      memoryGB: nav.deviceMemory,
      mobile: /Mobi|Android/i.test(nav.userAgent),
    }),
  );
  // Language and colours are chosen before anything is drawn (changing them reloads the page).
  setLanguage(settings.get().ui.language);
  setPalette(settings.get().ui.palette as "default" | "safe");
  applyPlayerPalette();
  document.documentElement.lang = settings.get().ui.language;
  const root = document.getElementById("app") ?? document.body;
  bootScreen.set(0.05, "Shaping the planet");
  await new Promise((r) => setTimeout(r, 40));
  const game = new Game(root, settings, initialSeed());
  await game.start();
  const sf = window.__seedfall as NonNullable<typeof window.__seedfall>;
  sf.game = game;
  sf.demo = () => demoSettlement(game.world);
  sf.battle = () => demoBattle(game.world);
  sf.place = (type: string) => placeConnected(game.world, type, { minDist: 2, maxDist: 8 });
  sf.ready = true;
}

boot().catch((err: unknown) => {
  const e = err as Error;
  bootScreen.hide();
  // The game UI never came up, so mount a standalone report dialog before capturing.
  document.body.append(new ReportPanel().root);
  crash.capture({ kind: "error", message: `Start-up failed: ${e.message}`, stack: e.stack });
});
