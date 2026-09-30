import { log } from "../core/log";
import { World } from "../sim/world";
import { LockstepSession } from "./lockstep";
import type { SessionMode } from "./session";
import type { NetMessage, Transport } from "./transport";
import { RtcPeer, RtcTransport, SignalClient, DEFAULT_ICE } from "./webrtc";

export interface LobbyPlayer {
  id: number;
  name: string;
}

export interface LobbyOptions {
  name: string;
  /** Signalling server URL, or empty for manual invite codes. */
  server?: string;
  room?: string;
  ice?: RTCIceServer[];
}

type Listener = () => void;

/** Shared lobby state and callbacks. The transport is WebRTC unless a subclass brings another. */
abstract class Lobby {
  players: LobbyPlayer[] = [];
  status = "";
  protected signal: SignalClient | null = null;
  protected listeners = new Set<Listener>();
  onStart: ((session: LockstepSession) => void) | null = null;

  constructor(
    readonly opts: LobbyOptions,
    readonly transport: Transport = new RtcTransport(),
  ) {}

  /** The WebRTC transport (only the WebRTC lobbies use its peer management). */
  protected get rtc(): RtcTransport {
    return this.transport as RtcTransport;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected changed(status?: string): void {
    if (status !== undefined) this.status = status;
    for (const l of this.listeners) l();
  }

  close(): void {
    this.signal?.close();
    this.transport.close();
  }
}

export function randomRoom(): string {
  const words = ["amber", "brook", "cedar", "dawn", "ember", "fern", "glade", "heron", "iris", "juniper", "kestrel", "linden"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

/** The host accepts guests, assigns player ids, and starts the game for everyone. */
export class HostLobby extends Lobby {
  private nextId = 1;
  private readonly pendingManual = new Map<string, RtcPeer>();
  private readonly peerPlayer = new Map<string, number>();

  constructor(opts: LobbyOptions, transport?: Transport) {
    super(opts, transport);
    this.players = [{ id: 0, name: opts.name || "Host" }];
    this.transport.onMessage((msg, from) => this.onPeerMessage(msg, from));
  }

  async open(): Promise<void> {
    if (!this.opts.server) {
      this.changed("Manual mode: create an invite code for each guest.");
      return;
    }
    this.changed(`Connecting to ${this.opts.server}…`);
    this.signal = await SignalClient.connect(this.opts.server);
    this.signal.onMessage = (m) => void this.onSignal(m);
    this.signal.send({ type: "host", room: this.opts.room ?? "" });
    this.changed(`Lobby open. Room code: ${this.opts.room}`);
  }

  private newPeer(id: string): RtcPeer {
    const peer = new RtcPeer(id, this.opts.ice ?? DEFAULT_ICE);
    peer.onOpen = () => {
      this.rtc.add(peer);
      this.changed("A guest connected.");
    };
    peer.onClose = () => {
      this.rtc.remove(id);
      this.guestLeft(id);
    };
    return peer;
  }

  private async onSignal(m: NetMessage): Promise<void> {
    if (m.type === "joined") {
      const client = String(m.client);
      const peer = this.newPeer(client);
      const offer = await peer.createOffer();
      this.pendingManual.set(client, peer);
      this.signal?.send({ type: "signal", to: client, data: offer });
    } else if (m.type === "signal") {
      const peer = this.pendingManual.get(String(m.from));
      if (peer) await peer.acceptAnswer(String(m.data));
    } else if (m.type === "error") this.changed(String(m.message));
  }

  /** Manual mode: an invite code to send to one guest. */
  async createInvite(): Promise<{ id: string; code: string }> {
    const id = `m${this.pendingManual.size + 1}`;
    const peer = this.newPeer(id);
    const code = await peer.createOffer();
    this.pendingManual.set(id, peer);
    return { id, code };
  }

  async acceptReply(id: string, code: string): Promise<void> {
    const peer = this.pendingManual.get(id);
    if (!peer) throw new Error("Unknown invite.");
    await peer.acceptAnswer(code);
  }

  /** A guest's connection closed: drop them from the lobby. */
  protected guestLeft(peer: string): void {
    const pid = this.peerPlayer.get(peer);
    if (pid === undefined) return;
    this.peerPlayer.delete(peer);
    this.players = this.players.filter((p) => p.id !== pid);
    this.broadcastLobby();
    this.changed("A guest left.");
  }

  private onPeerMessage(msg: NetMessage, from: string): void {
    if (msg.type === "hello" && !this.peerPlayer.has(from)) {
      const id = this.nextId++;
      this.peerPlayer.set(from, id);
      this.players.push({ id, name: String(msg.name || `Guest ${id}`).slice(0, 24) });
      this.transport.send(from, { type: "welcome", playerId: id });
      this.broadcastLobby();
      this.changed(`${String(msg.name)} joined.`);
    }
  }

  protected broadcastLobby(): void {
    this.transport.broadcast({ type: "lobby", players: this.players });
  }

  /** Start the game on every machine. */
  start(seed: string, mode: Exclude<SessionMode, "solo">): LockstepSession {
    const players = this.players.map((p) => ({ ...p }));
    this.transport.broadcast({ type: "start", seed, mode, players });
    this.signal?.close();
    const world = new World(seed, { players: mode === "neighbours" ? players.length : 1 });
    const session = new LockstepSession(world, { mode, seed, players }, 0, this.transport);
    log.info(`Hosting ${mode} game "${seed}" with ${players.length} players`);
    return session;
  }
}

/** A guest connects to a host, receives a player id, and waits for the start. */
export class JoinLobby extends Lobby {
  playerId = -1;
  private peer: RtcPeer | null = null;

  constructor(opts: LobbyOptions, transport?: Transport) {
    super(opts, transport);
    this.transport.onMessage((msg) => this.onPeerMessage(msg));
  }

  private makePeer(): RtcPeer {
    const peer = new RtcPeer("host", this.opts.ice ?? DEFAULT_ICE);
    peer.onOpen = () => {
      this.rtc.add(peer);
      peer.send({ type: "hello", name: this.opts.name || "Guest" });
      this.changed("Connected. Waiting for the host to start…");
    };
    peer.onClose = () => this.changed("Disconnected from the host.");
    this.peer = peer;
    return peer;
  }

  async join(): Promise<void> {
    if (!this.opts.server) throw new Error("Use a manual invite code, or enter a server.");
    this.changed(`Connecting to ${this.opts.server}…`);
    this.signal = await SignalClient.connect(this.opts.server);
    this.signal.onMessage = async (m) => {
      if (m.type === "signal") {
        const peer = this.makePeer();
        const answer = await peer.acceptOffer(String(m.data));
        this.signal?.send({ type: "signal", to: "host", data: answer });
      } else if (m.type === "error") this.changed(String(m.message));
    };
    this.signal.send({ type: "join", room: this.opts.room ?? "", name: this.opts.name });
    this.changed("Asking the host to connect…");
  }

  /** Manual mode: paste the host's invite, get a reply code to send back. */
  async replyToInvite(code: string): Promise<string> {
    const peer = this.makePeer();
    return peer.acceptOffer(code);
  }

  /** The host is reachable: introduce ourselves. */
  protected hello(host: string): void {
    this.transport.send(host, { type: "hello", name: this.opts.name || "Guest" });
  }

  private onPeerMessage(msg: NetMessage): void {
    if (msg.type === "welcome") {
      this.playerId = msg.playerId as number;
      this.changed(`You are player ${this.playerId + 1}.`);
    } else if (msg.type === "lobby") {
      this.players = msg.players as LobbyPlayer[];
      this.changed();
    } else if (msg.type === "start") {
      const players = msg.players as LobbyPlayer[];
      const mode = msg.mode as Exclude<SessionMode, "solo">;
      const seed = String(msg.seed);
      this.signal?.close();
      const world = new World(seed, { players: mode === "neighbours" ? players.length : 1 });
      const session = new LockstepSession(world, { mode, seed, players }, this.playerId, this.transport);
      log.info(`Joined ${mode} game "${seed}" as player ${this.playerId}`);
      this.onStart?.(session);
    }
  }
}
