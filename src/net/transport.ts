/** Messages exchanged between peers. All are JSON-serialisable. */
export interface NetMessage {
  type: string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: NetMessage, from: string) => void;

/**
 * Connection to the other players. WebRTC implements it for browsers; Steam networking will
 * implement it for the desktop build (batch 12). `broadcast` skips the `except` peer.
 */
export interface Transport {
  readonly peers: readonly string[];
  broadcast(msg: NetMessage, except?: string): void;
  send(peer: string, msg: NetMessage): void;
  onMessage(fn: MessageHandler): void;
  /** A peer's connection closed (they left or dropped). */
  onPeerLeft?(fn: (peer: string) => void): void;
  close(): void;
}

/** In-memory transport for tests: a hub connects any number of endpoints with optional latency. */
export class LoopbackHub {
  private readonly endpoints = new Map<string, LoopbackTransport>();
  latencyTicks = 0;
  private readonly queue: { at: number; to: string; msg: NetMessage; from: string }[] = [];
  private clock = 0;

  connect(id: string): LoopbackTransport {
    const t = new LoopbackTransport(id, this);
    this.endpoints.set(id, t);
    return t;
  }

  ids(): string[] {
    return [...this.endpoints.keys()];
  }

  /** An endpoint drops off the network; the others hear that it left. */
  disconnect(id: string): void {
    const t = this.endpoints.get(id);
    if (!t) return;
    this.endpoints.delete(id);
    t.close();
    for (const o of this.endpoints.values()) o.left(id);
  }

  deliver(from: string, to: string, msg: NetMessage): void {
    const copy = JSON.parse(JSON.stringify(msg)) as NetMessage;
    if (this.latencyTicks <= 0) this.endpoints.get(to)?.dispatch(copy, from);
    else this.queue.push({ at: this.clock + this.latencyTicks, to, msg: copy, from });
  }

  /** Advance simulated network time (only used when latency is set). */
  pump(): void {
    this.clock++;
    for (let i = 0; i < this.queue.length; ) {
      const q = this.queue[i]!;
      if (q.at <= this.clock) {
        this.queue.splice(i, 1);
        this.endpoints.get(q.to)?.dispatch(q.msg, q.from);
      } else i++;
    }
  }
}

export class LoopbackTransport implements Transport {
  private handlers: MessageHandler[] = [];
  private leftHandlers: ((peer: string) => void)[] = [];

  onPeerLeft(fn: (peer: string) => void): void {
    this.leftHandlers.push(fn);
  }

  left(peer: string): void {
    for (const h of this.leftHandlers) h(peer);
  }

  constructor(
    readonly id: string,
    private readonly hub: LoopbackHub,
  ) {}

  get peers(): string[] {
    return this.hub.ids().filter((x) => x !== this.id);
  }

  broadcast(msg: NetMessage, except?: string): void {
    for (const p of this.peers) if (p !== except) this.hub.deliver(this.id, p, msg);
  }

  send(peer: string, msg: NetMessage): void {
    this.hub.deliver(this.id, peer, msg);
  }

  onMessage(fn: MessageHandler): void {
    this.handlers.push(fn);
  }

  dispatch(msg: NetMessage, from: string): void {
    for (const h of this.handlers) h(msg, from);
  }

  close(): void {
    this.handlers = [];
  }
}
