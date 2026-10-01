import type { GraphicsSettings, PresetName, Settings, SettingsStore } from "../core/settings";
import { DIFFICULTY, type Difficulty } from "../sim/econ/adversity";
import { h, Panel } from "./dom";

type Opt<T> = readonly (readonly [T, string])[];

/** Settings dialog with graphics presets (Low / Medium / High), custom values, audio, interface and world seed. */
export class SettingsPanel extends Panel {
  private readonly controls: Array<(s: Settings) => void> = [];
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly seedInput: HTMLInputElement;
  private readonly rivalsInput: HTMLSelectElement;
  private readonly stakesInput: HTMLSelectElement;
  private readonly difficultyInput: HTMLSelectElement;
  private noteDifficulty: () => void = () => {};
  /** Switch to a tab by name. */
  showTab: (name: string) => void = () => {};

  constructor(
    private readonly store: SettingsStore,
    private readonly world: { seed: () => string; newWorld: (seed?: string, rivals?: number, stakes?: "wounded" | "mortal", difficulty?: Difficulty) => void; rivals: () => number; stakes: () => "wounded" | "mortal"; difficulty: () => Difficulty },
  ) {
    super("settings", "Settings", { width: 380 });
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const pages = h("div", { class: "tab-pages" });
    const addTab = (name: string, page: HTMLElement) => {
      const b = h("button", { class: "tab", role: "tab", onclick: () => select(name) }, name);
      page.dataset.tab = name;
      tabs.append(b);
      pages.append(page);
    };
    const select = (name: string) => {
      for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.textContent === name);
      for (const p of pages.children) (p as HTMLElement).hidden = (p as HTMLElement).dataset.tab !== name;
    };

