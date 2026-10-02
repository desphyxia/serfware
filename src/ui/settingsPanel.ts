import type { GraphicsSettings, PresetName, Settings, SettingsStore } from "../core/settings";
import { DIFFICULTY, type Difficulty } from "../sim/econ/adversity";
import { AI_LEVELS, type AiLevel } from "../sim/ai/personality";
import { HILLS, ORE_PRESETS, type MapOptions, type OreMix } from "../sim/econ/landuse";
import { SEAS } from "../sim/planet/reach";
import { languages, t, tr } from "../core/i18n";
import { PALETTES } from "../core/access";
import { ACTIONS, keyLabel, type Keymap } from "../core/keymap";
import { h, Panel } from "./dom";

type Opt<T> = readonly (readonly [T, string])[];

/** Settings dialog with graphics presets (Low / Medium / High), custom values, audio, interface and world seed. */
export class SettingsPanel extends Panel {
  private readonly controls: Array<(s: Settings) => void> = [];
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly seedInput: HTMLInputElement;
  private readonly rivalsInput: HTMLSelectElement;
  private readonly oreInput: HTMLSelectElement;
  private readonly hillsInput: HTMLSelectElement;
  private readonly seasInput: HTMLSelectElement;
  private readonly stakesInput: HTMLSelectElement;
  private readonly difficultyInput: HTMLSelectElement;
  private readonly levelInput: HTMLSelectElement;
  private noteDifficulty: () => void = () => {};
  private hint: HTMLElement = h("p");
  /** Switch to a tab by name. */
  showTab: (name: string) => void = () => {};

  constructor(
    private readonly store: SettingsStore,
    private readonly world: { seed: () => string; newWorld: (seed?: string, rivals?: number, stakes?: "wounded" | "mortal", difficulty?: Difficulty, level?: AiLevel, map?: MapOptions) => void; map: () => MapOptions | undefined; rivals: () => number; stakes: () => "wounded" | "mortal"; difficulty: () => Difficulty; level: () => AiLevel },
    private readonly keys: Keymap,
  ) {
    super("settings", "Settings", { width: 380 });
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const pages = h("div", { class: "tab-pages" });
    const addTab = (name: string, page: HTMLElement) => {
      const b = h("button", { class: "tab", role: "tab", onclick: () => select(name) }, t(name));
      b.dataset.name = name;
      page.dataset.tab = name;
      tabs.append(b);
      pages.append(page);
    };
    const select = (name: string) => {
      for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.dataset.name === name);
      for (const p of pages.children) (p as HTMLElement).hidden = (p as HTMLElement).dataset.tab !== name;
    };

