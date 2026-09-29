import { GOODS, goodsFor } from "../sim/econ/defs";
import { DEPOSIT_IDS } from "../sim/econ/landuse";
import { FLAG_CAPACITY, type Economy } from "../sim/econ/economy";
import { fullName, title as skillTitle, tradeName } from "../sim/econ/people";
import { GOOD_COLORS } from "../render/econView";
import { h, Panel } from "./dom";

export type Selection = { kind: "building" | "flag" | "road" | "person"; id: number } | null;

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
    private readonly actions: { demolishTile: (tile: number) => void; geologist: (flagTile: number) => void; follow: (person: number) => void; following: () => number },
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
    if (this.sel.kind === "person") {
      const p = eco.people[this.sel.id];
      if (!p || !p.alive) return this.select(null);
      title.textContent = fullName(p);
      const s = p.settler >= 0 ? eco.settlers[p.settler] : null;
      const work = s && s.building >= 0 ? eco.buildings[s.building] : null;
      const where = s
        ? s.role === "carrier"
          ? `Carrying on the roads, ${STATE_TEXT[s.state] ?? s.state}.`
          : `${s.role === "builder" ? "Building" : s.role === "geologist" ? "Surveying" : `Working at the ${work?.def.name.toLowerCase() ?? "workshop"}`}, ${STATE_TEXT[s.state] ?? s.state}.`
        : p.stage === "child"
          ? "Playing near home."
          : p.house >= 0
            ? "At home."
            : "Resting in the Hearthship.";
      body.push(h("p", { class: "lede" }, `${eco.ageDays(p)} days old · ${p.stage}${p.house >= 0 ? " · has a home" : ""}`));
      body.push(h("p", { class: "status" }, where));
      const skills = Object.entries(p.skills)
        .filter(([, v]) => v > 0.02)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      if (skills.length) {
        body.push(h("h3", { class: "sub" }, "Skills"));
        for (const [trade, v] of skills) {
          body.push(h("div", { class: "skill" }, h("span", {}, `${skillTitle(v)} ${tradeName(trade)}`), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(v * 100)}%` }))));
        }
      }
      if (p.journal.length) {
        body.push(h("h3", { class: "sub" }, "Journal"));
        body.push(h("ul", { class: "journal" }, ...p.journal.slice().reverse().map((j) => h("li", {}, j))));
      }
      const on = this.actions.following() === p.id;
      body.push(h("div", { class: "btn-row" }, h("button", { class: on ? "btn small on" : "btn small", onclick: () => this.actions.follow(on ? -1 : p.id) }, on ? "Stop following" : "Follow")));
    } else if (this.sel.kind === "building") {
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
        const waiting = eco.waitingFor(b);
        body.push(h("p", { class: waiting ? "status warn" : "status" }, waiting ?? (w ? `Worker ${STATE_TEXT[w.state] ?? w.state}.` : "Waiting for a worker. Is it connected to the Hearthship?")));
        if (b.def.job === "mine") {
          const land = eco.land;
          let left = 0;
          for (const t of [b.tile, ...land.ring(b.tile, b.def.radius ?? 2)]) if (land.deposit[t] && DEPOSIT_IDS[land.deposit[t] as number] === b.def.resource) left += land.depositAmount[t] as number;
          body.push(h("p", { class: "hint" }, `About ${left} loads left in reach. Food for ${b.food} more.`));
        }
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
      body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small", onclick: () => this.actions.geologist(f.tile) }, "Send geologist")));
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
    const glow = eco.glow[player] ?? 0;
    const idx = (id: string) => GOODS.findIndex((g) => g.id === id);
    const food = goodsFor("food").reduce((s, g) => s + (totals[g] ?? 0), 0);
    this.root.replaceChildren(
      ...["log", "stone", "plank"].map((id) => goodChip(idx(id), totals[idx(id)] ?? 0)),
      h("span", { class: "chip-good" }, h("i", { style: "background:#d98f4e" }), `Food ${food}`),
      ...["coal", "iron", "gold"].map((id) => goodChip(idx(id), totals[idx(id)] ?? 0)),
      h("span", { class: "chip-good pop", title: "Settlers resting / at work" }, `Settlers ${pop.idle} / ${pop.working}`),
      h("span", { class: `chip-good glow${glow < 40 ? " low" : ""}`, title: "Glow: how content your people are. Content towns work faster and grow." }, h("i", { style: `background:hsl(${30 + glow * 0.2},90%,${45 + glow * 0.2}%)` }), `Glow ${glow}`),
    );
  }
}
