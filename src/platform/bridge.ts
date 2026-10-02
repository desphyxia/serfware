/**
 * What the desktop build (Electron, desktop/preload.cjs) exposes to the game as
 * `window.seedfallDesktop`. The web build has no bridge; everything here is optional and the game
 * must work without it. Steam ids cross the bridge as decimal strings (they are 64-bit).
 */
export interface SteamUser {
  id: string;
  name: string;
}

export interface SteamLobbyInfo {
  id: string;
  owner: string;
  members: SteamUser[];
}

export interface DesktopBridge {
  /** "win32", "linux" or "darwin". */
  readonly platform: string;
  /** Steam started and the Steamworks API is usable. */
  steamReady(): Promise<boolean>;
  /** The signed-in Steam user and whether we run on a Steam Deck; null without Steam. */
  steamUser(): Promise<(SteamUser & { deck: boolean; appId: number }) | null>;

  /** Create a friends-only lobby; resolves to its id. */
  createLobby(maxMembers: number): Promise<string>;
  joinLobby(id: string): Promise<SteamLobbyInfo>;
  leaveLobby(): Promise<void>;
  lobbyInfo(): Promise<SteamLobbyInfo | null>;
  /** Mark the lobby open or closed to new members (closed once a game starts). */
  setLobbyJoinable(joinable: boolean): Promise<void>;
  /** The overlay's invite dialog for the current lobby. */
  inviteFriends(): void;
  /** Lobby membership changed (someone joined or left). */
  onLobbyChanged(fn: () => void): void;
  /** The player accepted a friend's invite from the Steam overlay or friends list. */
  onJoinRequested(fn: (lobbyId: string) => void): void;

  /** Reliable peer-to-peer message to another Steam user (JSON text, at most 1 MB). */
  send(steamId: string, data: string): void;
  onPacket(fn: (from: string, data: string) => void): void;

  /** Rich presence ("steam_display" and the tokens it uses, or plain "status"). */
  setPresence(key: string, value: string): void;
  unlockAchievement(id: string): void;
  openOverlay(dialog: "friends" | "achievements" | "settings"): void;

  /** Steam Cloud: small text files that follow the player between machines. */
  cloudEnabled(): Promise<boolean>;
  cloudWrite(name: string, text: string): Promise<boolean>;
  cloudRead(name: string): Promise<string | null>;
  cloudList(): Promise<string[]>;
  cloudDelete(name: string): Promise<boolean>;

  /**
   * Steam Workshop (optional: older desktop builds lack it). Upload a creation (scenario, world or
   * mod) as one JSON file; resolves to the item id, or "" if Steam refused. `workshopItems` reads
   * the creations the player is subscribed to (the files Steam downloaded).
   */
  workshopUpload?(item: { title: string; description: string; tags: string[]; json: string; itemId?: string }): Promise<{ itemId: string; needsAgreement: boolean }>;
  workshopItems?(): Promise<{ itemId: string; json: string }[]>;
  openWorkshop?(): void;

  quit(): void;
}

declare global {
  interface Window {
    seedfallDesktop?: DesktopBridge;
  }
}

/** The desktop bridge when running in the Electron build, else null. */
export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" ? (window.seedfallDesktop ?? null) : null;
}
