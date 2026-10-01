import { DISCOVERIES, DISCOVERY_IDS, FESTIVALS, type DiscoveryDef, type DiscoveryId } from "../sim/econ/culture";
import { BUILDINGS } from "../sim/econ/defs";
import type { Economy } from "../sim/econ/economy";
import { h, Panel } from "./dom";

const SVG = "http://www.w3.org/2000/svg";

/** Ink sketches for each page, drawn in a 100×70 box (wobbled by an SVG filter). */
const SKETCH: Record<DiscoveryId, string> = {
  weather: "M20 35c-8 0-8-12 2-12 2-9 18-9 20 0 10-2 14 10 4 12zM24 42l-4 10M34 42l-4 10M44 42l-4 10M60 20a8 8 0 1 0 16 0a8 8 0 1 0-16 0M68 6v4M68 30v4M54 20h4M78 20h4",
  seasons: "M50 35m-22 0a22 22 0 1 0 44 0a22 22 0 1 0-44 0M50 13v44M28 35h44M38 25a5 5 0 1 0 1 0M62 41l4 4M66 41l-4 4M60 26c3-4 6-4 8 0M34 46c2 4 6 4 8 0",
  springs: "M30 55h40M34 55v-16h32v16M38 39c0-10 24-10 24 0M50 29v-14M50 15c-6 4-8 10-4 12M50 15c6 4 8 10 4 12",
  stars: "M50 14l20 15-8 24h-24l-8-24zM50 4v6M78 26l-6 3M70 62l-4-6M30 62l4-6M22 26l6 3M38 58h24",
  precursors: "M28 60V22M36 60V30M28 22h10M24 60h16M64 40m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M64 40m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M60 56l8-6M72 26l6-6",
  frost: "M50 10v50M28 22l44 26M28 48l44-26M50 18l-5-5M50 18l5-5M50 52l-5 5M50 52l5 5M34 25l-1-7M66 45l1 7",
  tides: "M70 18a10 10 0 1 1-8 16a12 12 0 0 0 8-16M14 48c6-6 12-6 18 0s12 6 18 0 12-6 18 0 12 6 18 0M14 58c6-6 12-6 18 0s12 6 18 0 12-6 18 0 12 6 18 0",
  fire: "M50 62c-14 0-18-14-10-24 2 6 6 6 6 6-2-12 6-22 14-26-2 10 10 14 8 26 4-2 4-6 4-6 6 12-4 24-22 24zM50 62c-6 0-8-6-4-10 0 4 4 4 4 4 0-6 4-10 6-12 0 6 6 8 2 18",
  bees: "M42 38m-12 0a12 8 0 1 0 24 0a12 8 0 1 0-24 0M38 30v16M44 30v16M54 34c4-2 8-2 10 2M36 30c-4-10 6-14 8-4M44 30c2-10 14-8 8 2M66 22c4 0 6 4 2 6",
  eruption: "M14 62l26-30h20l26 30zM40 32c-2-8 4-10 6-6 0-8 8-10 10-2 4-4 10 0 6 6M44 18l-4-8M52 16v-10M60 18l6-8",
  storms: "M50 36m-4 0a4 4 0 1 1 8 0c0 10-20 10-20-2 0-14 30-16 30 4 0 18-40 20-40-4M14 20h20M18 54h18M72 56h16",
  festival: "M50 62V10M50 10l-22 46M50 10l22 46M50 10l-12 50M50 10l12 50M44 10a6 4 0 1 0 12 0a6 4 0 1 0-12 0M30 62h40",
};

/**
 * The Almanac (L): a hand-written book of what the people have learned by watching their world.
 * Each page has an ink sketch, the note, who noticed and when, and what it unlocked. Pages not
 * yet found are blank but for a hint.
 */
export class AlmanacPanel extends Panel {
  private readonly index: HTMLElement;
  private readonly page: HTMLElement;
  private selected: DiscoveryId | null = null;
  private key = "";

  constructor(
    private readonly economy: () => Economy,
    private readonly player: () => number,
  ) {
    super("almanac", "Almanac", { width: 560, className: "almanac" });
    this.index = h("nav", { class: "alm-index", "aria-label": "Pages" });
    this.page = h("article", { class: "alm-page" });
    // The ink wobbles a little, as if drawn by hand.
    const filter = document.createElementNS(SVG, "svg");
    filter.setAttribute("width", "0");
    filter.setAttribute("height", "0");
    filter.innerHTML = `<filter id="alm-ink"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>`;
    this.body.append(filter, h("div", { class: "alm-book" }, this.index, this.page));
  }

