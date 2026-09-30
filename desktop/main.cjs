// Seedfall desktop: the web build (app/index.html) in an Electron window, with Steamworks
// (lobbies, P2P networking, overlay, rich presence, achievements, Steam Cloud) behind a small
// IPC bridge (preload.cjs). Without Steam running the game still starts; the bridge then reports
// that Steam is unavailable and the game falls back to its web features.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/** App id: steam_appid.txt beside the executable (dev and test builds), else Spacewar (480). */
function appId() {
  for (const dir of [path.dirname(process.execPath), __dirname, process.cwd()]) {
    try {
      const n = Number(fs.readFileSync(path.join(dir, "steam_appid.txt"), "utf8").trim());
      if (n > 0) return n;
    } catch {
      // Not here; try the next place.
    }
  }
  return 480;
}

let steamworks = null;
let client = null;
try {
  steamworks = require("steamworks.js");
  client = steamworks.init(appId());
  steamworks.electronEnableSteamOverlay();
} catch (e) {
  console.warn(`Steam is not available: ${e instanceof Error ? e.message : e}`);
  client = null;
}

let win = null;
let lobby = null;
const packetsTo = () => win && !win.isDestroyed() ? win.webContents : null;

/** A lobby's members as plain data (Steam ids are 64-bit: send them as strings). */
function lobbyInfo(l) {
  return {
    id: String(l.id),
    owner: String(l.getOwner().steamId64),
    members: l.getMembers().map((m) => ({ id: String(m.steamId64), name: memberName(m) })),
  };
}

function memberName(m) {
  // steamworks.js has no friend-name lookup; the lobby protocol carries names anyway.
  return client && String(m.steamId64) === String(client.localplayer.getSteamId().steamId64) ? client.localplayer.getName() : "";
}

function inLobby(steamId) {
  return !!lobby && lobby.getMembers().some((m) => String(m.steamId64) === String(steamId));
}

function createWindow() {
  const deck = !!client && client.utils.isSteamRunningOnSteamDeck();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    fullscreen: deck || process.argv.includes("--fullscreen"),
    backgroundColor: "#10141e",
    title: "Seedfall",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"), { query: { desktop: "1", ...(deck ? { deck: "1" } : {}) } });
  // Launched from a friend's invite: Steam passes "+connect_lobby <id>".
  const i = process.argv.indexOf("+connect_lobby");
  if (i >= 0 && process.argv[i + 1]) win.webContents.once("did-finish-load", () => packetsTo()?.send("steam:join", process.argv[i + 1]));
}

// ---------------------------------------------------------------- IPC

ipcMain.handle("steam:ready", () => !!client);
ipcMain.handle("steam:user", () => {
  if (!client) return null;
  return {
    id: String(client.localplayer.getSteamId().steamId64),
    name: client.localplayer.getName(),
    deck: client.utils.isSteamRunningOnSteamDeck(),
    appId: client.utils.getAppId(),
  };
});
ipcMain.handle("steam:createLobby", async (_e, max) => {
  if (!client) throw new Error("Steam is not running.");
  lobby?.leave();
  lobby = await client.matchmaking.createLobby(1 /* FriendsOnly */, Math.max(2, Math.min(8, Number(max) || 8)));
  lobby.setData("game", "seedfall");
  return String(lobby.id);
});
ipcMain.handle("steam:joinLobby", async (_e, id) => {
  if (!client) throw new Error("Steam is not running.");
  lobby?.leave();
  lobby = await client.matchmaking.joinLobby(BigInt(id));
  return lobbyInfo(lobby);
});
ipcMain.handle("steam:leaveLobby", () => {
  lobby?.leave();
  lobby = null;
});
ipcMain.handle("steam:lobbyInfo", () => (lobby ? lobbyInfo(lobby) : null));
ipcMain.handle("steam:joinable", (_e, joinable) => {
  lobby?.setJoinable(!!joinable);
});
ipcMain.on("steam:invite", () => {
  if (client && lobby) client.overlay.activateInviteDialog(lobby.id);
});
ipcMain.on("steam:send", (_e, to, data) => {
  if (client) client.networking.sendP2PPacket(BigInt(to), 2 /* Reliable */, Buffer.from(String(data), "utf8"));
});
ipcMain.on("steam:presence", (_e, key, value) => client?.localplayer.setRichPresence(String(key), String(value)));
ipcMain.on("steam:achievement", (_e, id) => {
  if (client && !client.achievement.isActivated(String(id))) client.achievement.activate(String(id));
});
ipcMain.on("steam:overlay", (_e, dialog) => {
  const d = { friends: 0, settings: 3, achievements: 6 }[dialog];
  if (client && d !== undefined) client.overlay.activateDialog(d);
});
ipcMain.handle("steam:cloudEnabled", () => !!client && client.cloud.isEnabledForAccount() && client.cloud.isEnabledForApp());
ipcMain.handle("steam:cloudWrite", (_e, name, text) => !!client && client.cloud.writeFile(String(name), String(text)));
ipcMain.handle("steam:cloudRead", (_e, name) => (client && client.cloud.fileExists(String(name)) ? client.cloud.readFile(String(name)) : null));
ipcMain.handle("steam:cloudList", () => (client ? client.cloud.listFiles().map((f) => f.name) : []));
ipcMain.handle("steam:cloudDelete", (_e, name) => !!client && client.cloud.deleteFile(String(name)));
ipcMain.on("app:quit", () => app.quit());

// ---------------------------------------------------------------- Steam events

if (client) {
  const { SteamCallback } = steamworks;
  // Only lobby members may open a P2P session with us.
  client.callback.register(SteamCallback.P2PSessionRequest, ({ remote }) => {
    if (inLobby(remote)) client.networking.acceptP2PSession(remote);
  });
  client.callback.register(SteamCallback.LobbyChatUpdate, () => packetsTo()?.send("steam:lobby"));
  client.callback.register(SteamCallback.GameLobbyJoinRequested, ({ lobby_steam_id }) => packetsTo()?.send("steam:join", String(lobby_steam_id)));
  // Incoming packets: poll often, forward as text.
  setInterval(() => {
    for (let n = 0; n < 256; n++) {
      const size = client.networking.isP2PPacketAvailable();
      if (!size) break;
      const p = client.networking.readP2PPacket(size);
      packetsTo()?.send("steam:packet", String(p.steamId.steamId64), p.data.toString("utf8"));
    }
  }, 5);
}

// Smoke test (SEEDFALL_SMOKE=1): load the game, check the bridge and the world, print, exit.
function smoke() {
  win.webContents.once("did-finish-load", async () => {
    const js = `new Promise((done) => {
      const t0 = Date.now();
      const poll = () => {
        if (window.__seedfall?.ready) {
          const b = window.seedfallDesktop;
          Promise.resolve(b?.steamReady()).then((steam) => done({ bridge: !!b, platform: b?.platform, steam, tiles: window.__seedfall.game.world.planet.grid.count }));
        } else if (Date.now() - t0 > 90000) done({ error: "game not ready" });
        else setTimeout(poll, 250);
      };
      poll();
    })`;
    try {
      const r = await win.webContents.executeJavaScript(js);
      console.log(`SMOKE ${JSON.stringify(r)}`);
      app.exit(r.bridge && r.tiles > 0 ? 0 : 1);
    } catch (e) {
      console.log(`SMOKE failed: ${e}`);
      app.exit(1);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  if (process.env.SEEDFALL_SMOKE) smoke();
});
app.on("window-all-closed", () => {
  lobby?.leave();
  app.quit();
});
