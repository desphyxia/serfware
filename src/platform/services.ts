import type { World } from "../sim/world";
import { ACHIEVEMENTS, newlyEarned } from "./achievements";
import { desktop, type DesktopBridge } from "./bridge";
import { CloudSaves } from "./cloudSaves";

export interface PlatformHost {
  world(): World;
  player(): number;
  /** Shown in the web build (and alongside Steam's own popup on the desktop). */
  toast(text: string): void;
  /** A friend's Steam invite was accepted. */
  joinSteamLobby(lobbyId: string): void;
}

const EARNED_KEY = "seedfall.achievements";

/**
 * Platform features around the game: achievements (Steam or local), Steam rich presence, Steam
 * Cloud save mirroring and Steam invites. All no-ops that cost nothing on the web.
 */
export class PlatformServices {
  readonly bridge: DesktopBridge | null = desktop();
  readonly cloud: CloudSaves | null;
  private readonly earned: Set<string>;
  private achieveTimer = 2;
  private presenceTimer = 0;

  constructor(private readonly host: PlatformHost) {
    this.earned = new Set(this.read());
    this.cloud = this.bridge && typeof localStorage !== "undefined" ? new CloudSaves(this.bridge, localStorage) : null;
    this.bridge?.onJoinRequested((id) => host.joinSteamLobby(id));
  }

  private read(): string[] {
    try {
      return JSON.parse(localStorage.getItem(EARNED_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  }

  /** Achievements earned so far on this machine. */
  get achievements(): { id: string; name: string; description: string; earned: boolean }[] {
    return ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, description: a.description, earned: this.earned.has(a.id) }));
  }

  /** Called every frame with the real time step. */
  update(dt: number): void {
    this.achieveTimer -= dt;
    if (this.achieveTimer <= 0) {
      this.achieveTimer = 5;
      this.checkAchievements();
    }
    this.presenceTimer -= dt;
    if (this.presenceTimer <= 0 && this.bridge) {
      this.presenceTimer = 20;
      this.updatePresence();
    }
  }

  private checkAchievements(): void {
    const w = this.host.world();
    for (const a of newlyEarned(w, this.host.player(), this.earned)) {
      this.earned.add(a.id);
      this.bridge?.unlockAchievement(a.id);
      this.host.toast(`Achievement: ${a.name}. ${a.description}`);
    }
    try {
      localStorage.setItem(EARNED_KEY, JSON.stringify([...this.earned]));
    } catch {
      // Storage unavailable: they will be earned again next time.
    }
  }

  /** Friends list: "Day 12 on russet-heron-417 · 34 settlers" (see desktop/steam/rich_presence_english.vdf). */
  private updatePresence(): void {
    const b = this.bridge;
    if (!b) return;
    const w = this.host.world();
    const day = w.day().day;
    const people = w.economy.peopleOf(this.host.player()).length;
    b.setPresence("seed", w.seed);
    b.setPresence("day", String(day));
    b.setPresence("people", String(people));
    b.setPresence("steam_display", "#Status");
    b.setPresence("status", `Day ${day} on ${w.seed} · ${people} settlers`);
  }
}
