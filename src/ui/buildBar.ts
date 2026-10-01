import { BUILDINGS, GOODS, type BuildingDef, type Category } from "../sim/econ/defs";
import { h } from "./dom";

export type ToolId = "select" | "flag" | "road" | "demolish" | string;

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS: Record<string, string> = {
  select: svg(`<path d="M6 4l12 7-5 1.5L10 18z" ${STROKE}/>`),
  flag: svg(`<path d="M7 21V4M7 5h9l-2 3 2 3H7" ${STROKE}/>`),
  road: svg(`<path d="M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2" ${STROKE}/>`),
  demolish: svg(`<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" ${STROKE}/>`),
  materials: svg(`<path d="M6 20l8-8M14 12l3-7 3 3-6 4z" ${STROKE}/><path d="M4 20h7" ${STROKE}/>`),
  food: svg(`<path d="M12 3v18M12 7c-3 0-4-2-4-4 3 0 4 2 4 4zM12 7c3 0 4-2 4-4-3 0-4 2-4 4zM12 12c-3 0-4-2-4-4 3 0 4 2 4 4zM12 12c3 0 4-2 4-4-3 0-4 2-4 4zM12 17c-3 0-4-2-4-4 3 0 4 2 4 4zM12 17c3 0 4-2 4-4-3 0-4 2-4 4z" ${STROKE}/>`),
  metal: svg(`<path d="M4 18h16M6 18l2-6h8l2 6M9 12V8h6v4M12 8V4" ${STROKE}/>`),
  storage: svg(`<path d="M3 10l9-6 9 6v10H3zM9 20v-6h6v6" ${STROKE}/>`),
  lantern: svg(`<path d="M12 2v3M8 7h8l-1 9H9zM9 16l-1 5h8l-1-5M12 10v3" ${STROKE}/>`),
  terra: svg(`<circle cx="12" cy="12" r="8" ${STROKE}/><path d="M12 20c0-5 2-8 6-9M12 20c0-4-2-6-5-7M9 6c2 1 3 3 3 6" ${STROKE}/>`),
  decor: svg(`<path d="M12 21V9M12 9c-2-3-6-3-6 0s4 4 6 0zM12 9c2-3 6-3 6 0s-4 4-6 0zM12 9c-1-3 0-6 0-6s1 3 0 6" ${STROKE}/>`),
  almanac: svg(`<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14" ${STROKE}/>`),
  system: svg(`<circle cx="12" cy="12" r="2.5" ${STROKE}/><ellipse cx="12" cy="12" rx="10" ry="4.5" ${STROKE}/><circle cx="20" cy="10" r="1.3" fill="currentColor"/>`),
  diplomacy: svg(`<path d="M2 12l4-4 4 2 3-2 5 1 4 3M6 8v6l5 5 2-1 2 1 3-3M10 16l3-3M12 18l3-3" ${STROKE}/>`),
  economy: svg(`<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" ${STROKE}/>`),
};

export const CATEGORIES: { id: Category; label: string; key: string }[] = [
  { id: "materials", label: "Materials", key: "3" },
  { id: "food", label: "Food", key: "4" },
  { id: "metal", label: "Mining", key: "5" },
  { id: "storage", label: "Homes", key: "6" },
  { id: "lantern", label: "Lanterns", key: "7" },
  { id: "terra", label: "Terraform", key: "8" },
  { id: "decor", label: "Decor", key: "9" },
];

/** Hedgerows are planted with the Food tools, though they are not buildings. */
export const HEDGE: BuildingDef = {
  id: "hedge",
  name: "Hedgerow",
  description: "Plant a hedgerow on open ground (takes a log). Hedgerows shelter the fields beside them, feed the bees and keep the soil. Remove one with Demolish.",
  category: "food",
  cost: { log: 1 },
};

