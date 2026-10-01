// The game on a phone-sized touch screen: every tool reachable, taps aim where they land, long
// presses cancel or explain, and two-finger gestures zoom, turn and tilt. Real touch events go
// in through the DevTools protocol (Chromium; not Safari).
import { launch, gameUrl } from "./browser.mjs";

const browser = await launch();
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed = true;
};
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(gameUrl("touch-test-1"));
  await page.waitForFunction(() => window.__seedfall?.ready === true, null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__seedfall.game;
    g.settings.applyPreset("low");
    g.focusPlayer(0, 18);
    g.speed = 0;
  });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const hold = async (x, y, ms) => {
    await touch("touchStart", [[x, y]]);
    await page.waitForTimeout(ms);
    await touch("touchEnd", []);
  };
  const two = async (from, to, steps = 8) => {
    await touch("touchStart", from);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      await touch("touchMove", from.map(([x, y], k) => [x + (to[k][0] - x) * f, y + (to[k][1] - y) * f]));
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(400);
  };

  // 1. Every tool button is on screen and big enough for a finger.
  const boxes = await page.$$eval(".bb", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: e.getAttribute("aria-label"), x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const off = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > 390.5 || b.y + b.h > 844.5);
  check(boxes.length >= 15 && off.length === 0, `all ${boxes.length} tool buttons on screen${off.length ? ` (off: ${off.map((b) => b.l).join(", ")})` : ""}`);
  check(boxes.every((b) => b.h >= 40), `buttons at least 40 px tall (smallest ${Math.min(...boxes.map((b) => b.h)).toFixed(0)})`);

  // 2. Press and hold a tool button: its explanation, and the tool is not picked.
  const lantern = boxes.find((b) => b.l === "Diplomacy");
  await hold(lantern.x + lantern.w / 2, lantern.y + lantern.h / 2, 800);
  await page.waitForTimeout(200);
  const toast = await page.$eval(".toasts", (e) => e.textContent ?? "");
  const dipOpen = await page.evaluate(() => !document.getElementById("diplomacy")?.hidden);
  check(/Diplomacy:/.test(toast) && !dipOpen, "press and hold a button explains it (and does not press it)");

  // 3. Tap the Hearthship in the middle of the screen: it is selected.
  await page.touchscreen.tap(195, 422);
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => { const el = document.querySelector(".panel.info, #info"); return el && !el.hidden ? el.textContent : ""; });
  check(/Hearthship/i.test(info ?? ""), "a tap on the Hearthship selects it");

  // Close the Hearthship's panel again (on a phone it covers the top of the screen).
  await page.evaluate(() => window.__seedfall.game.escape?.() ?? document.querySelector("#info .panel-x, .panel.info .panel-x")?.click());
  await page.waitForTimeout(300);

  // 4. With a building in hand, a long press on the ground puts it away.
  await page.evaluate(() => window.__seedfall.game.tools.set("woodcutter"));
  await hold(195, 560, 900);
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.__seedfall.game.tools.tool)) === "select", "a long press cancels the tool in hand");

  // 5. Two fingers: pinch to zoom, twist to turn, slide together to tilt.
  const cam = () => page.evaluate(() => { const c = window.__seedfall.game.cam; return { d: c.tDistance, h: c.tHeading, p: c.tPitchOffset }; });
  let a = await cam();
  await two([[150, 400], [240, 440]], [[90, 380], [300, 460]]);
  let b = await cam();
  check(b.d < a.d * 0.8, `pinch out zooms in (${a.d.toFixed(1)} → ${b.d.toFixed(1)})`);
  a = b;
  await two([[150, 420], [240, 420]], [[170, 360], [220, 480]]);
  b = await cam();
  check(Math.abs(b.h - a.h) > 0.3, `twist turns (${a.h.toFixed(2)} → ${b.h.toFixed(2)})`);
  a = b;
  await two([[150, 500], [240, 500]], [[150, 400], [240, 400]]);
  b = await cam();
  check(Math.abs(b.p - a.p) > 0.2, `two fingers sliding up tilt (${a.p.toFixed(2)} → ${b.p.toFixed(2)})`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
}
console.log(failed ? "Touch test failed." : "Touch test passed.");
process.exit(failed ? 1 : 0);
