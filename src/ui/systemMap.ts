import { launchWindow, orbitAngle, type PlanetKind, type StarSystem, type SystemPlanet } from "../sim/system/system";
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

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

/**
 * The star system (O): the star, every planet on its orbit where it stands today, the habitable
 * zone, and for the selected planet its facts and the next launch window from home. Surface
 * worlds can be visited (surveyed) from here.
 */
export class SystemMap extends Panel {
  private readonly map: SVGSVGElement;
  private readonly facts: HTMLElement;
  private selected = -1;

  constructor(
    private readonly system: () => StarSystem,
    private readonly day: () => number,
    private readonly current: () => number,
    private readonly onVisit: (index: number) => void,
  ) {
    super("system", "Star system", { width: 460, className: "system" });
    this.map = svg("svg", { viewBox: "-230 -230 460 460", role: "img", "aria-label": "Orbits of the star system" });
    this.facts = h("div", { class: "system-facts" });
    this.body.append(this.map, this.facts);
  }

  protected override onShow(): void {
    this.selected = this.current();
    this.render();
  }

  /** Redraw (positions move with the days). */
  refresh(): void {
    if (this.visible) this.render();
  }

  private radius(sys: StarSystem, orbit: number): number {
    const inner = sys.planets[0]!.orbit;
    const outer = sys.planets[sys.planets.length - 1]!.orbit;
    // Log scale, so inner and outer planets both fit.
    return 52 + (160 * Math.log(orbit / inner)) / Math.max(0.001, Math.log(outer / inner));
  }

  private render(): void {
    const sys = this.system();
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
    for (const p of sys.planets) {
      const r = this.radius(sys, p.orbit);
      const a = orbitAngle(p, day);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const size = p.kind === "gas" ? 9 : p.size === "tiny" ? 4 : p.size === "small" ? 5 : 6.5;
      const g = svg("g", { class: "system-planet", tabindex: 0, role: "button", "aria-label": `${p.name}, ${KIND[p.kind].label}` });
      if (p.index === this.current()) g.append(svg("circle", { cx: x, cy: y, r: size + 6, fill: "none", stroke: "#f0d08a", "stroke-width": 1.5 }));
      if (p.index === this.selected) g.append(svg("circle", { cx: x, cy: y, r: size + 3, fill: "none", stroke: "currentColor", "stroke-width": 1 }));
      g.append(svg("circle", { cx: x, cy: y, r: size, fill: KIND[p.kind].color }));
      const label = svg("text", { x: x + size + 5, y: y + 4, "font-size": 12, fill: "currentColor", stroke: "#10131c", "stroke-width": 3, "paint-order": "stroke" });
      label.textContent = p.home ? `${p.name} (home)` : p.name;
      g.append(label);
      g.addEventListener("click", () => {
        this.selected = p.index;
        this.render();
      });
      kids.push(g);
    }
    this.map.replaceChildren(...kids);
    this.renderFacts(sys, day);
  }

  private renderFacts(sys: StarSystem, day: number): void {
    const p = sys.planets[this.selected] ?? sys.planets[sys.home]!;
    const home = sys.planets[sys.home]!;
    const rows: [string, string][] = [
      ["Star", `${sys.star.name} · class ${sys.star.type} · ${sys.star.luminosity.toFixed(2)} suns`],
      ["World", KIND[p.kind].label + (p.home ? " · home" : "")],
      ["Orbit", `${p.orbit.toFixed(2)} AU · year of ${Math.round(p.period)} days`],
      ["Moons", String(p.moons)],
    ];
    if (p.surface) {
      rows.push(["Gravity", `${p.gravity.toFixed(2)} g${p.gravity < 0.9 ? " · carriers go lighter" : p.gravity > 1.1 ? " · heavy going" : ""}`]);
      rows.push(["Day", p.locked ? "tidally locked (a fixed sun)" : `${p.dayLengthHours} h · tilt ${Math.round((p.axialTilt * 180) / Math.PI)}°`]);
    }
    if (!p.home) {
      const w = launchWindow(home, p, day);
      rows.push(["Launch window", w.daysUntil < 0.5 ? `open now · ${Math.round(w.transferDays)} days to arrive` : `in ${Math.ceil(w.daysUntil)} days · ${Math.round(w.transferDays)} days to arrive`]);
    }
    const here = p.index === this.current();
    const action = !p.surface
      ? h("p", { class: "hint" }, "No ground to stand on: its moons are for later.")
      : here
        ? h("p", { class: "hint" }, p.home ? "You are here." : "You are surveying this world.")
        : h("button", { class: "btn", onclick: () => this.onVisit(p.index) }, p.home ? "Return home" : `Survey ${p.name}`);
    this.facts.replaceChildren(h("h3", { class: "sub" }, p.name), h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])), action);
  }
}

export type { SystemPlanet };