    // Graphics
    const g = h("div", { class: "form" });
    const presetRow = h("div", { class: "seg", role: "group", "aria-label": "Graphics preset" });
    for (const p of ["low", "medium", "high", "deck", "handheld", "custom"] as const) {
      const b = h(
        "button",
        {
          class: "seg-b",
          onclick: () => {
            if (p !== "custom") store.applyPreset(p as PresetName);
          },
          disabled: p === "custom",
          title: p === "custom" ? t("Selected automatically when you change any value below") : undefined,
        },
        p === "deck" ? t("Steam Deck") : p === "handheld" ? t("Handheld") : t(p[0]!.toUpperCase() + p.slice(1)),
      );
      this.presetButtons.set(p, b);
      presetRow.append(b);
    }
    g.append(this.row(t("Preset"), presetRow));
    g.append(this.range(t("Resolution"), "g-res", 0.5, 1.5, 0.05, (s) => s.graphics.resolutionScale, (v) => ({ resolutionScale: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.select<GraphicsSettings["shadows"]>(t("Shadows"), "g-sh", [["off", t("Off")], ["sharp", t("Sharp")], ["soft", t("Soft")]], (s) => s.graphics.shadows, (v) => ({ shadows: v })));
    g.append(this.select<GraphicsSettings["shadowMapSize"]>(t("Shadow detail"), "g-shs", [[1024, "1024"], [2048, "2048"], [4096, "4096"]], (s) => s.graphics.shadowMapSize, (v) => ({ shadowMapSize: v })));
    g.append(this.select<GraphicsSettings["msaa"]>(t("Anti-aliasing"), "g-aa", [[0, t("Off")], [2, t("MSAA 2×")], [4, t("MSAA 4×")]], (s) => s.graphics.msaa, (v) => ({ msaa: v })));
    g.append(this.checkbox(t("Bloom"), "g-bloom", (s) => s.graphics.bloom, (v) => store.setGraphics({ bloom: v })));
    g.append(this.checkbox(t("Ambient occlusion"), "g-ao", (s) => s.graphics.ao, (v) => store.setGraphics({ ao: v })));
    g.append(this.checkbox(t("Depth of field (close-up)"), "g-dof", (s) => s.graphics.dof, (v) => store.setGraphics({ dof: v })));
    g.append(this.range(t("Vegetation"), "g-veg", 0.1, 1, 0.05, (s) => s.graphics.vegetation, (v) => ({ vegetation: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.range(t("Particles"), "g-par", 0.1, 1, 0.05, (s) => s.graphics.particles, (v) => ({ particles: v }), (v) => `${Math.round(v * 100)} %`));
    g.append(this.select<GraphicsSettings["terrainDetail"]>(t("Terrain detail"), "g-td", [["low", t("Low")], ["medium", t("Medium")], ["high", t("High")]], (s) => s.graphics.terrainDetail, (v) => ({ terrainDetail: v })));
    g.append(this.select<GraphicsSettings["atmosphere"]>(t("Atmosphere"), "g-atm", [["simple", t("Simple")], ["scattering", t("Scattering")]], (s) => s.graphics.atmosphere, (v) => ({ atmosphere: v })));
    g.append(this.select<GraphicsSettings["backend"]>(t("Graphics API (reload)"), "g-api", [["auto", t("WebGPU if available")], ["webgl", t("WebGL 2")]], (s) => s.graphics.backend, (v) => ({ backend: v })));
    g.append(this.select<GraphicsSettings["maxFps"]>(t("Frame limit"), "g-fps", [[30, "30"], [40, "40"], [60, "60"], [120, "120"], [0, t("Unlimited")]], (s) => s.graphics.maxFps, (v) => ({ maxFps: v })));
    addTab(tr("Graphics"), g);

    // Audio
    const a = h("div", { class: "form" });
    for (const [label, key] of [[t("Master"), "master"], [t("Music"), "music"], [t("Ambience"), "ambience"], [t("Effects"), "effects"]] as const) {
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
    addTab(tr("Audio"), a);

    // Interface
    const ui = h("div", { class: "form" });
    ui.append(this.uiRange(t("Interface scale"), "u-scale", 0.8, 1.4, 0.05));
    ui.append(this.checkbox(t("Invert zoom"), "u-inv", (s) => s.ui.invertZoom, (v) => store.setUi({ invertZoom: v })));
    ui.append(this.checkbox(t("Edge scrolling"), "u-edge", (s) => s.ui.edgeScroll, (v) => store.setUi({ edgeScroll: v })));
    ui.append(this.checkbox(t("FPS counter"), "u-fps", (s) => s.ui.showFps, (v) => store.setUi({ showFps: v })));
    ui.append(this.textRange(t("Text size"), "u-text", 0.85, 1.6, 0.05));
    ui.append(this.checkbox(t("Captions for sounds"), "u-cap", (s) => s.ui.captions, (v) => store.setUi({ captions: v })));
    ui.append(this.uiSelect(t("Colours"), "u-pal", Object.entries(PALETTES).map(([id, p]) => [id, t(p.name)] as const), (s) => s.ui.palette, (v) => store.setUi({ palette: v })));
    ui.append(this.uiSelect(t("Language"), "u-lang", languages().map((l) => [l.id, l.name] as const), (s) => s.ui.language, (v) => store.setUi({ language: v })));
    ui.append(h("p", { class: "hint" }, t("Colours and language apply after a reload. Goods also have a shape, so they never rely on colour alone.")), h("button", { class: "btn", onclick: () => location.reload() }, t("Reload now")));
    addTab(tr("Interface"), ui);

    // Controls: every key can be changed.
    const c = h("div", { class: "form" });
    const keyButtons = new Map<string, HTMLButtonElement>();
    const refreshKeys = () => {
      for (const [id, b] of keyButtons) b.textContent = keyLabel(this.keys.key(id));
    };
    let group = "";
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        c.append(h("h3", { class: "sub" }, t(group))); // Game, Camera, Tools, Panels
      }
      const b = h("button", { class: "btn keybtn", "aria-label": t(a.label) }) as HTMLButtonElement;
      b.addEventListener("click", () => {
        b.textContent = t("Press a key…");
        const take = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener("keydown", take, true);
          if (e.key === "Escape") return refreshKeys();
          const why = this.keys.set(a.id, e.key);
          if (why) this.hint.textContent = t(why);
          else this.hint.textContent = "";
          refreshKeys();
        };
        window.addEventListener("keydown", take, true);
      });
      keyButtons.set(a.id, b);
      c.append(this.row(t(a.label), b));
    }
    this.hint = h("p", { class: "hint", role: "status" });
    c.append(this.hint, h("button", { class: "btn", onclick: () => (this.keys.reset(), refreshKeys()) }, t("Reset all keys")), h("p", { class: "hint" }, t("Arrow keys always move the camera. Escape closes things and can't be changed. Toolbar labels show the new keys after a reload.")));
    refreshKeys();
    addTab(tr("Controls"), c);

    // World
    const w = h("div", { class: "form" });
    this.seedInput = h("input", { type: "text", id: "w-seed", spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
    w.append(this.row(t("Seed"), this.seedInput, null, "w-seed"));
    this.rivalsInput = h("select", { id: "w-rivals" }, ...[0, 1, 2, 3].map((n) => h("option", { value: String(n) }, n === 0 ? t("None") : String(n)))) as HTMLSelectElement;
    w.append(this.row(t("AI rivals"), this.rivalsInput, null, "w-rivals"));
    this.levelInput = h("select", { id: "w-level" }, ...(Object.keys(AI_LEVELS) as AiLevel[]).map((l) => h("option", { value: l }, AI_LEVELS[l].name))) as HTMLSelectElement;
    w.append(this.row(t("Rivals' skill"), this.levelInput, null, "w-level"), h("p", { class: "hint" }, t("Each rival has a temperament the seed decides: a Builder, a Trader or a Warden (see Diplomacy, J).")));
    this.stakesInput = h("select", { id: "w-stakes" }, h("option", { value: "wounded" }, t("Wounded (losers limp home)")), h("option", { value: "mortal" }, t("Mortal (losers fall)"))) as HTMLSelectElement;
    w.append(this.row(t("Battle stakes"), this.stakesInput, null, "w-stakes"));
    this.difficultyInput = h("select", { id: "w-difficulty" }, ...(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => h("option", { value: d }, DIFFICULTY[d].label))) as HTMLSelectElement;
    const diffNote = h("p", { class: "hint" });
    const noteFor = () => (diffNote.textContent = DIFFICULTY[this.difficultyInput.value as Difficulty].note);
    this.difficultyInput.addEventListener("change", noteFor);
    w.append(this.row(t("Adversity"), this.difficultyInput, null, "w-difficulty"), diffNote);
    // Map settings (as in Settlers 2's map generator): the ore mix, and how far the hills lie from a start.
    this.oreInput = h("select", { id: "w-ore" }, ...Object.entries(ORE_PRESETS).map(([id, p]) => h("option", { value: id }, p.name))) as HTMLSelectElement;
    this.hillsInput = h("select", { id: "w-hills" }, h("option", { value: "" }, t("As generated")), ...Object.entries(HILLS).map(([id, p]) => h("option", { value: id }, p.name))) as HTMLSelectElement;
    this.seasInput = h("select", { id: "w-seas" }, h("option", { value: "" }, t("As generated")), ...Object.entries(SEAS).map(([id, p]) => h("option", { value: id }, p.name))) as HTMLSelectElement;
    w.append(this.row(t("Ore mix"), this.oreInput, null, "w-ore"), this.row(t("Hills from the start"), this.hillsInput, null, "w-hills"), this.row(t("Seas"), this.seasInput, null, "w-seas"), h("p", { class: "hint" }, t("Ore, hills and seas apply to the next world you generate. Seas raise shoal islets so every island can be reached by ferry.")));
    const map = (): MapOptions | undefined => {
      const ore = this.oreInput.value;
      const hills = this.hillsInput.value as keyof typeof HILLS | "";
      const seas = this.seasInput.value as "close" | "mixed" | "";
      if (ore === "balanced" && !hills && !seas) return undefined;
      return { ...(ore !== "balanced" && { ore: { ...ORE_PRESETS[ore]!.mix } }), ...(hills && { hills }), ...(seas && { seas }) };
    };
    const rivals = () => Number(this.rivalsInput.value);
    const stakes = () => this.stakesInput.value as "wounded" | "mortal";
    const difficulty = () => this.difficultyInput.value as Difficulty;
    const level = () => this.levelInput.value as AiLevel;
    this.noteDifficulty = noteFor;
    w.append(
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => this.world.newWorld(this.seedInput.value, rivals(), stakes(), difficulty(), level(), map()) }, t("Generate this seed")),
        h("button", { class: "btn", onclick: () => this.world.newWorld(undefined, rivals(), stakes(), difficulty(), level(), map()) }, t("Random seed")),
      ),
      h("p", { class: "hint" }, t("The same seed always produces the same world. Include it in bug reports.")),
    );
    addTab(tr("World"), w);

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
    this.levelInput.value = this.world.level();
    const m = this.world.map();
    this.oreInput.value = Object.entries(ORE_PRESETS).find(([, p]) => m?.ore && (Object.keys(p.mix) as (keyof OreMix)[]).every((k) => p.mix[k] === m.ore?.[k]))?.[0] ?? "balanced";
    this.hillsInput.value = m?.hills ?? "";
    this.seasInput.value = m?.seas ?? "";
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

  private textRange(label: string, id: string, min: number, max: number, step: number): HTMLElement {
    const input = h("input", { type: "range", id, min, max, step }) as HTMLInputElement;
    const out = h("output", { for: id });
    input.addEventListener("change", () => this.store.setUi({ textScale: Number(input.value) }));
    input.addEventListener("input", () => (out.textContent = `${Math.round(Number(input.value) * 100)} %`));
    this.controls.push((s) => {
      input.value = String(s.ui.textScale);
      out.textContent = `${Math.round(s.ui.textScale * 100)} %`;
    });
    return this.row(label, input, out, id);
  }

  private uiSelect(label: string, id: string, options: readonly (readonly [string, string])[], get: (s: Settings) => string, set: (v: string) => void): HTMLElement {
    const sel = h("select", { id }) as HTMLSelectElement;
    for (const [v, text] of options) sel.append(h("option", { value: v }, text));
    sel.addEventListener("change", () => set(sel.value));
    this.controls.push((s) => (sel.value = get(s)));
    return this.row(label, sel, null, id);
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
