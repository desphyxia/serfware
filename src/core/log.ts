export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Milliseconds since page load. */
  t: number;
  level: LogLevel;
  msg: string;
}

type Listener = (e: LogEntry) => void;

/** A fixed-size ring buffer of recent log lines, included in every crash report. */
export class RingLog {
  private readonly buf: LogEntry[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly capacity = 500,
    private readonly now: () => number = () => (typeof performance !== "undefined" ? performance.now() : 0),
  ) {}

  add(level: LogLevel, msg: string): void {
    const e: LogEntry = { t: Math.round(this.now()), level, msg };
    this.buf.push(e);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
    for (const l of this.listeners) l(e);
  }

  debug(msg: string): void {
    this.add("debug", msg);
  }
  info(msg: string): void {
    this.add("info", msg);
  }
  warn(msg: string): void {
    this.add("warn", msg);
  }
  error(msg: string): void {
    this.add("error", msg);
  }

  entries(): readonly LogEntry[] {
    return this.buf;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const log = new RingLog();

export function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 2000);
}

/** Mirror console warnings and errors into the ring log without changing console behaviour. */
export function captureConsole(target: RingLog = log): void {
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  for (const level of ["warn", "error"] as const) {
    const original = c[level]?.bind(console);
    if (!original) continue;
    c[level] = (...args: unknown[]) => {
      target.add(level, formatArgs(args));
      original(...args);
    };
  }
}
