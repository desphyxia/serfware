import type { MemSample } from "../core/memory";
import type { RenderStats } from "../render/renderer";
import { h, Panel } from "./dom";

export interface DebugSource {
  fps: () => number;
  frameTimes: () => readonly number[];
  render: () => RenderStats;
  memory: () => readonly MemSample[];
  sim: () => { tick: number; ticksPerSec: number; checksum: number; speed: number };
  warnings: () => readonly string[];
  extra?: () => Record<string, string>;
  actions: Record<string, () => void>;
}

/** Live performance and state dialog (F3). */
export class DebugPanel extends Panel {
  private readonly stats: HTMLElement;
  private readonly frameGraph: HTMLCanvasElement;
  private readonly memGraph: HTMLCanvasElement;
  private readonly warn: HTMLElement;

  constructor(private readonly src: DebugSource) {
    super("debug", "Debug", { width: 340, className: "debug" });
    this.stats = h("dl", { class: "kv" });
    this.frameGraph = h("canvas", { width: 300, height: 56, class: "graph", "aria-label": "Frame time graph" }) as HTMLCanvasElement;
    this.memGraph = h("canvas", { width: 300, height: 56, class: "graph", "aria-label": "Memory graph" }) as HTMLCanvasElement;
    this.warn = h("ul", { class: "warn-list" });
    const actions = h("div", { class: "btn-row wrap" });
    for (const [name, fn] of Object.entries(src.actions)) actions.append(h("button", { class: "btn small", onclick: fn }, name));
    this.body.append(
      h("h3", { class: "sub" }, "Frame time (ms)"),
      this.frameGraph,
      h("h3", { class: "sub" }, "Memory: heap MB · geometries · textures"),
      this.memGraph,
      this.stats,
      this.warn,
      h("h3", { class: "sub" }, "Tools"),
      actions,
    );
  }

  update(): void {
    if (!this.visible) return;
    const r = this.src.render();
    const sim = this.src.sim();
    const mem = this.src.memory();
    const last = mem[mem.length - 1];
    const rows: [string, string][] = [
      ["FPS", this.src.fps().toFixed(0)],
      ["Draw calls", String(r.drawCalls)],
      ["Triangles", r.triangles.toLocaleString("en")],
      ["Geometries", String(r.geometries)],
      ["Textures", String(r.textures)],
      ["Shader programs", String(r.programs)],
      ["Canvas", `${r.width}×${r.height} @${r.pixelRatio.toFixed(2)}`],
      ["JS heap", last?.heapMB != null ? `${last.heapMB.toFixed(1)} MB` : "n/a"],
      ["Scene objects", String(last?.objects ?? 0)],
      ["Sim tick", `${sim.tick} (${sim.ticksPerSec.toFixed(1)}/s, ×${sim.speed})`],
      ["Checksum", sim.checksum.toString(16).padStart(8, "0")],
      ["GPU", r.gpu],
      ...Object.entries(this.src.extra?.() ?? {}),
    ];
    this.stats.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
    const warnings = this.src.warnings();
    this.warn.replaceChildren(...warnings.slice(-4).map((w) => h("li", {}, w)));
    drawSeries(this.frameGraph, [{ values: this.src.frameTimes(), color: "#f0b25a", max: 50 }], [16.7, 33.3]);
    drawSeries(
      this.memGraph,
      [
        { values: mem.map((m) => m.heapMB ?? 0), color: "#7fc4c8" },
        { values: mem.map((m) => m.geometries), color: "#9cc58f" },
        { values: mem.map((m) => m.textures), color: "#b7a3e0" },
      ],
      [],
    );
  }
}

function drawSeries(
  c: HTMLCanvasElement,
  series: { values: readonly number[]; color: string; max?: number }[],
  guides: number[],
): void {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const { width: w, height: hgt } = c;
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, w, hgt);
  const gmax = series[0]?.max;
  if (gmax) {
    ctx.strokeStyle = "rgba(236,229,212,0.18)";
    ctx.setLineDash([3, 3]);
    for (const g of guides) {
      const y = hgt - (g / gmax) * hgt;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for (const s of series) {
    if (s.values.length < 2) continue;
    const max = s.max ?? Math.max(1, ...s.values) * 1.15;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = s.values.length;
    s.values.forEach((v, i) => {
      const x = (i / (n - 1)) * w;
      const y = hgt - Math.min(1, v / max) * (hgt - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
