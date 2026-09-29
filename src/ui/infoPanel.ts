import { GOODS } from "../sim/econ/defs";
import { FLAG_CAPACITY, type Economy } from "../sim/econ/economy";
import { GOOD_COLORS } from "../render/econView";
import { h, Panel } from "./dom";

export type Selection = { kind: "building" | "flag" | "road"; id: number } | null;

const STATE_TEXT: Record<string, string> = {
  goto: "on the way",
  idle: "waiting for goods",
  center: "walking to the middle of the road",
  fetch: "fetching goods",
  carry: "carrying goods",
  enter: "delivering",
  leave: "back to the road",
  rest: "resting inside",
  out: "heading out to work",
  work: "working",
  back: "coming back",
  craft: "crafting",
  drop: "bringing goods to the flag",
  home: "going home",
};

function goodChip(type: number, count: number | string): HTMLElement {
  const g = GOODS[type];
  return h(
    "span",
    { class: "chip-good" },
    h("i", { style: `background:${GOOD_COLORS[g?.id ?? ""] ?? "#fff"}` }),
    `${g?.name ?? "?"} ${count}`,
  );
}

/** Details for the selected building, flag or road, refreshed while open. */
export class InfoPanel extends Panel {
  private sel: Selection = null;

  constructor(
    private readonly eco: () => Economy,
    private readonly actions: { demolishTile: (tile: number) => void },
  ) {
    super("info", "Details", { width: 300, className: "info" });
  }

  select(sel: Selection): void {
    this.sel = sel;
    if (sel) {
      this.show();
      this.refresh();
    } else this.hide();
  }

  refresh(): void {
    if (!this.visible || !this.sel) return;
    const eco = this.eco();
    const body: HTMLElement[] = [];
    const title = this.root.querySelector(".panel-head h2") as HTMLElement;
    if (this.sel.kind === "building") {
      const b = eco.buildings[this.sel.id];
      if (!b || !b.alive) return this.select(null);
      title.textContent = b.built ? b.def.name : `${b.def.name} (site)`;
      body.push(h("p", { class: "lede" }, b.def.description));
      if (b.def.storage) {
        body.push(h("h3", { class: "sub" }, "Stock"));
        body.push(h("div", { class: "chips" }, ...b.stock.map((n, i) => goodChip(i, n))));
        body.push(h("p", { class: "hint" }, `${b.residents} settlers resting inside.`));
      } else if (!b.built) {
        const connected = eco.route(eco.buildings[eco.keeps[b.owner] as number]!.flag, b.flag).dist !== Infinity;
        body.push(h("p", { class: connected ? "status" : "status warn" }, connected ? (b.builder >= 0 ? "Builder at work." : "Waiting for a builder.") : "Not connected. Build a road from this flag to your roads."));
        body.push(h("h3", { class: "sub" }, "Materials delivered"));
        body.push(h("div", { class: "chips" }, ...b.cost.map((n, i) => (n > 0 ? goodChip(i, `${b.delivered[i]}/${n}`) : null)).filter((x): x is HTMLElement => !!x)));
        body.push(h("div", { class: "bar" }, h("i", { style: `width:${Math.round((b.consumed / Math.max(1, b.costTotal)) * 100)}%` })));
      } else {
        const w = b.worker >= 0 ? eco.settlers[b.worker] : null;
        body.push(h("p", { class: "status" }, w ? `Worker ${STATE_TEXT[w.state] ?? w.state}.` : "Waiting for a worker. Is it connected to the Hearthship?"));
        if (b.def.inputs) body.push(h("h3", { class: "sub" }, "Inputs"), h("div", { class: "chips" }, ...Object.keys(b.def.inputs).map((id) => goodChip(GOODS.findIndex((g) => g.id === id), b.stock[GOODS.findIndex((g) => g.id === id)] ?? 0))));
        if (b.output > 0) body.push(h("p", { class: "hint" }, `${b.output} finished, waiting to go out.`));
      }
      if (!eco.keeps.includes(b.id)) body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(b.tile) }, "Demolish")));
    } else if (this.sel.kind === "flag") {
      const f = eco.flags[this.sel.id];
      if (!f || !f.alive) return this.select(null);
      title.textContent = "Flag";
      body.push(h("p", { class: "status" }, `${f.goods.length} of ${FLAG_CAPACITY} places taken · ${f.roads.length} road${f.roads.length === 1 ? "" : "s"}`));
      const counts = new Map<number, number>();
      for (const g of f.goods) {
        const t = eco.goods[g]?.type ?? 0;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      if (counts.size) body.push(h("div", { class: "chips" }, ...[...counts].map(([t, n]) => goodChip(t, n))));
      if (f.goods.length >= 6) body.push(h("p", { class: "hint warn" }, "This flag is crowded. Add a parallel road or split long roads with flags."));
      if (!eco.keeps.includes(f.building)) body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(f.tile) }, "Remove flag")));
    } else {
      const r = eco.roads[this.sel.id];
      if (!r || !r.alive) return this.select(null);
      title.textContent = "Road";
      const c = r.carrier >= 0 ? eco.settlers[r.carrier] : null;
      body.push(h("p", { class: "status" }, `${r.tiles.length - 1} steps long · carrier ${c ? STATE_TEXT[c.state] ?? c.state : "not assigned yet"}`));
      body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(r.tiles[1] as number) }, "Remove road")));
    }
    this.body.replaceChildren(...body);
  }
}

/** Top-left summary of stock and settlers. */
export class StockBar {
  readonly root = h("div", { class: "stockbar", "aria-label": "Stock" });

  update(eco: Economy, player = 0): void {
    const totals = eco.storageTotals(player);
    const pop = eco.population(player);
    this.root.replaceChildren(
      ...totals.map((n, i) => goodChip(i, n)),
      h("span", { class: "chip-good pop", title: "Settlers resting / at work" }, `Settlers ${pop.idle} / ${pop.working}`),
    );
  }
}
