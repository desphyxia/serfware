import { BUILDINGS, type Category } from "../sim/econ/defs";
import { CATEGORIES, costText, ICONS, type ToolId } from "./buildBar";
import { h } from "./dom";

/** Slice a stick direction points at, for `n` slices starting at the top, clockwise; -1 near the centre. */
export function radialIndex(x: number, y: number, n: number, dead = 0.45): number {
  if (Math.hypot(x, y) < dead || n <= 0) return -1;
  // Angle clockwise from straight up (screen y grows downward).
  let a = Math.atan2(x, -y);
  if (a < 0) a += Math.PI * 2;
  return Math.round(a / ((Math.PI * 2) / n)) % n;
}

interface Item {
  id: string;
  label: string;
  hint: string;
  icon?: string;
  /** A category opens a second ring of its buildings. */
  category?: Category;
}

const TOP: Item[] = [
  { id: "select", label: "Select", hint: "Inspect buildings, flags and roads.", icon: ICONS.select },
  { id: "flag", label: "Flag", hint: "Place a flag.", icon: ICONS.flag },
  { id: "road", label: "Road", hint: "From a flag to where the road should go.", icon: ICONS.road },
  ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: `${c.label} buildings`, icon: ICONS[c.id], category: c.id })),
  { id: "demolish", label: "Demolish", hint: "Remove a building, flag or road.", icon: ICONS.demolish },
];

/**
 * Radial build menu for controllers (X), also usable with the mouse: tools and building
 * categories on a ring, a category's buildings on a second ring. Point the left stick and press
 * A; B steps back out.
 */
export class RadialMenu {
  readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly label: HTMLElement;
  private items: Item[] = TOP;
  private sel = -1;
  private level: Category | null = null;

  constructor(private readonly onPick: (id: ToolId) => void) {
    this.ring = h("div", { class: "radial-ring" });
    this.label = h("div", { class: "radial-label" });
    this.root = h("div", { class: "radial", hidden: true, role: "menu", "aria-label": "Build menu" }, this.ring, this.label);
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.level = null;
    this.items = TOP;
    this.sel = -1;
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  /** B: out of a category, or close. */
  back(): void {
    if (this.level) this.show();
    else this.close();
  }

  /** Point with the stick. */
  aim(x: number, y: number): void {
    const i = radialIndex(x, y, this.items.length);
    if (i >= 0 && i !== this.sel) {
      this.sel = i;
      this.highlight();
    }
  }

  /** A: open the category or pick the tool. */
  confirm(): void {
    const it = this.items[this.sel];
    if (it) this.choose(it);
  }

  private choose(it: Item): void {
    if (it.category) {
      this.level = it.category;
      this.items = BUILDINGS.filter((b) => b.category === it.category && b.buildable !== false).map((b) => ({ id: b.id, label: b.name, hint: `${costText(b)} · ${b.description}` }));
      this.sel = -1;
      this.render();
      return;
    }
    this.close();
    this.onPick(it.id);
  }

  private render(): void {
    const n = this.items.length;
    const r = n > 8 ? 42 : 38;
    this.ring.replaceChildren(
      ...this.items.map((it, i) => {
        const a = (i / n) * Math.PI * 2;
        const b = h("button", {
          class: "radial-item",
          role: "menuitem",
          style: `left:${50 + Math.sin(a) * r}%;top:${50 - Math.cos(a) * r}%`,
          onclick: () => this.choose(it),
          onmouseenter: () => {
            this.sel = i;
            this.highlight();
          },
        });
        b.innerHTML = `${it.icon ?? ""}<span>${it.label}</span>`;
        return b;
      }),
    );
    this.highlight();
  }

  private highlight(): void {
    [...this.ring.children].forEach((c, i) => c.classList.toggle("on", i === this.sel));
    const it = this.items[this.sel];
    this.label.replaceChildren(
      h("strong", {}, it ? it.label : this.level ? (CATEGORIES.find((c) => c.id === this.level)?.label ?? "") : "Build"),
      h("span", {}, it ? it.hint : "Point the left stick, press A. B goes back."),
    );
  }
}
