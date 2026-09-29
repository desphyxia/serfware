// Two headless browsers play a co-op game over real WebRTC data channels, connected through the
// signalling server. Fails if they desync or stop advancing.
import { chromium } from "playwright";
import { gameUrl } from "./browser.mjs";
import { startSignalServer } from "./signal.mjs";

const PORT = 8799;
const server = `ws://localhost:${PORT}`;
const wss = startSignalServer(PORT);
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"],
});
let failed = false;
const mode = process.env.MP_MODE ?? "shared";
try {
  const open = async (name) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(gameUrl("mp-test-seed"));
    await page.waitForFunction(() => window.__seedfall?.ready === true, null, { timeout: 60000 });
    await page.evaluate(() => {
      const s = window.__seedfall.game.settings;
      s.applyPreset("low");
      // This test is about the simulation and the network; software rendering only slows it down.
      window.__seedfall.game.hold = true;
    });
    return { page, errors };
  };
  const host = await open("host");
  const guest = await open("guest");

  await host.page.evaluate(async ([server, mode]) => {
    window.__lobby = await window.__seedfall.game.hostLobby({ name: "Host", server, room: "mp-test", ice: [] }, mode);
  }, [server, mode]);
  await guest.page.evaluate(async (server) => {
    window.__lobby = await window.__seedfall.game.joinLobby({ name: "Guest", server, room: "mp-test", ice: [] });
  }, server);
  for (let i = 0; i < 20; i++) {
    const hs = await host.page.evaluate(() => ({ s: window.__lobby.status, n: window.__lobby.players.length, peers: window.__lobby.transport.peers }));
    const gs = await guest.page.evaluate(() => ({ s: window.__lobby.status, id: window.__lobby.playerId }));
    if (process.env.MP_DEBUG) console.log(JSON.stringify(hs), JSON.stringify(gs));
    if (hs.n === 2) break;
    await host.page.waitForTimeout(1000);
  }
  await host.page.waitForFunction(() => window.__lobby.players.length === 2, null, { timeout: 30000 });
  await guest.page.waitForFunction(() => window.__lobby.playerId === 1, null, { timeout: 30000 });
  console.log("Lobby connected over WebRTC.");

  await host.page.evaluate((mode) => window.__seedfall.game.startLobby(window.__lobby, mode), mode);
  await guest.page.waitForFunction(() => window.__seedfall.game.session.info.mode !== "solo", null, { timeout: 15000 });
  console.log(`Game started (${mode}).`);

  // Drive both simulations quickly, independent of (slow, software) rendering.
  for (const p of [host.page, guest.page]) {
    await p.evaluate(() => {
      const g = window.__seedfall.game;
      setInterval(() => g.session.advance(100, 4), 10);
    });
  }
  // Each side builds something through its session.
  const build = (p) =>
    p.evaluate(() => {
      const g = window.__seedfall.game;
      const w = g.world;
      const player = g.session.player;
      const keep = w.economy.buildings[w.economy.keeps[player]];
      const land = w.land;
      for (const t of land.ring(keep.tile, 6)) {
        const flag = land.bestFlagTile(t, player);
        if (flag < 0 || !land.canBuild(t, flag, false, player)) continue;
        const kf = w.economy.flags[keep.flag].tile;
        const path = land.findPath(kf, flag, (x) => land.roadable(x, player) && x !== t, 2000);
        if (!path || path.length < 3 || w.economy.checkRoad(path, player)) continue;
        if (!g.command({ t: "build", type: "woodcutter", tile: t, flagTile: flag })) continue;
        return t;
      }
      return -1;
    });
  console.log("host placed at", await build(host.page));
  await host.page.waitForTimeout(1500);
  console.log("guest placed at", await build(guest.page));
  await host.page.waitForTimeout(8000);

  const state = (p) =>
    p.evaluate(() => {
      const s = window.__seedfall.game.session;
      return { tick: s.world.tick, status: s.status(), buildings: s.world.economy.buildings.filter((b) => b.alive).length };
    });
  const hs = await state(host.page);
  const gs = await state(guest.page);
  console.log("host", hs, "guest", gs);
  const turn = Math.floor(Math.min(hs.tick, gs.tick) / 2) - 1;
  const [a, b] = await Promise.all([host.page, guest.page].map((p) => p.evaluate((t) => window.__seedfall.game.session.checksumAt(t), turn)));
  console.log(`checksums at turn ${turn}: ${a?.toString(16)} ${b?.toString(16)}`);
  if (hs.tick < 200 || gs.tick < 200) throw new Error("Simulation did not advance enough");
  if (a === undefined || a !== b) throw new Error("Checksums differ: desync");
  if (hs.buildings < (mode === "neighbours" ? 3 : 2)) throw new Error("Commands were not applied");
  const errs = [...host.errors, ...guest.errors];
  if (errs.length) throw new Error(errs.join("\n"));
  console.log("Multiplayer test passed.");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  wss.close();
}
process.exit(failed ? 1 : 0);