/** Causeways are raised with the Materials tools: a stone deck over the tidal flats. */
export const CAUSEWAY: BuildingDef = {
  id: "causeway",
  name: "Causeway",
  description: "Raise a stone causeway on a tidal flat (takes a stone). Roads over it stay dry at high tide; lay the road first or after.",
  category: "materials",
  cost: { stone: 1 },
};

/** Tools listed with a category's buildings that are not buildings themselves. */
export const EXTRA_TOOLS: Partial<Record<Category, BuildingDef[]>> = { food: [HEDGE], materials: [CAUSEWAY] };

export function costText(def: BuildingDef): string {
  return Object.entries(def.cost)
    .map(([k, v]) => `${GOODS.find((g) => g.id === k)?.name ?? k} ${v}`)
    .join(" · ");
}

/**
 * Bottom toolbar: select, flag, road, four building categories (each opens a list), demolish
 * and the economy panel. Keys: Esc, 1, 2, 3–7, X, P.
 */
export class BuildBar {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly popover: HTMLElement;
  /** Shows a button's explanation (touch: press and hold). */
  hint: (text: string) => void = () => {};
  private openCat: Category | null = null;

  constructor(
    private readonly onPick: (id: ToolId) => void,
    private readonly onEconomy: () => void,
    private readonly onSystem: () => void = () => {},
    private readonly onAlmanac: () => void = () => {},
    /** Why a building can't be chosen yet (not in the Almanac), or null. */
    private readonly locked: (id: string) => string | null = () => null,
    private readonly onDiplomacy: () => void = () => {},
  ) {
    const bar = h("div", { class: "buildbar", role: "toolbar", "aria-label": "Build tools" });
    const add = (id: string, label: string, key: string, icon: string, hint: string, fn: () => void) => {
      // Touch: press and hold a button to read what it does (there is no hover on a phone).
      let held = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let downAt = -1;
      const explain = () => {
        if (held) return;
        held = true;
        this.hint(`${label}: ${hint}`);
      };
      const b = h("button", {
        class: "bb",
        title: `${label} (${key})\n${hint}`,
        "aria-label": label,
        onclick: () => {
          if (held) held = false;
          else fn();
        },
      }) as HTMLButtonElement;
      b.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        held = false;
        downAt = e.timeStamp;
        timer = setTimeout(explain, 500);
      });
      // Judge the hold by the touches' own times too: on a busy page the timer can fire late, or
      // the touch down and up be handled back to back, long after the finger moved.
      b.addEventListener("pointerup", (e) => {
        if (timer) clearTimeout(timer);
        if (e.pointerType === "touch" && downAt >= 0 && e.timeStamp - downAt >= 500) explain();
        downAt = -1;
      });
      for (const ev of ["pointercancel", "pointerleave"])
        b.addEventListener(ev, () => {
          if (timer) clearTimeout(timer);
          downAt = -1;
        });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
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
    add("system", "System", "O", ICONS.system!, "The star system: planets, orbits and launch windows.", () => this.onSystem());
    add("almanac", "Almanac", "L", ICONS.almanac!, "What your people have learned of their world, and what it unlocks.", () => this.onAlmanac());
    add("diplomacy", "Diplomacy", "J", ICONS.diplomacy!, "Other settlements: treaties, offers, prisoners and your name among them.", () => this.onDiplomacy());
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
    const extra = EXTRA_TOOLS[cat] ?? [];
    this.popover.replaceChildren(
      ...[...defs, ...extra].map((d) => {
        const why = this.locked(d.id);
        return h(
          "button",
          { class: `pop-item${why ? " locked" : ""}`, role: "menuitem", title: why ?? d.description, "aria-disabled": why ? "true" : undefined, onclick: () => (why ? undefined : this.pick(d.id)) },
          h("span", { class: "pop-name" }, d.name),
          h("span", { class: "pop-cost" }, why ? "locked" : costText(d)),
        );
      }),
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
    else if (k === "l") this.onAlmanac();
    else if (k === "j") this.onDiplomacy();
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
