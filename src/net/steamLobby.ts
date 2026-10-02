import type { DesktopBridge, SteamLobbyInfo } from "../platform/bridge";
import type { LockstepSession } from "./lockstep";
import { HostLobby, JoinLobby, type LobbyOptions } from "./lobby";
import type { Creative, SessionMode } from "./session";
import { SteamTransport } from "./steamTransport";

/** Most players a Steam lobby admits (the game's player limit). */
export const STEAM_LOBBY_SIZE = 8;

/**
 * Hosting through Steam: a friends-only Steam lobby replaces the signalling server and invite
 * codes. Friends join from the overlay's invite or the friends list; each new member greets the
 * host over Steam P2P and the usual lobby protocol takes over.
 */
export class SteamHostLobby extends HostLobby {
  lobbyId = "";
  private selfId = "";

  constructor(
    opts: LobbyOptions,
    private readonly bridge: DesktopBridge,
  ) {
    super(opts, new SteamTransport(bridge));
    bridge.onLobbyChanged(() => void this.refresh());
  }

  private get steam(): SteamTransport {
    return this.transport as SteamTransport;
  }

  override async open(): Promise<void> {
    this.changed("Opening a Steam lobby…");
    const user = await this.bridge.steamUser();
    this.selfId = user?.id ?? "";
    this.lobbyId = await this.bridge.createLobby(STEAM_LOBBY_SIZE);
    this.changed("Steam lobby open. Invite friends from the Steam overlay (Shift+Tab).");
  }

  /** Open the overlay's invite dialog. */
  invite(): void {
    this.bridge.inviteFriends();
  }

  /** Follow the lobby's members: new ones become peers, those who left leave the game lobby. */
  async refresh(info?: SteamLobbyInfo | null): Promise<void> {
    const lobby = info ?? (await this.bridge.lobbyInfo());
    if (!lobby) return;
    const others = lobby.members.map((m) => m.id).filter((id) => id !== this.selfId);
    for (const gone of this.steam.peers.filter((p) => !others.includes(p))) this.guestLeft(gone);
    this.steam.setPeers(others);
    this.changed();
  }

  override start(seed: string, mode: Exclude<SessionMode, "solo">, scenario?: string, creative?: Creative): LockstepSession {
    void this.bridge.setLobbyJoinable(false);
    return super.start(seed, mode, scenario, creative);
  }

  override close(): void {
    void this.bridge.leaveLobby();
    super.close();
  }
}

/** Joining a friend's Steam lobby (from an invite, or by lobby id). */
export class SteamJoinLobby extends JoinLobby {
  constructor(
    opts: LobbyOptions,
    private readonly bridge: DesktopBridge,
  ) {
    super(opts, new SteamTransport(bridge));
  }

  override async join(lobbyId = this.opts.room ?? ""): Promise<void> {
    if (!lobbyId) throw new Error("No Steam lobby to join.");
    this.changed("Joining the Steam lobby…");
    const lobby = await this.bridge.joinLobby(lobbyId);
    (this.transport as SteamTransport).setPeers([lobby.owner]);
    this.hello(lobby.owner);
    this.changed("Connected. Waiting for the host to start…");
  }

  override close(): void {
    void this.bridge.leaveLobby();
    super.close();
  }
}
