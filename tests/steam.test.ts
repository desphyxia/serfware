import { describe, expect, it } from "vitest";
import type { DesktopBridge, SteamLobbyInfo } from "../src/platform/bridge";
import { SteamHostLobby, SteamJoinLobby } from "../src/net/steamLobby";
import type { LockstepSession } from "../src/net/lockstep";

/** A stand-in for Steam: users, one lobby at a time each, and reliable in-order P2P packets. */
class FakeSteam {
  private readonly users = new Map<string, { name: string; packet: ((from: string, data: string) => void)[]; lobbyChanged: (() => void)[]; lobby: string }>();
  private readonly lobbies = new Map<string, { owner: string; members: string[]; joinable: boolean }>();
  private next = 1;
  readonly queue: { to: string; from: string; data: string }[] = [];
  cloud = new Map<string, string>();

  bridge(id: string, name: string): DesktopBridge {
    const u = { name, packet: [] as ((from: string, data: string) => void)[], lobbyChanged: [] as (() => void)[], lobby: "" };
    this.users.set(id, u);
    const info = (lobbyId: string): SteamLobbyInfo => {
      const l = this.lobbies.get(lobbyId)!;
      return { id: lobbyId, owner: l.owner, members: l.members.map((m) => ({ id: m, name: this.users.get(m)!.name })) };
    };
    const changed = (lobbyId: string) => {
      for (const m of this.lobbies.get(lobbyId)?.members ?? []) for (const f of this.users.get(m)!.lobbyChanged) f();
    };
    return {
      platform: "linux",
      steamReady: async () => true,
      steamUser: async () => ({ id, name, deck: false, appId: 480 }),
      createLobby: async () => {
        const lobbyId = String(this.next++);
        this.lobbies.set(lobbyId, { owner: id, members: [id], joinable: true });
        u.lobby = lobbyId;
        return lobbyId;
      },
      joinLobby: async (lobbyId) => {
        const l = this.lobbies.get(lobbyId);
        if (!l || !l.joinable) throw new Error("Lobby closed");
        l.members.push(id);
        u.lobby = lobbyId;
        changed(lobbyId);
        return info(lobbyId);
      },
      leaveLobby: async () => {
        const l = this.lobbies.get(u.lobby);
        if (l) l.members = l.members.filter((m) => m !== id);
        changed(u.lobby);
        u.lobby = "";
      },
      lobbyInfo: async () => (u.lobby ? info(u.lobby) : null),
      setLobbyJoinable: async (j) => {
        const l = this.lobbies.get(u.lobby);
        if (l) l.joinable = j;
      },
      inviteFriends: () => {},
      onLobbyChanged: (fn) => u.lobbyChanged.push(fn),
      onJoinRequested: () => {},
      send: (to, data) => this.queue.push({ to, from: id, data }),
      onPacket: (fn) => u.packet.push(fn),
      setPresence: () => {},
      unlockAchievement: () => {},
      openOverlay: () => {},
      cloudEnabled: async () => true,
      cloudWrite: async (n, t) => (this.cloud.set(n, t), true),
      cloudRead: async (n) => this.cloud.get(n) ?? null,
      cloudList: async () => [...this.cloud.keys()],
      cloudDelete: async (n) => this.cloud.delete(n),
      quit: () => {},
    };
  }

  /** Deliver queued packets (a few rounds, as replies queue more). */
  pump(): void {
    for (let round = 0; round < 20 && this.queue.length; round++) {
      for (const p of this.queue.splice(0)) for (const f of this.users.get(p.to)?.packet ?? []) f(p.from, p.data);
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Steam lobbies and transport", () => {
  it("host and two friends meet in a Steam lobby and play in lockstep", async () => {
    const steam = new FakeSteam();
    const host = new SteamHostLobby({ name: "Ada" }, steam.bridge("100", "Ada"));
    await host.open();
    const g1 = new SteamJoinLobby({ name: "Bo" }, steam.bridge("200", "Bo"));
    const g2 = new SteamJoinLobby({ name: "Cy" }, steam.bridge("300", "Cy"));
    await g1.join(host.lobbyId);
    await g2.join(host.lobbyId);
    await tick();
    steam.pump();
    await tick();
    steam.pump();
    expect(host.players.map((p) => p.name)).toEqual(["Ada", "Bo", "Cy"]);
    expect(g1.playerId).toBe(1);
    expect(g2.players.length).toBe(3);

    const started: LockstepSession[] = [];
    g1.onStart = (s) => started.push(s);
    g2.onStart = (s) => started.push(s);
    const a = host.start("steam-seed-1", "neighbours");
    steam.pump();
    expect(started.length).toBe(2);
    // Late joiners are refused once the game has started.
    await expect(new SteamJoinLobby({ name: "Di" }, steam.bridge("400", "Di")).join(host.lobbyId)).rejects.toThrow();
    const [b, c] = started as [LockstepSession, LockstepSession];
    expect(a.world.economy.keeps.length).toBe(3);
    for (let i = 0; i < 120; i++) {
      a.advance(100);
      b.advance(100);
      c.advance(100);
      steam.pump();
    }
    // Bring all three to the same tick (single steps, round-robin) and compare.
    const all = [a, b, c];
    for (let guard = 0; guard < 2000; guard++) {
      const top = Math.max(...all.map((s) => s.world.tick));
      if (all.every((s) => s.world.tick === top)) break;
      for (const s of all) if (s.world.tick < top) s.advance(100, 1);
      steam.pump();
    }
    expect(a.world.tick).toBeGreaterThan(100);
    expect(b.world.checksum()).toBe(a.world.checksum());
    expect(c.world.checksum()).toBe(a.world.checksum());
  });

  it("drops a friend who leaves the Steam lobby before the start", async () => {
    const steam = new FakeSteam();
    const host = new SteamHostLobby({ name: "Ada" }, steam.bridge("1", "Ada"));
    await host.open();
    const g = new SteamJoinLobby({ name: "Bo" }, steam.bridge("2", "Bo"));
    await g.join(host.lobbyId);
    await tick();
    steam.pump();
    expect(host.players.length).toBe(2);
    g.close();
    await tick();
    await tick();
    expect(host.players.length).toBe(1);
  });
});
