import { HostLobby, JoinLobby, randomRoom } from "../net/lobby";
import { MODE_NAMES, type PlayMode, type SaveFile, type SessionPlayer } from "../net/session";
import { webrtcAvailable } from "../net/webrtc";
import { SteamHostLobby, SteamJoinLobby } from "../net/steamLobby";
import { desktop } from "../platform/bridge";
import { copyText, h, Panel } from "./dom";

export interface SaveMeta {
  id: string;
  name: string;
  createdAt: string;
  seed: string;
  tick: number;
  mode: string;
}

export interface MenuHost {
  saveNow(name: string): SaveMeta | null;
  listSaves(): SaveMeta[];
  load(id: string): void;
  remove(id: string): void;
  exportCurrent(): string;
  importText(text: string): void;
  seed(): string;
  startSession(lobby: HostLobby, mode: PlayMode): void;
  joined(lobby: JoinLobby): void;
  notify(text: string, kind?: "info" | "warn" | "good"): void;
}

const defaultServer = () => `ws://${location.hostname || "localhost"}:8787`;

/** Game menu (M): saves, export/import, and multiplayer lobbies. */
export class GameMenu extends Panel {
  private readonly saveList: HTMLElement;
  private readonly mpBody: HTMLElement;
  private lobby: HostLobby | JoinLobby | null = null;
  /** Switch to a tab by name (Multiplayer, Saves, …). */
  selectTab: (name: string) => void = () => {};
  /** Steam is running (desktop build): multiplayer goes through Steam lobbies. */
  private steamName = "";

  constructor(private readonly host: MenuHost) {
    super("menu", "Game", { width: 400 });
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const pages = h("div", { class: "tab-pages" });
    const addTab = (name: string, page: HTMLElement) => {
      tabs.append(h("button", { class: "tab", role: "tab", onclick: () => select(name) }, name));
      page.dataset.tab = name;
      pages.append(page);
    };
    const select = (name: string) => {
      for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.textContent === name);
      for (const p of pages.children) (p as HTMLElement).hidden = (p as HTMLElement).dataset.tab !== name;
    };

