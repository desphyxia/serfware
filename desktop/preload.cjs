// The bridge the game sees as window.seedfallDesktop (see src/platform/bridge.ts).
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args));

contextBridge.exposeInMainWorld("seedfallDesktop", {
  platform: process.platform,
  steamReady: () => ipcRenderer.invoke("steam:ready"),
  steamUser: () => ipcRenderer.invoke("steam:user"),
  createLobby: (max) => ipcRenderer.invoke("steam:createLobby", max),
  joinLobby: (id) => ipcRenderer.invoke("steam:joinLobby", id),
  leaveLobby: () => ipcRenderer.invoke("steam:leaveLobby"),
  lobbyInfo: () => ipcRenderer.invoke("steam:lobbyInfo"),
  setLobbyJoinable: (joinable) => ipcRenderer.invoke("steam:joinable", joinable),
  inviteFriends: () => ipcRenderer.send("steam:invite"),
  onLobbyChanged: on("steam:lobby"),
  onJoinRequested: on("steam:join"),
  send: (to, data) => ipcRenderer.send("steam:send", to, data),
  onPacket: on("steam:packet"),
  setPresence: (key, value) => ipcRenderer.send("steam:presence", key, value),
  unlockAchievement: (id) => ipcRenderer.send("steam:achievement", id),
  openOverlay: (dialog) => ipcRenderer.send("steam:overlay", dialog),
  cloudEnabled: () => ipcRenderer.invoke("steam:cloudEnabled"),
  cloudWrite: (name, text) => ipcRenderer.invoke("steam:cloudWrite", name, text),
  cloudRead: (name) => ipcRenderer.invoke("steam:cloudRead", name),
  cloudList: () => ipcRenderer.invoke("steam:cloudList"),
  cloudDelete: (name) => ipcRenderer.invoke("steam:cloudDelete", name),
  quit: () => ipcRenderer.send("app:quit"),
});
