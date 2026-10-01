import { BUILDINGS, GOODS, TOOLS } from "../sim/econ/defs";
import type { Command, Economy } from "../sim/econ/economy";
import { GOOD_COLORS } from "../render/econView";
import { fullName, title, tradeName, type GlowParts } from "../sim/econ/people";
import { h, Panel } from "./dom";

const GLOW_LABELS: Record<keyof GlowParts, [string, string]> = {
  nourishment: ["Nourishment", "Food in storage for the days ahead."],
  shelter: ["Shelter", "Beds in houses and the Hearthship for everyone."],
  belonging: ["Belonging", "People living in homes of their own."],
  beauty: ["Beauty", "Trees and memorial groves near the Hearthship, and decorations."],
  rest: ["Rest", "Not everyone working at once."],
  variety: ["Variety", "Kinds of food in store: bread, fish, meat, fruit, honey…"],
  joy: ["Joy", "Festivals at the maypole, when the world's calendar brings them round."],
  wonder: ["Wonder", "Pages in the Almanac and relics from the ruins."],
};

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Materials", ids: ["log", "stone", "plank"] },
  { title: "Food", ids: ["grain", "flour", "bread", "fish", "livestock", "meat"] },
  { title: "Mining and metal", ids: ["coal", "ironore", "iron", "goldore", "gold"] },
];

const KEY_TITLES: Record<string, string> = {
  food: "Food to the mines",
  fuel: "Fuel (coal, peat)",
  grain: "Grain",
  plank: "Planks",
  iron: "Iron",
};

function targetName(id: string): string {
  if (id === "site") return "Construction sites";
  return BUILDINGS.find((b) => b.id === id)?.name ?? id;
}

/**
 * Economy overview (P): stock of every good, distribution weights for scarce goods, and tool
 * priorities for the toolsmith. Changes are sent as commands, so they stay in sync in multiplayer.
 */
export class EconomyPanel extends Panel {
  private readonly pages: Record<string, HTMLElement> = {};
  private active = "Stock";

  constructor(
    private readonly eco: () => Economy,
    private readonly player: () => number,
    private readonly command: (cmd: Command) => void,
    private readonly onPerson: (id: number) => void = () => {},
  ) {
    super("economy", "Economy", { width: 380, className: "economy" });
    const tabs = h("div", { class: "tabs", role: "tablist" });
    for (const name of ["Stock", "People", "Distribution", "Tools"]) {
      const page = h("div", { class: "form" });
      this.pages[name] = page;
      tabs.append(
        h(
          "button",
          {
            class: "tab",
            role: "tab",
            onclick: () => {
              this.active = name;
              this.render(true);
            },
          },
          name,
        ),
      );
    }
    this.body.append(tabs, ...Object.values(this.pages));
  }

  /** Open on a given tab. */
  openTab(name: string): void {
    this.active = name;
    this.show();
    this.render(true);
  }

  protected override onShow(): void {
    this.render(true);
  }

  refresh(): void {
    if (this.visible) this.render(false);
  }