    // Graphics
    const g = h("div", { class: "form" });
    const presetRow = h("div", { class: "seg", role: "group", "aria-label": "Graphics preset" });
    for (const p of ["low", "medium", "high", "deck", "custom"] as const) {
      const b = h(
        "button",
        {
          class: "seg-b",
          onclick: () => {
            if (p !== "custom") store.applyPreset(p as PresetName);
          },
          disabled: p === "custom",
          title: p === "custom" ? "Selected automatically when you change any value below" : undefined,
        },
        p === "deck" ? "Steam Deck" : p[0]!.toUpperCase() + p.slice(1),
      );
      this.presetButtons.set(p, b);
      presetRow.append(b);
    }
    g.append(this.row("Preset", presetRow));
    g.append(this.range("Resolution", "g-res", 0.5, 1.5, 0.05, (s) => s.graphics.resolutionScale, (v) => ({ resolutionScale: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.select<GraphicsSettings["shadows"]>("Shadows", "g-sh", [["off", "Off"], ["sharp", "Sharp"], ["soft", "Soft"]], (s) => s.graphics.shadows, (v) => ({ shadows: v })));
    g.append(this.select<GraphicsSettings["shadowMapSize"]>("Shadow detail", "g-shs", [[1024, "1024"], [2048, "2048"], [4096, "4096"]], (s) => s.graphics.shadowMapSize, (v) => ({ shadowMapSize: v })));
    g.append(this.select<GraphicsSettings["msaa"]>("Anti-aliasing", "g-aa", [[0, "Off"], [2, "MSAA 2×"], [4, "MSAA 4×"]], (s) => s.graphics.msaa, (v) => ({ msaa: v })));
    g.append(this.checkbox("Bloom", "g-bloom", (s) => s.graphics.bloom, (v) => store.setGraphics({ bloom: v })));
    g.append(this.checkbox("Ambient occlusion", "g-ao", (s) => s.graphics.ao, (v) => store.setGraphics({ ao: v })));
    g.append(this.checkbox("Depth of field (close-up)", "g-dof", (s) => s.graphics.dof, (v) => store.setGraphics({ dof: v })));
    g.append(this.range("Vegetation", "g-veg", 0.1, 1, 0.05, (s) => s.graphics.vegetation, (v) => ({ vegetation: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.range("Particles", "g-par", 0.1, 1, 0.05, (s) => s.graphics.particles, (v) => ({ particles: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.select<GraphicsSettings["terrainDetail"]>("Terrain detail", "g-td", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], (s) => s.graphics.terrainDetail, (v) => ({ terrainDetail: v })));
    g.append(this.select<GraphicsSettings["atmosphere"]>("Atmosphere", "g-atm", [["simple", "Simple"], ["scattering", "Scattering"]], (s) => s.graphics.atmosphere, (v) => ({ atmosphere: v })));
    g.append(this.select<GraphicsSettings["backend"]>("Graphics API (reload)", "g-api", [["auto", "WebGPU if available"], ["webgl", "WebGL 2"]], (s) => s.graphics.backend, (v) => ({ backend: v })));
    g.append(this.select<GraphicsSettings["maxFps"]>("Frame limit", "g-fps", [[30, "30"], [40, "40"], [60, "60"], [120, "120"], [0, "Unlimited"]], (s) => s.graphics.maxFps, (v) => ({ maxFps: v })));
    addTab("Graphics", g);

    // Audio
    const a = h("div", { class: "form" });
    for (const [label, key] of [["Master", "master"], ["Music", "music"], ["Ambience", "ambience"], ["Effects", "effects"]] as const) {
      const id = `a-${key}`;
      const input = h("input", { type: "range", id, min: 0, max: 1, step: 0.05 }) as HTMLInputElement;
      const out = h("output", { for: id });
      input.addEventListener("input", () => store.setAudio({ [key]: Number(input.value) }));
      this.controls.push((s) => {
        input.value = String(s.audio[key]);
        out.textContent = `${Math.round(s.audio[key] * 100)} %`;
      });
      a.append(this.row(label, input, out, id));
    }
    addTab("Audio", a);

    // Interface
    const ui = h("div", { class: "form" });
    ui.append(this.uiRange("Interface scale", "u-scale", 0.8, 1.4, 0.05));
    ui.append(this.checkbox("Invert zoom", "u-inv", (s) => s.ui.invertZoom, (v) => store.setUi({ invertZoom: v })));
    ui.append(this.checkbox("Edge scrolling", "u-edge", (s) => s.ui.edgeScroll, (v) => store.setUi({ edgeScroll: v })));
    ui.append(this.checkbox("FPS counter", "u-fps", (s) => s.ui.showFps, (v) => store.setUi({ showFps: v })));
    addTab("Interface", ui);

    // World
    const w = h("div", { class: "form" });
    this.seedInput = h("input", { type: "text", id: "w-seed", spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
    w.append(this.row("Seed", this.seedInput, null, "w-seed"));
    this.rivalsInput = h("select", { id: "w-rivals" }, ...[0, 1, 2, 3].map((n) => h("option", { value: String(n) }, n === 0 ? "None" : String(n)))) as HTMLSelectElement;
    w.append(this.row("AI rivals", this.rivalsInput, null, "w-rivals"));
    this.stakesInput = h("select", { id: "w-stakes" }, h("option", { value: "wounded" }, "Wounded (losers limp home)"), h("option", { value: "mortal" }, "Mortal (losers fall)")) as HTMLSelectElement;
    w.append(this.row("Battle stakes", this.stakesInput, null, "w-stakes"));
    this.difficultyInput = h("select", { id: "w-difficulty" }, ...(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => h("option", { value: d }, DIFFICULTY[d].label))) as HTMLSelectElement;
    const diffNote = h("p", { class: "hint" });
    const noteFor = () => (diffNote.textContent = DIFFICULTY[this.difficultyInput.value as Difficulty].note);
    this.difficultyInput.addEventListener("change", noteFor);
    w.append(this.row("Adversity", this.difficultyInput, null, "w-difficulty"), diffNote);
    const rivals = () => Number(this.rivalsInput.value);
    const stakes = () => this.stakesInput.value as "wounded" | "mortal";
    const difficulty = () => this.difficultyInput.value as Difficulty;
    this.noteDifficulty = noteFor;
    w.append(
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => this.world.newWorld(this.seedInput.value, rivals(), stakes(), difficulty()) }, "Generate this seed"),
        h("button", { class: "btn", onclick: () => this.world.newWorld(undefined, rivals(), stakes(), difficulty()) }, "Random seed"),
      ),
      h("p", { class: "hint" }, "The same seed always produces the same world. Include it in bug reports."),
    );
    addTab("World", w);

    this.body.append(tabs, pages);
    select("Graphics");
    this.showTab = select;
    store.subscribe((s) => this.sync(s));
    this.sync(store.get());
  }

  protected override onShow(): void {
    this.seedInput.value = this.world.seed();
    this.rivalsInput.value = String(this.world.rivals());
    this.stakesInput.value = this.world.stakes();
    this.difficultyInput.value = this.world.difficulty();
    this.noteDifficulty();
    this.sync(this.store.get());
  }

  private sync(s: Settings): void {
    for (const [p, b] of this.presetButtons) b.classList.toggle("on", s.preset === p);
    for (const c of this.controls) c(s);
  }

  private row(label: string, control: HTMLElement, out?: HTMLElement | null, forId?: string): HTMLElement {
    return h("div", { class: "row" }, h("label", { for: forId }, label), control, out ?? h("span"));
  }

  private range(
    label: string,
    id: string,
    min: number,
    max: number,
    step: number,
    get: (s: Settings) => number,
    set: (v: number) => Partial<GraphicsSettings>,
    fmt: (v: number) => string,
  ): HTMLElement {
    const input = h("input", { type: "range", id, min, max, step }) as HTMLInputElement;
    const out = h("output", { for: id });
    input.addEventListener("input", () => this.store.setGraphics(set(Number(input.value))));
    this.controls.push((s) => {
      input.value = String(get(s));
      out.textContent = fmt(get(s));
    });
    return this.row(label, input, out, id);
  }

  private uiRange(label: string, id: string, min: number, max: number, step: number): HTMLElement {
    const input = h("input", { type: "range", id, min, max, step }) as HTMLInputElement;
    const out = h("output", { for: id });
    input.addEventListener("change", () => this.store.setUi({ uiScale: Number(input.value) }));
    input.addEventListener("input", () => (out.textContent = `${Math.round(Number(input.value) * 100)} %`));
    this.controls.push((s) => {
      input.value = String(s.ui.uiScale);
      out.textContent = `${Math.round(s.ui.uiScale * 100)} %`;
    });
    return this.row(label, input, out, id);
  }

  private select<T extends string | number>(
    label: string,
    id: string,
    options: Opt<T>,
    get: (s: Settings) => T,
    set: (v: T) => Partial<GraphicsSettings>,
  ): HTMLElement {
    const sel = h("select", { id }) as HTMLSelectElement;
    for (const [v, text] of options) sel.append(h("option", { value: String(v) }, text));
    sel.addEventListener("change", () => {
      const found = options.find(([v]) => String(v) === sel.value);
      if (found) this.store.setGraphics(set(found[0]));
    });
    this.controls.push((s) => (sel.value = String(get(s))));
    return this.row(label, sel, null, id);
  }

  private checkbox(label: string, id: string, get: (s: Settings) => boolean, set: (v: boolean) => void): HTMLElement {
    const input = h("input", { type: "checkbox", id, class: "switch" }) as HTMLInputElement;
    input.addEventListener("change", () => set(input.checked));
    this.controls.push((s) => (input.checked = get(s)));
    return this.row(label, input, null, id);
  }
}
