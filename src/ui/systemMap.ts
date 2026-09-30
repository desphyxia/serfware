import { GOODS } from "../sim/econ/defs";
import { ROOTED_BUILDINGS } from "../sim/econ/economy";
import { launchWindow, orbitAngle, type PlanetKind, type StarSystem, type SystemPlanet } from "../sim/system/system";
import { goodMass, HEARTHSHIP_FRAME, HEARTHSHIP_MASS, MIN_FOUNDERS, ORBIT_SPEED, PROBE_COST, SETTLER_MASS, SKYSHIP_CARGO, WINDOW_DAYS, type Voyage } from "../sim/system/voyages";
import type { World, WorldCommand } from "../sim/world";
import { h, Panel } from "./dom";

const SVG = "http://www.w3.org/2000/svg";

const KIND: Record<PlanetKind, { label: string; color: string }> = {
  temperate: { label: "Temperate", color: "#6fae6a" },
  arid: { label: "Arid", color: "#d8a45a" },
  frozen: { label: "Frozen", color: "#cfe3ef" },
  ocean: { label: "Ocean world", color: "#4f8fcf" },
  molten: { label: "Molten", color: "#e0643a" },
  gas: { label: "Gas giant", color: "#c9a27a" },
};

/** Goods offered when packing a Hearthship, with a sensible first load. */
const PACK: [string, number][] = [
  ["plank", 16],
  ["stone", 12],
  ["log", 4],
  ["bread", 10],
  ["fish", 4],
  ["iron", 0],
  ["axe", 2],
  ["saw", 1],
  ["pick", 1],
  ["hammer", 2],
  ["shovel", 1],
  ["scythe", 1],
  ["rod", 0],
];

/** Goods skyships commonly carry. */
const ROUTE_GOODS = ["bread", "fish", "plank", "stone", "iron", "coal", "log", "salt", "glass", "axe", "hammer", "pick", "skystone"];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

function costText(rec: Record<string, number>): string {
  return Object.entries(rec)
    .map(([k, n]) => `${n} ${GOODS.find((g) => g.id === k)?.name.toLowerCase() ?? k}`)
    .join(", ");
}

export interface SystemMapHost {
  /** The home world: it owns the system, the voyages and the colonies. */
  home: () => World;
  player: () => number;
  /** Planet index in view. */
  current: () => number;
  visit: (index: number) => void;
  command: (cmd: WorldCommand) => boolean;
  /** What a probe found on a planet: its regions and hazards (from the survey world). */
  charted: (index: number) => string[];
}

/**
 * The star system (O): the star, every planet on its orbit where it stands today, the habitable
 * zone, craft under way between them, and for the selected planet its facts, the next launch
 * window, and what can be done: send a probe, pack a Hearthship, visit, run skyship routes.
 */
export class SystemMap extends Panel {
  private readonly map: SVGSVGElement;
  private readonly facts: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly fleet: HTMLElement;
  private selected = -1;
  private actionsKey = "";
  private fleetKey = "";

  constructor(private readonly host: SystemMapHost) {
    super("system", "Star system", { width: 480, className: "system" });
    this.map = svg("svg", { viewBox: "-230 -230 460 460", role: "img", "aria-label": "Orbits of the star system" });
    this.facts = h("div", { class: "system-facts" });
    this.actions = h("div", { class: "system-actions" });
    this.fleet = h("div", { class: "system-fleet" });
    this.body.append(this.map, this.facts, this.actions, this.fleet);
  }

  private get system(): StarSystem {
    return this.host.home().system;
  }

  /** System day now (the orbital clock runs faster than the days on the ground). */
  private day(): number {
    const home = this.host.home();
    return home.voyages?.systemDay(home.tick) ?? 0;
  }

  protected override onShow(): void {
    this.selected = this.host.current();
    this.actionsKey = "";
    this.render();
  }

  /** Redraw (positions move with the days). */
  refresh(): void {
    if (this.visible) this.render();
  }

  select(index: number): void {
    this.selected = index;
    this.actionsKey = "";
    this.render();
  }