    // Saves
    const saves = h("div", { class: "form" });
    const nameInput = h("input", { type: "text", id: "save-name", placeholder: "Save name" }) as HTMLInputElement;
    this.saveList = h("div", { class: "save-list" });
    const area = h("textarea", { class: "report-text", rows: 5, hidden: true, "aria-label": "Save data" }) as HTMLTextAreaElement;
    saves.append(
      h("div", { class: "row" }, h("label", { for: "save-name" }, "Name"), nameInput, h("span")),
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              const meta = this.host.saveNow(nameInput.value.trim() || `${this.host.seed()}`);
              if (meta) this.host.notify(`Saved "${meta.name}".`, "good");
              this.refreshSaves();
            },
          },
          "Save game",
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const text = this.host.exportCurrent();
              const ok = await copyText(text, area);
              this.host.notify(ok ? "Save copied to the clipboard." : "Select the text and copy it.", ok ? "good" : "info");
            },
          },
          "Copy save",
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              area.hidden = false;
              area.readOnly = false;
              area.value = "";
              area.placeholder = "Paste save text here, then press Load pasted.";
              area.focus();
            },
          },
          "Paste save",
        ),
        h("button", { class: "btn", onclick: () => area.value.trim() && this.host.importText(area.value) }, "Load pasted"),
      ),
      area,
      h("h3", { class: "sub" }, "Saved games (this browser)"),
      this.saveList,
      h("p", { class: "hint" }, "Saves store the seed and every command, and replay them on load. An autosave is kept every two minutes."),
    );
    addTab("Saves", saves);

    // Multiplayer
    this.mpBody = h("div", { class: "form" });
    addTab("Multiplayer", this.mpBody);
    this.renderMpStart();

    this.body.append(tabs, pages);
    select("Saves");
    this.selectTab = select;
    const bridge = desktop();
    if (bridge)
      void bridge.steamUser().then((u) => {
        if (!u) return;
        this.steamName = u.name;
        this.renderMpStart();
      });
  }

  protected override onShow(): void {
    this.refreshSaves();
  }

  private refreshSaves(): void {
    const list = this.host.listSaves();
    if (!list.length) {
      this.saveList.replaceChildren(h("p", { class: "hint" }, "No saves yet."));
      return;
    }
    this.saveList.replaceChildren(
      ...list.map((s) =>
        h(
          "div",
          { class: "save-row" },
          h("div", {}, h("strong", {}, s.name), h("div", { class: "hint" }, `${s.seed} · tick ${s.tick} · ${new Date(s.createdAt).toLocaleString()}`)),
          h("button", { class: "btn small", onclick: () => this.host.load(s.id) }, "Load"),
          h(
            "button",
            {
              class: "btn small danger",
              onclick: () => {
                this.host.remove(s.id);
                this.refreshSaves();
              },
            },
            "Delete",
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- multiplayer

  private renderMpStart(): void {
    const note = webrtcAvailable()
      ? "Play over WebRTC. Use a signalling server (npm run signal) or trade invite codes by hand."
      : "WebRTC isn't available here. Run the game from npm run dev or the desktop build to play together.";
    const name = h("input", { type: "text", id: "mp-name", value: "Player" }) as HTMLInputElement;
    const server = h("input", { type: "text", id: "mp-server", value: defaultServer(), placeholder: "Leave empty for invite codes" }) as HTMLInputElement;
    const room = h("input", { type: "text", id: "mp-room", value: randomRoom() }) as HTMLInputElement;
    const mode = h("select", { id: "mp-mode" }, ...(Object.keys(MODE_NAMES) as PlayMode[]).map((m) => h("option", { value: m }, MODE_NAMES[m]))) as HTMLSelectElement;
    const watch = h("input", { type: "checkbox", id: "mp-watch" }) as HTMLInputElement;
    const opts = () => ({ name: name.value.trim(), server: server.value.trim(), room: room.value.trim(), spectate: watch.checked });
    const steam = this.steamName
      ? [
          h("h3", { class: "sub" }, "Steam"),
          h("p", { class: "hint" }, `Signed in as ${this.steamName}. Host a friends-only lobby and invite friends from the Steam overlay; they can also join from your profile.`),
          h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => void this.openSteamHost(mode.value as PlayMode) }, "Host on Steam")),
          h("h3", { class: "sub" }, "Direct (WebRTC)"),
        ]
      : [];
    if (this.steamName) name.value = this.steamName;
    this.mpBody.replaceChildren(
      ...steam,
      h("p", { class: "hint" }, note),
      h("div", { class: "row" }, h("label", { for: "mp-name" }, "Your name"), name, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-server" }, "Server"), server, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-room" }, "Room"), room, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-mode" }, "Mode"), mode, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-watch" }, "Join to watch"), watch, h("span")),
      h("p", { class: "hint" }, "A player who drops out is kept by a steward (the AI) until they join again with the same name. Anyone joining a game in progress watches."),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => void this.openHost(opts(), mode.value as PlayMode) }, "Host a game"),
        h("button", { class: "btn", onclick: () => void this.openJoin(opts()) }, "Join"),
      ),
    );
  }

  /** Host a friends-only Steam lobby (desktop build). */
  async openSteamHost(mode: PlayMode): Promise<SteamHostLobby | null> {
    const bridge = desktop();
    if (!bridge) return null;
    this.lobby?.close();
    const lobby = new SteamHostLobby({ name: this.steamName || "Host" }, bridge);
    this.lobby = lobby;
    const status = h("p", { class: "status" });
    const players = h("ul", { class: "player-list" });
    const render = () => {
      status.textContent = lobby.status;
      players.replaceChildren(...lobby.players.map((p) => playerRow(p)));
    };
    lobby.subscribe(render);
    this.mpBody.replaceChildren(
      h("h3", { class: "sub" }, `Steam lobby · ${MODE_NAMES[mode]}`),
      status,
      players,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", onclick: () => lobby.invite() }, "Invite friends"),
        h("button", { class: "btn primary", onclick: () => this.host.startSession(lobby, mode) }, "Start game"),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              lobby.close();
              this.lobby = null;
              this.renderMpStart();
            },
          },
          "Close lobby",
        ),
      ),
    );
    render();
    try {
      await lobby.open();
    } catch (e) {
      this.host.notify((e as Error).message, "warn");
    }
    render();
    return lobby;
  }

  /** Join a friend's Steam lobby (from an overlay invite or the friends list). */
  async openSteamJoin(lobbyId: string): Promise<SteamJoinLobby | null> {
    const bridge = desktop();
    if (!bridge) return null;
    this.lobby?.close();
    this.selectTab("Multiplayer");
    const lobby = new SteamJoinLobby({ name: this.steamName || "Guest", room: lobbyId }, bridge);
    this.lobby = lobby;
    const status = h("p", { class: "status" });
    const players = h("ul", { class: "player-list" });
    const render = () => {
      status.textContent = lobby.status;
      players.replaceChildren(...lobby.players.map((p) => playerRow(p)));
    };
    lobby.subscribe(render);
    this.host.joined(lobby);
    this.mpBody.replaceChildren(
      h("h3", { class: "sub" }, "Joining a Steam lobby"),
      status,
      players,
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              lobby.close();
              this.lobby = null;
              this.renderMpStart();
            },
          },
          "Leave",
        ),
      ),
    );
    render();
    try {
      await lobby.join(lobbyId);
    } catch (e) {
      this.host.notify((e as Error).message, "warn");
    }
    render();
    return lobby;
  }

  /** Programmatic entry used by the UI and by the multiplayer test. */
  async openHost(o: { name: string; server: string; room: string; ice?: RTCIceServer[] }, mode: PlayMode): Promise<HostLobby> {
    this.lobby?.close();
    const lobby = new HostLobby(o);
    this.lobby = lobby;
    const status = h("p", { class: "status" });
    const players = h("ul", { class: "player-list" });
    const inviteArea = h("textarea", { class: "report-text", rows: 3, readonly: true, hidden: true, "aria-label": "Invite code" }) as HTMLTextAreaElement;
    const replyArea = h("textarea", { class: "report-text", rows: 3, hidden: true, placeholder: "Paste the guest's reply code", "aria-label": "Reply code" }) as HTMLTextAreaElement;
    let inviteId = "";
    const render = () => {
      status.textContent = lobby.status;
      players.replaceChildren(...lobby.players.map((p) => playerRow(p, mode, (t) => lobby.setTeam(p.id, t))));
    };
    lobby.subscribe(render);
    this.mpBody.replaceChildren(
      h("h3", { class: "sub" }, `Hosting · ${MODE_NAMES[mode]}`),
      status,
      players,
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const inv = await lobby.createInvite();
              inviteId = inv.id;
              inviteArea.hidden = false;
              inviteArea.value = inv.code;
              replyArea.hidden = false;
              void copyText(inv.code, inviteArea);
              this.host.notify("Invite code copied. Send it to a guest.", "good");
            },
          },
          "Create invite code",
        ),
        h("button", { class: "btn", onclick: () => void lobby.acceptReply(inviteId, replyArea.value).catch((e: Error) => this.host.notify(e.message, "warn")) }, "Accept reply"),
      ),
      inviteArea,
      replyArea,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => this.host.startSession(lobby, mode) }, "Start game"),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              lobby.close();
              this.lobby = null;
              this.renderMpStart();
            },
          },
          "Close lobby",
        ),
      ),
    );
    render();
    try {
      await lobby.open();
    } catch (e) {
      this.host.notify((e as Error).message, "warn");
    }
    render();
    return lobby;
  }

  async openJoin(o: { name: string; server: string; room: string; ice?: RTCIceServer[]; spectate?: boolean }): Promise<JoinLobby> {
    this.lobby?.close();
    const lobby = new JoinLobby(o);
    this.lobby = lobby;
    const status = h("p", { class: "status" });
    const players = h("ul", { class: "player-list" });
    const inviteArea = h("textarea", { class: "report-text", rows: 3, placeholder: "Paste the host's invite code", "aria-label": "Invite code" }) as HTMLTextAreaElement;
    const render = () => {
      status.textContent = lobby.status;
      players.replaceChildren(...lobby.players.map((p) => playerRow(p)));
    };
    lobby.subscribe(render);
    this.host.joined(lobby);
    this.mpBody.replaceChildren(
      h("h3", { class: "sub" }, "Joining"),
      status,
      players,
      inviteArea,
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const reply = await lobby.replyToInvite(inviteArea.value);
              inviteArea.value = reply;
              void copyText(reply, inviteArea);
              this.host.notify("Reply code copied. Send it back to the host.", "good");
            },
          },
          "Make reply code",
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              lobby.close();
              this.lobby = null;
              this.renderMpStart();
            },
          },
          "Leave",
        ),
      ),
    );
    render();
    if (o.server) {
      try {
        await lobby.join();
      } catch (e) {
        this.host.notify((e as Error).message, "warn");
      }
    }
    render();
    return lobby;
  }
}

export function saveMeta(id: string, s: SaveFile): SaveMeta {
  return { id, name: s.name, createdAt: s.createdAt, seed: s.seed, tick: s.tick, mode: s.mode };
}

/** A lobby row: number, name, and the team (the host can move players between teams) or "watching". */
function playerRow(p: SessionPlayer, mode?: PlayMode, setTeam?: (team: number) => void): HTMLElement {
  const label = p.spectator ? `${p.name} · watching` : `${p.id + 1}. ${p.name}${p.team !== undefined && (mode === undefined || mode === "teams") ? ` · ${p.team === 0 ? "Team Dawn" : "Team Dusk"}` : ""}`;
  if (!setTeam || mode !== "teams" || p.spectator) return h("li", {}, label);
  return h("li", {}, label, " ", h("button", { class: "btn small", onclick: () => setTeam(p.team === 0 ? 1 : 0) }, "Switch team"));
}
