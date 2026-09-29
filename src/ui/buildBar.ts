import { BUILDINGS } from "../sim/econ/defs";
import { h } from "./dom";

export type ToolId = "select" | "flag" | "road" | "demolish" | string;

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: string;
  hint: string;
}

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<string, string> = {
  select: svg(`<path d="M6 4l12 7-5 1.5L10 18z" ${STROKE}/>`),
  flag: svg(`<path d="M7 21V4M7 5h9l-2 3 2 3H7" ${STROKE}/>`),
  road: svg(`<path d="M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2" ${STROKE}/>`),
  demolish: svg(`<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" ${STROKE}/>`),
  woodcutter: svg(`<path d="M6 20l8-8M14 12l3-7 3 3-6 4z" ${STROKE}/><path d="M4 20h7" ${STROKE}/>`),
  forester: svg(`<path d="M12 3l5 8h-3l4 6H6l4-6H7z M12 17v4" ${STROKE}/>`),
  quarry: svg(`<path d="M4 19l5-8 4 4 3-5 4 9z M15 5l3 3" ${STROKE}/>`),
  sawmill: svg(`<circle cx="15" cy="12" r="5" ${STROKE}/><path d="M3 12h7M15 7v10" ${STROKE}/>`),
};

/** Bottom toolbar: select, flag, road, buildings and demolish, with keyboard shortcuts. */
export class BuildBar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  readonly tools: ToolDef[];

  constructor(onPick: (id: ToolId) => void) {
    const buildable = BUILDINGS.filter((b) => b.buildable !== false);
    this.tools = [
      { id: "select", label: "Select", key: "Esc", icon: ICONS.select!, hint: "Inspect buildings, flags and roads." },
      { id: "flag", label: "Flag", key: "1", icon: ICONS.flag!, hint: "Place a flag. Flags on roads split them so more carriers can work." },
      { id: "road", label: "Road", key: "2", icon: ICONS.road!, hint: "Click a flag, then click where the road should go. Right-click to stop." },
      ...buildable.map((b, i) => ({ id: b.id, label: b.name, key: String(i + 3), icon: ICONS[b.id] ?? ICONS.flag!, hint: b.description })),
      { id: "demolish", label: "Demolish", key: "X", icon: ICONS.demolish!, hint: "Remove a building, flag or road. Click twice to confirm." },
    ];
    const bar = h("div", { class: "buildbar", role: "toolbar", "aria-label": "Build tools" });
    for (const t of this.tools) {
      const b = h("button", { class: "bb", title: `${t.label} (${t.key})\n${t.hint}`, "aria-label": t.label, onclick: () => onPick(t.id) }) as HTMLButtonElement;
      b.innerHTML = `${t.icon}<span class="bb-l">${t.label}</span><kbd>${t.key}</kbd>`;
      this.buttons.set(t.id, b);
      bar.append(b);
    }
    this.root = bar;
  }

  setActive(id: ToolId): void {
    for (const [k, b] of this.buttons) b.classList.toggle("on", k === id);
  }

  toolForKey(key: string): ToolId | null {
    const t = this.tools.find((x) => x.key.toLowerCase() === key.toLowerCase());
    return t ? t.id : null;
  }
}

/** Short messages that fade out. */
export class Toasts {
  readonly root = h("div", { class: "toasts", "aria-live": "polite" });

  show(text: string, kind: "info" | "warn" | "good" = "info"): void {
    const el = h("div", { class: `toast ${kind}` }, text);
    this.root.append(el);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3200);
  }
}