  protected override onShow(): void {
    this.key = "";
    this.refresh();
  }

  refresh(): void {
    if (!this.visible) return;
    const eco = this.economy();
    const p = this.player();
    const pages = eco.culture.pages[p] ?? [];
    const key = `${pages.length}:${this.selected}:${eco.culture.relics[p] ?? 0}:${eco.culture.festivalAt[p] ?? -1}`;
    if (key === this.key) return;
    this.key = key;
    this.selected ??= pages[pages.length - 1]?.id ?? null;
    const found = new Map(pages.map((x) => [x.id, x]));
    this.index.replaceChildren(
      h("p", { class: "alm-count" }, `${pages.length} of ${DISCOVERY_IDS.length} pages`),
      ...DISCOVERY_IDS.map((id) =>
        h(
          "button",
          { class: `alm-tab${found.has(id) ? "" : " blank"}${id === this.selected ? " on" : ""}`, onclick: () => this.select(id) },
          found.has(id) ? DISCOVERIES[id].title : "· · ·",
        ),
      ),
    );
    const id = this.selected;
    if (!id) {
      this.page.replaceChildren(h("p", { class: "alm-text" }, "Blank pages, waiting. Watch the world: the weather, the seasons, the land at the edge of your border. What your people notice is written here."));
      return;
    }
    const d: DiscoveryDef = DISCOVERIES[id];
    const at = found.get(id);
    const sketch = document.createElementNS(SVG, "svg");
    sketch.setAttribute("viewBox", "0 0 100 70");
    sketch.setAttribute("class", "alm-sketch");
    sketch.setAttribute("aria-hidden", "true");
    sketch.innerHTML = `<path d="${SKETCH[id]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#alm-ink)"/>`;
    const unlocks = d.unlocks.map((u) => (u === "forecast" ? "tomorrow's forecast" : u === "tides" ? "the tide table" : (BUILDINGS.find((b) => b.id === u)?.name ?? u)));
    if (!at) {
      this.page.replaceChildren(h("h3", { class: "alm-title blank" }, "Not yet seen"), h("p", { class: "alm-text" }, hint(id)));
      return;
    }
    const parts: (HTMLElement | SVGElement | null)[] = [
      h("h3", { class: "alm-title" }, d.title),
      sketch,
      h("p", { class: "alm-text" }, d.text),
      h("p", { class: "alm-by" }, `Noted on day ${at.day}${at.by ? ` by ${at.by}` : ""}.`),
      unlocks.length ? h("p", { class: "alm-unlocks" }, `Unlocked: ${unlocks.join(", ")}.`) : null,
      id === "festival" || id === "seasons" ? h("p", { class: "alm-by" }, `The feasts of the year: ${FESTIVALS.map((f) => f.name).join(", ")}.`) : null,
      id === "precursors" ? h("p", { class: "alm-by" }, `Relics found: ${eco.culture.relics[p] ?? 0}.`) : null,
    ];
    this.page.replaceChildren(...parts.filter((x): x is HTMLElement | SVGElement => !!x));
  }

  select(id: DiscoveryId): void {
    this.selected = id;
    this.key = "";
    this.refresh();
  }
}

function hint(id: DiscoveryId): string {
  switch (id) {
    case "weather":
      return "Give it a few days: someone will learn to read the sky.";
    case "seasons":
      return "Wait for the year to turn.";
    case "springs":
      return "Dig a well.";
    case "stars":
      return "Bring a Star Well inside your border.";
    case "precursors":
      return "Excavate the ruin beside a Star Well.";
    case "frost":
      return "Live through a hard frost.";
    case "tides":
      return "Settle by the Tidewater flats.";
    case "fire":
      return "Lightning will teach this one, sooner or later.";
    case "bees":
      return "Keep bees.";
    case "eruption":
      return "Live near the Emberglass vents.";
    case "storms":
      return "Live near the Saltglass Flats.";
    case "festival":
      return "Raise a maypole and keep food for the feast days.";
  }
}