  private render(full: boolean): void {
    const tabs = this.body.querySelectorAll(".tab");
    tabs.forEach((t) => t.classList.toggle("on", t.textContent === this.active));
    for (const [name, page] of Object.entries(this.pages)) page.hidden = name !== this.active;
    const eco = this.eco();
    const pl = this.player();
    const totals = eco.storageTotals(pl);
    if (this.active === "Stock") {
      const idx = (id: string) => GOODS.findIndex((g) => g.id === id);
      const pop = eco.population(pl);
      (this.pages.Stock as HTMLElement).replaceChildren(
        ...GROUPS.flatMap((g) => [
          h("h3", { class: "sub" }, g.title),
          h(
            "div",
            { class: "stock-grid" },
            ...g.ids.map((id) =>
              h("div", { class: "stock-cell" }, h("i", { style: `background:${GOOD_COLORS[id] ?? "#ccc"}` }), h("span", {}, GOODS[idx(id)]?.name ?? id), h("b", {}, String(totals[idx(id)] ?? 0))),
            ),
          ),
        ]),
        h("h3", { class: "sub" }, "Tools"),
        h(
          "div",
          { class: "stock-grid" },
          ...TOOLS.map((t) => h("div", { class: "stock-cell" }, h("i", { style: "background:#9aa1b3" }), h("span", {}, GOODS[t]?.name ?? "?"), h("b", {}, String(totals[t] ?? 0)))),
        ),
        h("p", { class: "hint" }, `${pop.idle} settlers resting, ${pop.working} at work.`),
      );
      return;
    }
    if (this.active === "People") {
      const all = eco.peopleOf(pl);
      const count = (stage: string) => all.filter((p) => p.stage === stage).length;
      const housed = all.filter((p) => p.house >= 0).length;
      const parts = eco.glowParts[pl];
      const glow = eco.glow[pl] ?? 0;
      const masters = all
        .flatMap((p) => Object.entries(p.skills).map(([trade, v]) => ({ p, trade, v })))
        .filter((x) => x.v >= 0.45)
        .sort((a, b) => b.v - a.v)
        .slice(0, 8);
      (this.pages.People as HTMLElement).replaceChildren(
        h("div", { class: "glow-head" }, h("b", {}, String(glow)), h("span", {}, glow >= 70 ? "Your people are glowing." : glow >= 45 ? "Your people are content." : "Your people are unhappy. Work slows and no children are born.")),
        ...(parts
          ? (Object.keys(GLOW_LABELS) as (keyof GlowParts)[]).map((k) =>
              h("div", { class: "skill", title: GLOW_LABELS[k][1] }, h("span", {}, GLOW_LABELS[k][0]), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(Math.max(0, Math.min(1, parts[k])) * 100)}%` }))),
            )
          : []),
        h("h3", { class: "sub" }, "Population"),
        h("p", { class: "hint" }, `${all.length} people: ${count("adult")} adults, ${count("child")} children, ${count("elder")} elders. ${housed} live in houses.`),
        h("h3", { class: "sub" }, "Skilled hands"),
        masters.length
          ? h(
              "ul",
              { class: "journal people" },
              ...masters.map((m) =>
                h("li", {}, h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), this.onPerson(m.p.id)) }, fullName(m.p)), ` · ${title(m.v)} ${tradeName(m.trade)}`),
              ),
            )
          : h("p", { class: "hint" }, "Nobody has mastered a trade yet. Skill grows with every job done, faster with elders around to teach."),
      );
      return;
    }
    const prefs = eco.prefs[pl];
    if (!prefs) return;
    if (!full) {
      for (const input of this.body.querySelectorAll<HTMLInputElement>("input[data-g]")) {
        if (document.activeElement !== input) input.value = String(prefs.garrison[input.dataset.g as "frontier" | "inland"]);
      }
      // Only update numbers of sliders not being dragged.
      for (const input of this.body.querySelectorAll<HTMLInputElement>("input[type=range]")) {
        if (document.activeElement === input) continue;
        const [kind, key, target] = (input.dataset.k ?? "").split("|");
        const v = kind === "d" ? prefs.dist[key ?? ""]?.[target ?? ""] : prefs.tools[key ?? ""];
        if (v !== undefined) input.value = String(v);
      }
      if (this.active === "Tools") for (const out of this.body.querySelectorAll<HTMLElement>("[data-tool-count]")) out.textContent = String(totals[Number(out.dataset.toolCount)] ?? 0);
      return;
    }
    const slider = (label: string, k: string, value: number, onChange: (v: number) => void, extra?: HTMLElement) => {
      const id = `eco-${k.replace(/\W/g, "-")}`;
      const input = h("input", { type: "range", id, min: 0, max: 1, step: 0.05, "data-k": k }) as HTMLInputElement;
      input.value = String(value);
      input.addEventListener("change", () => onChange(Number(input.value)));
      return h("div", { class: "row" }, h("label", { for: id }, label), input, extra ?? h("span"));
    };
    if (this.active === "Distribution") {
      (this.pages.Distribution as HTMLElement).replaceChildren(
        h("p", { class: "hint" }, "When a good is scarce, buildings with a higher weight get it first. Zero means none."),
        ...Object.entries(prefs.dist).flatMap(([key, table]) => [
          h("h3", { class: "sub" }, KEY_TITLES[key] ?? key),
          ...Object.entries(table).map(([target, v]) => slider(targetName(target), `d|${key}|${target}`, v, (value) => this.command({ t: "prio", key, target, value }))),
        ]),
      );
    } else {
      const garrison = (zone: "frontier" | "inland", label: string) => {
        const row = slider(label, `g|${zone}`, prefs.garrison[zone], (value) => this.command({ t: "garrison", zone, value }));
        row.querySelector("input")?.setAttribute("data-g", zone);
        return row;
      };
      (this.pages.Tools as HTMLElement).replaceChildren(
        h("h3", { class: "sub" }, "Wardens"),
        h("p", { class: "hint" }, "How full to keep lantern buildings. Frontier lanterns stand near another settlement's border. Every lit lantern keeps at least one warden."),
        garrison("frontier", "Frontier"),
        garrison("inland", "Inland"),
        h("h3", { class: "sub" }, "Toolsmith"),
        h("p", { class: "hint" }, "The toolsmith makes whichever tool has the highest priority for how many you already have. A tool decides who can take up a trade."),
        ...TOOLS.map((t) => {
          const id = GOODS[t]?.id ?? "";
          return slider(GOODS[t]?.name ?? id, `t|${id}`, prefs.tools[id] ?? 0, (value) => this.command({ t: "toolprio", tool: id, value }), h("output", { "data-tool-count": String(t) }, String(totals[t] ?? 0)));
        }),
      );
    }
  }
}
