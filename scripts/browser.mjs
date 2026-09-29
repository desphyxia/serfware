// Shared headless-browser launcher for smoke tests and screenshots.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function launch() {
  return chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
}

/** URL of the built single-file game, optionally with a seed. */
export function gameUrl(seed) {
  const file = resolve("dist-single/index.html");
  if (!existsSync(file)) throw new Error("Run `npm run build:single` first.");
  return pathToFileURL(file).href + (seed ? `#${seed}` : "");
}

export async function openGame(browser, { seed, width = 1280, height = 800 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(gameUrl(seed));
  await page.waitForFunction(() => window.__seedfall?.ready === true, null, { timeout: 60000 });
  return { page, errors };
}
