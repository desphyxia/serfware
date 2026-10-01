import type { DesktopBridge } from "../platform/bridge";
import type { MessageHandler, NetMessage, Transport } from "./transport";

/**
 * Steam peer-to-peer networking as a `Transport`: messages go as JSON over Steam's reliable
 * P2P channel (relayed by Steam, so no ports or NAT to worry about). Peers are Steam ids; the
 * lobby decides who they are. Like the WebRTC transport the topology is a star: guests talk to
 * the host, and the lockstep layer relays.
 */
export class SteamTransport implements Transport {
  private list: string[] = [];
  private handlers: MessageHandler[] = [];
  private closed = false;
  /**
   * Packets from Steam users who aren't peers yet: a new lobby member's greeting can arrive
   * before the lobby update that makes them a peer. Replayed when they join, dropped otherwise.
   */
  private readonly early: { from: string; data: string }[] = [];

  constructor(private readonly bridge: DesktopBridge) {
    bridge.onPacket((from, data) => {
      if (this.closed) return;
      if (!this.list.includes(from)) {
        if (this.early.length < 64) this.early.push({ from, data });
        return;
      }
      this.deliver(from, data);
    });
  }

  private deliver(from: string, data: string): void {
    let msg: NetMessage;
    try {
      msg = JSON.parse(data) as NetMessage;
    } catch {
      return;
    }
    for (const h of this.handlers) h(msg, from);
  }

  get peers(): readonly string[] {
    return this.list;
  }

  /** Set who we talk to (the lobby's other members for a host, the owner for a guest). */
  private leftHandlers: ((peer: string) => void)[] = [];

  onPeerLeft(fn: (peer: string) => void): void {
    this.leftHandlers.push(fn);
  }

  setPeers(ids: readonly string[]): void {
    const gone = this.list.filter((p) => !ids.includes(p));
    this.list = [...ids];
    for (const p of gone) for (const h of this.leftHandlers) h(p);
    for (let i = 0; i < this.early.length; ) {
      const e = this.early[i]!;
      if (this.list.includes(e.from)) {
        this.early.splice(i, 1);
        this.deliver(e.from, e.data);
      } else i++;
    }
  }

  broadcast(msg: NetMessage, except?: string): void {
    const text = JSON.stringify(msg);
    for (const p of this.list) if (p !== except) this.bridge.send(p, text);
  }

  send(peer: string, msg: NetMessage): void {
    this.bridge.send(peer, JSON.stringify(msg));
  }

  onMessage(fn: MessageHandler): void {
    this.handlers.push(fn);
  }

  close(): void {
    this.closed = true;
    this.handlers = [];
    this.list = [];
    this.early.length = 0;
  }
}
