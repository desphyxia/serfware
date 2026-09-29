import { BUILDINGS, GOODS, type BuildingDef, type Category } from "../sim/econ/defs";
import { h } from "./dom";

export type ToolId = "select" | "flag" | "road" | "demolish" | string;

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<string, string> = {
  select: svg(`<path d="M6 4l12 7-5 1.5L10 18z" ${STROKE}/>`),
  flag: svg(`<path d="M7 21V4M7 5h9l-2 3 2 3H7" ${STROKE}/>`),
  road: svg(`<path d="M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2" ${STROKE}/>`),
  demolish: svg(`<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" ${STROKE}/>`),
  materials: svg(`<path d="M6 20l8-8M14 12l3-7 3 3-6 4z" ${STROKE}/><path d="M4 20h7" ${STROKE}/>`),
  food: svg(`<path d="M12 3v18M12 7c-3 0-4-2-4-4 3 0 4 2 4 4zM12 7c3 0 4-2 4-4-3 0-4 2-4 4zM12 12c-3 0-4-2-4-4 3 0 4 2 4 4zM12 12c3 0 4-2 4-4-3 0-4 2-4 4zM12 17c-3 0-4-2-4-4 3 0 4 2 4 4zM12 17c3 0 4-2 4-4-3 0-4 2-4 4z" ${STROKE}/>`),
  metal: svg(`<path d="M4 18h16M6 18l2-6h8l2 6M9 12V8h6v4M12 8V4" ${STROKE}/>`),
  storage: svg(`<path d="M3 10l9-6 9 6v10H3zM9 20v-6h6v6" ${STROKE}/>`),
  economy: svg(`<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" ${STROKE}/>`),
};

const CATEGORIES: { id: Category; label: string; key: string }[] = [
  { id: "materials", label: "Materials", key: "3" },
  { id: "food", label: "Food", key: "4" },
  { id: "metal", label: "Mining", key: "5" },
  { id: "storage", label: "Storage", key: "6" },
];

function costText(def: BuildingDef): string {
  return Object.entries(def.cost)
    .map(([k, v]) => `${GOODS.find((g) => g.id === k)?.name ?? k} ${v}`)
    .join(" · ");
}

/**
 * Bottom toolbar: select, flag, road, four building categories (each opens a list), demolish
 * and the economy panel. Keys: Esc, 1, 2, 3–6, X, P.
 */
export class BuildBar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly popover: HTMLElement;
  private openCat: Category | null = null;

  constructor(
    private readonly onPick: (id: ToolId) => void,
    private readonly onEconomy: () => void,
  ) {
    const bar = h("div", { class: "buildbar", role: "toolbar", "aria-label": "Build tools" });
    const add = (id: string, label: string, key: string, icon: string, hint: string, fn: () => void) => {
      const b = h("button", { class: "bb", title: `${label} (${key})\n${hint}`, "aria-label": label, onclick: fn }) as HTMLButtonElement;
      b.innerHTML = `${icon}<span class="bb-l">${label}</span><kbd>${key}</kbd>`;
      this.buttons.set(id, b);
      bar.append(b);
    };
    add("select", "Select", "Esc", ICONS.select!, "Inspect buildings, flags and roads.", () => this.pick("select"));
    add("flag", "Flag", "1", ICONS.flag!, "Place a flag. Flags on roads split them so more carriers can work.", () => this.pick("flag"));
    add("road", "Road", "2", ICONS.road!, "Click a flag, then click where the road should go. Right-click to stop.", () => this.pick("road"));
    for (const c of CATEGORIES) add(c.id, c.label, c.key, ICONS[c.id]!, `${c.label} buildings`, () => this.toggleCategory(c.id));
    add("demolish", "Demolish", "X", ICONS.demolish!, "Remove a building, flag or road. Click twice to confirm.", () => this.pick("demolish"));
    add("economy", "Economy", "P", ICONS.economy!, "Stock, distribution and tool priorities.", () => this.onEconomy());
    this.popover = h("div", { class: "bb-pop", hidden: true, role: "menu" });
    this.root = h("div", { class: "buildbar-wrap" }, this.popover, bar);
  }

  private pick(id: ToolId): void {
    this.closePopover();
    this.onPick(id);
  }

  toggleCategory(cat: Category): void {
    if (this.openCat === cat) {
      this.closePopover();
      return;
    }
    this.openCat = cat;
    const defs = BUILDINGS.filter((b) => b.category === cat && b.buildable !== false);
    this.popover.replaceChildren(
      ...defs.map((d) =>
        h(
          "button",
          { class: "pop-item", role: "menuitem", title: d.description, onclick: () => this.pick(d.id) },
          h("span", { class: "pop-name" }, d.name),
          h("span", { class: "pop-cost" }, costText(d)),
        ),
      ),
    );
    this.popover.hidden = false;
    for (const c of CATEGORIES) this.buttons.get(c.id)?.classList.toggle("open", c.id === cat);
  }

  closePopover(): boolean {
    if (!this.openCat) return false;
    this.openCat = null;
    this.popover.hidden = true;
    for (const c of CATEGORIES) this.buttons.get(c.id)?.classList.remove("open");
    return true;
  }

  setActive(id: ToolId): void {
    const def = BUILDINGS.find((b) => b.id === id);
    for (const [k, b] of this.buttons) b.classList.toggle("on", k === id || (!!def && k === def.category));
  }

  /** Handle a key; returns true if it was a toolbar shortcut. */
  key(key: string): boolean {
    const k = key.toLowerCase();
    if (k === "1") this.pick("flag");
    else if (k === "2") this.pick("road");
    else if (k === "x") this.pick("demolish");
    else if (k === "p") this.onEconomy();
    else {
      const cat = CATEGORIES.find((c) => c.key === k);
      if (!cat) return false;
      this.toggleCategory(cat.id);
    }
    return true;
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