  private radius(sys: StarSystem, orbit: number): number {
    const inner = sys.planets[0]!.orbit;
    const outer = sys.planets[sys.planets.length - 1]!.orbit;
    // Log scale, so inner and outer planets both fit.
    return 52 + (160 * Math.log(orbit / inner)) / Math.max(0.001, Math.log(outer / inner));
  }

  private at(sys: StarSystem, p: SystemPlanet, day: number): [number, number] {
    const r = this.radius(sys, p.orbit);
    const a = orbitAngle(p, day);
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  private surveyed(p: SystemPlanet): boolean {
    return p.home || !!this.host.home().voyages?.isSurveyed(this.host.player(), p.index);
  }

  private colonyOn(p: SystemPlanet): boolean {
    return !p.home && this.host.home().economyAt(p.index)?.keeps[this.host.player()] !== undefined;
  }

  private render(): void {
    const sys = this.system;
    const day = this.day();
    const kids: SVGElement[] = [];
    // The habitable zone as a soft green band.
    const hz0 = this.radius(sys, Math.max(sys.planets[0]!.orbit, sys.habitable[0]));
    const hz1 = this.radius(sys, sys.habitable[1]);
    kids.push(svg("circle", { r: (hz0 + hz1) / 2, fill: "none", stroke: "#6fae6a", "stroke-opacity": 0.14, "stroke-width": Math.max(2, hz1 - hz0) }));
    kids.push(svg("circle", { r: 13, fill: sys.star.color, filter: "drop-shadow(0 0 8px " + sys.star.color + ")" }));
    for (const p of sys.planets) {
      const r = this.radius(sys, p.orbit);
      kids.push(svg("circle", { r, fill: "none", stroke: "currentColor", "stroke-opacity": 0.22, "stroke-dasharray": p.surface ? "" : "3 4" }));
    }
    // Craft under way: a dot on the line between the planets, a dashed trail behind it.
    const home = this.host.home();
    for (const v of home.voyages?.list ?? []) {
      if (v.owner !== this.host.player() || v.state !== "flying") continue;
      const f = home.voyages!.progress(v, home.tick);
      const [ax, ay] = this.at(sys, sys.planets[v.from]!, day);
      const [bx, by] = this.at(sys, sys.planets[v.to]!, day);
      const x = ax + (bx - ax) * f;
      const y = ay + (by - ay) * f;
      kids.push(svg("line", { x1: ax, y1: ay, x2: x, y2: y, stroke: "#f0d08a", "stroke-opacity": 0.5, "stroke-dasharray": "2 3" }));
      kids.push(svg("circle", { cx: x, cy: y, r: v.kind === "hearthship" ? 3.5 : 2.2, fill: v.kind === "probe" ? "#7fe0ff" : "#f0d08a" }));
    }
    for (const p of sys.planets) {
      const [x, y] = this.at(sys, p, day);
      const size = p.kind === "gas" ? 9 : p.size === "tiny" ? 4 : p.size === "small" ? 5 : 6.5;
      const known = this.surveyed(p);
      const g = svg("g", { class: "system-planet", tabindex: 0, role: "button", "aria-label": `${p.name}, ${KIND[p.kind].label}${known ? "" : ", not charted"}` });
      if (p.index === this.host.current()) g.append(svg("circle", { cx: x, cy: y, r: size + 6, fill: "none", stroke: "#f0d08a", "stroke-width": 1.5 }));
      if (p.index === this.selected) g.append(svg("circle", { cx: x, cy: y, r: size + 3, fill: "none", stroke: "currentColor", "stroke-width": 1 }));
      g.append(svg("circle", { cx: x, cy: y, r: size, fill: KIND[p.kind].color, "fill-opacity": known || !p.surface ? 1 : 0.55 }));
      const label = svg("text", { x: x + size + 5, y: y + 4, "font-size": 12, fill: "currentColor", stroke: "#10131c", "stroke-width": 3, "paint-order": "stroke" });
      label.textContent = p.home ? `${p.name} (home)` : this.colonyOn(p) ? `${p.name} (colony)` : known || !p.surface ? p.name : `${p.name} ?`;
      g.append(label);
      g.addEventListener("click", () => this.select(p.index));
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") this.select(p.index);
      });
      kids.push(g);
    }
    this.map.replaceChildren(...kids);
    this.renderFacts(sys, day);
    this.renderActions(sys);
    this.renderFleet(sys);
  }

  private renderFacts(sys: StarSystem, day: number): void {
    const p = sys.planets[this.selected] ?? sys.planets[sys.home]!;
    const homeP = sys.planets[sys.home]!;
    const known = this.surveyed(p);
    const rows: [string, string][] = [
      ["Star", `${sys.star.name} · class ${sys.star.type} · ${sys.star.luminosity.toFixed(2)} suns`],
      ["World", KIND[p.kind].label + (p.home ? " · home" : "")],
      ["Orbit", `${p.orbit.toFixed(2)} AU · year of ${days(Math.max(1, Math.round(p.period / ORBIT_SPEED)))}`],
      ["Moons", String(p.moons)],
    ];
    if (p.surface && known) {
      rows.push(["Gravity", `${p.gravity.toFixed(2)} g${p.gravity < 0.9 ? " · carriers go lighter" : p.gravity > 1.1 ? " · heavy going" : ""}`]);
      rows.push(["Day", p.locked ? "tidally locked (a fixed sun)" : `${p.dayLengthHours} h · tilt ${Math.round((p.axialTilt * 180) / Math.PI)}°`]);
      if (!p.home) rows.push(["Charted", this.host.charted(p.index).join(" · ") || "plain ground"]);
    } else if (p.surface) rows.push(["Charted", "not yet: send a probe"]);
    if (!p.home) {
      const w = launchWindow(homeP, p, day);
      const d = (x: number) => days(Math.max(1, Math.round(x / ORBIT_SPEED)));
      rows.push(["Window from home", w.daysUntil <= WINDOW_DAYS || w.daysUntil >= w.synodic - WINDOW_DAYS ? `open now · ${d(w.transferDays)} to arrive` : `in ${d(w.daysUntil - WINDOW_DAYS)} · ${d(w.transferDays)} to arrive`]);
    }
    const eco = this.host.home().economyAt(p.index);
    const me = this.host.player();
    if (eco && !p.home && eco.keeps[me] !== undefined) {
      const built = eco.buildings.filter((b) => b.alive && b.built && b.owner === me && !b.def.storage).length;
      const people = eco.people.filter((q) => q.alive && q.owner === me).length;
      const drift = eco.drift[me] ?? 0;
      rows.push(["Colony", `${people} people · ${eco.rooted[me] ? "rooted" : `taking root (${built}/${ROOTED_BUILDINGS} built)`}`]);
      rows.push(["Ways", drift < 0.2 ? "much as at home" : drift < 0.6 ? "drifting from home's" : "their own now"]);
    }
    this.facts.replaceChildren(h("h3", { class: "sub" }, p.name), h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
  }

  /** Where this player launches from: the planet in view if it has their rail, else home. */
  private launchFrom(): number {
    const home = this.host.home();
    const cur = this.host.current();
    return home.voyages?.railOf(this.host.player(), cur) ? cur : home.system.home;
  }

  private renderActions(sys: StarSystem): void {
    const p = sys.planets[this.selected] ?? sys.planets[sys.home]!;
    const home = this.host.home();
    const me = this.host.player();
    const from = this.launchFrom();
    const rail = !!home.voyages?.railOf(me, from);
    const known = this.surveyed(p);
    const colony = this.colonyOn(p);
    const orbiting = home.voyages?.list.find((v) => v.owner === me && v.kind === "hearthship" && v.to === p.index && v.state === "orbit");
    const bound = (kind: Voyage["kind"]) => !!home.voyages?.list.some((v) => v.owner === me && v.kind === kind && v.to === p.index && v.state !== "done");
    const key = [p.index, this.host.current(), known, colony, rail, !!orbiting, bound("probe"), bound("hearthship")].join();
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    const out: (HTMLElement | null)[] = [];
    const here = p.index === this.host.current();
    if (!p.surface) out.push(h("p", { class: "hint" }, "No ground to stand on: its moons are for later."));
    else if (here) out.push(h("p", { class: "hint" }, p.home ? "You are here." : colony ? "You are at your colony." : "You are surveying this world."));
    else if (p.home || colony || known) out.push(h("button", { class: "btn", onclick: () => this.host.visit(p.index) }, p.home ? "Return home" : colony ? `Visit the colony on ${p.name}` : orbiting ? `Go down to ${p.name} to choose a landing site` : `Survey ${p.name}`));
    if (!p.home && p.surface && !known) {
      if (bound("probe")) out.push(h("p", { class: "hint" }, "A probe is on its way."));
      else
        out.push(
          h("button", { class: "btn", disabled: !rail, onclick: () => this.host.command({ t: "probe", from, to: p.index }) && this.select(p.index) }, `Send a probe (${costText(PROBE_COST)})`),
          rail ? null : h("p", { class: "hint" }, `Probes leave from a launch rail: build one on ${sys.planets[from]!.name}.`),
        );
    }
    if (!p.home && p.surface && known && !colony && !bound("hearthship")) out.push(this.packForm(p, from, rail));
    else if (bound("hearthship") && !orbiting) out.push(h("p", { class: "hint" }, "A Hearthship is bound for this world."));
    if (colony || (p.home && home.colonies.some((c) => c?.economy.keeps[me] !== undefined))) out.push(this.routeForm(p));
    this.actions.replaceChildren(...out.filter((x): x is HTMLElement => !!x));
  }

  /** Pack a Hearthship: founders and goods within the mass it can lift. */
  private packForm(p: SystemPlanet, from: number, rail: boolean): HTMLElement {
    const settlers = h("input", { type: "number", min: MIN_FOUNDERS, max: 30, value: 10, "aria-label": "Founders" });
    const inputs = PACK.map(([id, n]) => {
      const i = h("input", { type: "number", min: 0, max: 60, value: n, "aria-label": GOODS.find((g) => g.id === id)?.name ?? id });
      return [id, i] as const;
    });
    const meter = h("div", { class: "mass" });
    const bar = h("div", { class: "mass-bar" });
    meter.append(bar, h("span", {}));
    const mass = () =>
      (Number(settlers.value) || 0) * SETTLER_MASS + inputs.reduce((s, [id, i]) => s + (Number(i.value) || 0) * goodMass(GOODS.findIndex((g) => g.id === id)), 0);
    const launch = h("button", { class: "btn primary", disabled: !rail }, `Launch the Hearthship to ${p.name}`);
    const update = () => {
      const m = mass();
      bar.style.width = `${Math.min(100, (m / HEARTHSHIP_MASS) * 100)}%`;
      meter.classList.toggle("over", m > HEARTHSHIP_MASS);
      (meter.lastChild as HTMLElement).textContent = `${Math.ceil(m)} / ${HEARTHSHIP_MASS} mass`;
      launch.disabled = !rail || m > HEARTHSHIP_MASS || (Number(settlers.value) || 0) < MIN_FOUNDERS;
    };
    for (const el of [settlers, ...inputs.map(([, i]) => i)]) el.addEventListener("input", update);
    launch.addEventListener("click", () => {
      const cargo: Record<string, number> = {};
      for (const [id, i] of inputs) if (Number(i.value) > 0) cargo[id] = Math.floor(Number(i.value));
      if (this.host.command({ t: "hearthship", from, to: p.index, settlers: Math.floor(Number(settlers.value)), cargo })) this.select(p.index);
    });
    update();
    return h(
      "div",
      { class: "pack" },
      h("h4", {}, "Pack a Hearthship"),
      h("p", { class: "hint" }, `It lifts ${HEARTHSHIP_MASS}: a settler weighs ${SETTLER_MASS}, a good 1 (skystone a quarter). The hull takes ${costText(HEARTHSHIP_FRAME)}. Carriers bring it all to the launch rail; it flies when the window opens.`),
      h("label", { class: "pack-row" }, h("span", {}, "Founders"), settlers),
      h("div", { class: "pack-grid" }, ...inputs.map(([id, i]) => h("label", { class: "pack-row" }, h("span", {}, GOODS.find((g) => g.id === id)?.name ?? id), i))),
      meter,
      rail ? null : h("p", { class: "hint" }, "Build a launch rail first."),
      launch,
    );
  }

  /** Skyship routes to the selected planet from any planet with a launch rail of yours. */
  private routeForm(p: SystemPlanet): HTMLElement {
    const home = this.host.home();
    const me = this.host.player();
    const sources = home.system.planets.filter((q) => q.index !== p.index && home.voyages?.railOf(me, q.index));
    if (!sources.length) return h("p", { class: "hint" }, `Skyships run from a launch rail: build one on another world to send goods to ${p.name}.`);
    const from = h("select", { "aria-label": "From" }, ...sources.map((q) => h("option", { value: q.index }, q.name)));
    const good = h("select", { "aria-label": "Good" }, ...ROUTE_GOODS.map((id) => h("option", { value: id }, GOODS.find((g) => g.id === id)?.name ?? id)));
    const amount = h("input", { type: "number", min: 1, max: SKYSHIP_CARGO, value: 8, "aria-label": "Amount per run" });
    const start = h("button", { class: "btn" }, "Start the route");
    start.addEventListener("click", () => {
      this.host.command({ t: "route", from: Number(from.value), to: p.index, good: good.value, amount: Number(amount.value) });
    });
    return h(
      "div",
      { class: "pack" },
      h("h4", {}, `Skyship route to ${p.name}`),
      h("p", { class: "hint" }, `A skyship loads at the rail and flies at every launch window, up to ${SKYSHIP_CARGO} goods a run.`),
      h("div", { class: "route-row" }, h("span", {}, "From"), from, good, amount, start),
    );
  }

  private renderFleet(sys: StarSystem): void {
    const home = this.host.home();
    const v = home.voyages;
    const me = this.host.player();
    if (!v) {
      this.fleet.replaceChildren();
      return;
    }
    const name = (i: number) => sys.planets[i]?.name ?? "?";
    const items: HTMLElement[] = [];
    for (const voy of v.list) {
      if (voy.owner !== me || voy.state === "done" || voy.route >= 0) continue;
      let state = "";
      if (voy.state === "loading") {
        const rail = home.economyAt(voy.from)?.buildings[voy.rail];
        const need = voy.load.reduce((s, n) => s + n, 0);
        const have = rail ? voy.load.reduce((s, n, g) => s + Math.min(n, rail.stock[g] as number), 0) : 0;
        state = `loading at the rail (${have}/${need})`;
      } else if (voy.state === "waiting") {
        const w = v.windowAt(voy.from, voy.to, home.tick);
        state = w.open ? "boarding" : `waiting for the window (${days(Math.max(1, Math.round(w.ticksUntil / (v.sysDayTicks * ORBIT_SPEED))))})`;
      } else if (voy.state === "flying") state = `under way · ${Math.round(v.progress(voy, home.tick) * 100)}%`;
      else if (voy.state === "orbit") state = "in orbit: go down and choose where to land";
      items.push(h("li", {}, h("strong", {}, voy.kind === "hearthship" ? "Hearthship" : voy.kind === "probe" ? "Probe" : "Skyship"), ` ${name(voy.from)} → ${name(voy.to)}: ${state}`));
    }
    for (const r of v.routes) {
      if (r.owner !== me || !r.active) continue;
      const stop = h("button", { class: "btn small", onclick: () => this.host.command({ t: "unroute", route: r.id }) }, "Stop");
      items.push(h("li", {}, h("strong", {}, "Route"), ` ${name(r.from)} → ${name(r.to)}: ${r.amount} ${GOODS[r.good]!.name.toLowerCase()} a run · ${r.runs} runs `, stop));
    }
    const key = items.map((i) => i.textContent).join("|");
    if (key === this.fleetKey) return;
    this.fleetKey = key;
    this.fleet.replaceChildren(...(items.length ? [h("h4", {}, "Voyages"), h("ul", { class: "voyages" }, ...items)] : []));
  }
}

export type { SystemPlanet };
