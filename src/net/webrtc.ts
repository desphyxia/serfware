import { log } from "../core/log";
import type { MessageHandler, NetMessage, Transport } from "./transport";

export const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

function encode(desc: RTCSessionDescriptionInit): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ t: desc.type, s: desc.sdp }))));
}

function decode(code: string): RTCSessionDescriptionInit {
  const o = JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as { t: RTCSdpType; s: string };
  return { type: o.t, sdp: o.s };
}

/** Wait until ICE gathering finishes (non-trickle), or give up after `ms`. */
function gathered(pc: RTCPeerConnection, ms = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, ms);
  });
}

/** One WebRTC connection with a reliable, ordered data channel. */
export class RtcPeer {
  readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  onMessage: (msg: NetMessage) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  constructor(
    readonly id: string,
    ice: RTCIceServer[] = DEFAULT_ICE,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ice });
    this.pc.ondatachannel = (e) => this.attach(e.channel);
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.onClose();
    };
  }

  get open(): boolean {
    return this.channel?.readyState === "open";
  }

  private attach(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.onopen = () => this.onOpen();
    ch.onclose = () => this.onClose();
    ch.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as NetMessage);
      } catch (err) {
        log.warn(`Bad message from ${this.id}: ${(err as Error).message}`);
      }
    };
  }

  /** Host side: create an offer code. */
  async createOffer(): Promise<string> {
    this.attach(this.pc.createDataChannel("seedfall", { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return encode(this.pc.localDescription as RTCSessionDescriptionInit);
  }

  /** Guest side: accept an offer code, return an answer code. */
  async acceptOffer(code: string): Promise<string> {
    await this.pc.setRemoteDescription(decode(code));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return encode(this.pc.localDescription as RTCSessionDescriptionInit);
  }

  /** Host side: accept the guest's answer code. */
  async acceptAnswer(code: string): Promise<void> {
    await this.pc.setRemoteDescription(decode(code));
  }

  send(msg: NetMessage): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(msg));
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}

/** Transport over a set of RtcPeers (star: guests have one peer, the host; the host has all). */
export class RtcTransport implements Transport {
  private readonly map = new Map<string, RtcPeer>();
  private handlers: MessageHandler[] = [];

  get peers(): string[] {
    return [...this.map.keys()];
  }

  add(peer: RtcPeer): void {
    this.map.set(peer.id, peer);
    peer.onMessage = (msg) => {
      for (const h of this.handlers) h(msg, peer.id);
    };
  }

  remove(id: string): void {
    this.map.get(id)?.close();
    this.map.delete(id);
  }

  broadcast(msg: NetMessage, except?: string): void {
    for (const [id, p] of this.map) if (id !== except) p.send(msg);
  }

  send(peer: string, msg: NetMessage): void {
    this.map.get(peer)?.send(msg);
  }

  onMessage(fn: MessageHandler): void {
    this.handlers.push(fn);
  }

  close(): void {
    for (const p of this.map.values()) p.close();
    this.map.clear();
    this.handlers = [];
  }
}

/** Minimal client for the signalling server in scripts/signal.mjs. */
export class SignalClient {
  private ws: WebSocket;
  onMessage: (msg: NetMessage) => void = () => {};

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as NetMessage);
  }

  static connect(url: string, timeoutMs = 4000): Promise<SignalClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      const t = setTimeout(() => reject(new Error(`Could not reach ${url}`)), timeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        resolve(new SignalClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error(`Could not reach ${url}`));
      };
    });
  }

  send(msg: NetMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }
}

export function webrtcAvailable(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}
