import { BUILD } from "../build";
import { log, type LogEntry } from "./log";
import type { MemSample } from "./memory";

export interface CapturedError {
  t: number;
  kind: "error" | "rejection" | "context-lost" | "desync" | "manual";
  message: string;
  stack?: string;
  source?: string;
}

export interface CrashReport {
  title: string;
  build: typeof BUILD;
  createdAt: string;
  uptimeSec: number;
  errors: CapturedError[];
  context: Record<string, unknown>;
  memory: MemSample[];
  log: LogEntry[];
}

type ContextProvider = () => unknown;
type CrashListener = (e: CapturedError) => void;

/**
 * Collects errors and context so a player can copy one report into a bug ticket.
 * Context providers add live state (seed, camera, settings, renderer info) at report time.
 */
export class CrashReporter {
  readonly errors: CapturedError[] = [];
  private readonly providers = new Map<string, ContextProvider>();
  private readonly listeners = new Set<CrashListener>();
  private memorySource: () => MemSample[] = () => [];

  install(target: Window = window): void {
    target.addEventListener("error", (ev) => {
      const err = ev.error as Error | undefined;
      this.capture({
        kind: "error",
        message: err?.message ?? ev.message ?? "Unknown error",
        stack: err?.stack,
        source: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined,
      });
    });
    target.addEventListener("unhandledrejection", (ev) => {
      const reason = ev.reason as unknown;
      const err = reason instanceof Error ? reason : undefined;
      this.capture({
        kind: "rejection",
        message: err?.message ?? String(reason),
        stack: err?.stack,
      });
    });
  }

  capture(e: Omit<CapturedError, "t">): void {
    const full: CapturedError = { t: Math.round(performance.now()), ...e };
    this.errors.push(full);
    if (this.errors.length > 50) this.errors.shift();
    log.error(`[${e.kind}] ${e.message}`);
    for (const l of this.listeners) l(full);
  }

  addContext(name: string, fn: ContextProvider): void {
    this.providers.set(name, fn);
  }

  setMemorySource(fn: () => MemSample[]): void {
    this.memorySource = fn;
  }

  onCrash(fn: CrashListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  build(title: string): CrashReport {
    const context: Record<string, unknown> = {};
    for (const [name, fn] of this.providers) {
      try {
        context[name] = fn();
      } catch (err) {
        context[name] = `unavailable: ${(err as Error).message}`;
      }
    }
    return {
      title,
      build: BUILD,
      createdAt: new Date().toISOString(),
      uptimeSec: Math.round(performance.now() / 1000),
      errors: [...this.errors],
      context,
      memory: this.memorySource().slice(-60),
      log: [...log.entries()].slice(-200),
    };
  }
}

/** Plain-text report: a readable summary on top, full JSON below for tooling. */
export function formatReport(r: CrashReport): string {
  const lines: string[] = [];
  lines.push(`# Seedfall bug report: ${r.title}`);
  lines.push("");
  lines.push(`Build:   ${r.build.id} (${r.build.date})`);
  lines.push(`Created: ${r.createdAt} · uptime ${r.uptimeSec}s`);
  const ctx = r.context;
  const bug = ctx["bugLine"];
  if (typeof bug === "string") lines.push(`Where:   ${bug}`);
  lines.push(`Errors:  ${r.errors.length}`);
  for (const e of r.errors.slice(-5)) {
    lines.push(`  - [${e.kind} @ ${(e.t / 1000).toFixed(1)}s] ${e.message}${e.source ? ` (${e.source})` : ""}`);
    if (e.stack) for (const s of e.stack.split("\n").slice(1, 6)) lines.push(`      ${s.trim()}`);
  }
  const last = r.memory[r.memory.length - 1];
  if (last) {
    lines.push(
      `Memory:  heap ${last.heapMB?.toFixed(1) ?? "n/a"} MB · geometries ${last.geometries} · textures ${last.textures} · programs ${last.programs} · objects ${last.objects}`,
    );
  }
  lines.push("");
  lines.push("Steps to reproduce:");
  lines.push("1. ");
  lines.push("");
  lines.push("<details><summary>Full report (JSON)</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(r, null, 1));
  lines.push("```");
  lines.push("</details>");
  return lines.join("\n");
}

export const crash = new CrashReporter();
