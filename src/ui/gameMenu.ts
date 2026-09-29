import { HostLobby, JoinLobby, randomRoom } from "../net/lobby";
import type { SaveFile } from "../net/session";
import { webrtcAvailable } from "../net/webrtc";
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
  startSession(lobby: HostLobby, mode: "shared" | "neighbours"): void;
  joined(lobby: JoinLobby): void;
  notify(text: string, kind?: "info" | "warn" | "good"): void;
}

const defaultServer = () => `ws://${location.hostname || "localhost"}:8787`;

/** Game menu (M): saves, export/import, and multiplayer lobbies. */
export class GameMenu extends Panel {
  private readonly saveList: HTMLElement;
  private readonly mpBody: HTMLElement;
  private lobby: HostLobby | JoinLobby | null = null;

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
    const mode = h("select", { id: "mp-mode" }, h("option", { value: "shared" }, "Co-op: shared keep"), h("option", { value: "neighbours" }, "Co-op: neighbours")) as HTMLSelectElement;
    const opts = () => ({ name: name.value.trim(), server: server.value.trim(), room: room.value.trim() });
    this.mpBody.replaceChildren(
      h("p", { class: "hint" }, note),
      h("div", { class: "row" }, h("label", { for: "mp-name" }, "Your name"), name, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-server" }, "Server"), server, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-room" }, "Room"), room, h("span")),
      h("div", { class: "row" }, h("label", { for: "mp-mode" }, "Mode"), mode, h("span")),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => void this.openHost(opts(), mode.value as "shared" | "neighbours") }, "Host a game"),
        h("button", { class: "btn", onclick: () => void this.openJoin(opts()) }, "Join"),
      ),
    );
  }

  /** Programmatic entry used by the UI and by the multiplayer test. */
  async openHost(o: { name: string; server: string; room: string; ice?: RTCIceServer[] }, mode: "shared" | "neighbours"): Promise<HostLobby> {
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
      players.replaceChildren(...lobby.players.map((p) => h("li", {}, `${p.id + 1}. ${p.name}`)));
    };
    lobby.subscribe(render);
    this.mpBody.replaceChildren(
      h("h3", { class: "sub" }, `Hosting · ${mode === "shared" ? "shared keep" : "neighbours"}`),
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

  async openJoin(o: { name: string; server: string; room: string; ice?: RTCIceServer[] }): Promise<JoinLobby> {
    this.lobby?.close();
    const lobby = new JoinLobby(o);
    this.lobby = lobby;
    const status = h("p", { class: "status" });
    const players = h("ul", { class: "player-list" });
    const inviteArea = h("textarea", { class: "report-text", rows: 3, placeholder: "Paste the host's invite code", "aria-label": "Invite code" }) as HTMLTextAreaElement;
    const render = () => {
      status.textContent = lobby.status;
      players.replaceChildren(...lobby.players.map((p) => h("li", {}, `${p.id + 1}. ${p.name}`)));
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
