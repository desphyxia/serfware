/** Player settings, graphics presets, and persistence. */

export type PresetName = "low" | "medium" | "high" | "deck" | "handheld";
export type Preset = PresetName | "custom";

export interface GraphicsSettings {
  /** Multiplier on device pixel ratio, clamped to 2 total. */
  resolutionScale: number;
  shadows: "off" | "soft" | "sharp";
  shadowMapSize: 1024 | 2048 | 4096;
  msaa: 0 | 2 | 4;
  bloom: boolean;
  /** 0..1 density of trees, grass and flowers. */
  vegetation: number;
  /** 0..1 amount of smoke, dust, birds and other particles. */
  particles: number;
  /** 0 = unlimited. */
  maxFps: 0 | 30 | 40 | 60 | 120;
  terrainDetail: "low" | "medium" | "high";
  atmosphere: "simple" | "scattering";
  /** Screen-space ambient occlusion (GTAO). */
  ao: boolean;
  /** Tilt-shift depth of field in close-up views. */
  dof: boolean;
  /** Graphics API: WebGPU where available, or force WebGL2. Applies after a reload. */
  backend: "auto" | "webgl";
}

export interface AudioSettings {
  master: number;
  music: number;
  ambience: number;
  effects: number;
}

export interface InterfaceSettings {
  uiScale: number;
  /** Text size on top of the interface scale (1 = normal). */
  textScale: number;
  /** Interface language id ("en" or a registered language); applies after a reload. */
  language: string;
  /** Colours of goods and players: "default" or "safe" (colour-blind safe); applies after a reload. */
  palette: string;
  /** Captions for sounds (hammering, birdsong, rain...) at the foot of the screen. */
  captions: boolean;
  invertZoom: boolean;
  edgeScroll: boolean;
  showFps: boolean;
}

export interface Settings {
  version: 1;
  preset: Preset;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  ui: InterfaceSettings;
}

export const PRESETS: Record<PresetName, GraphicsSettings> = {
  low: {
    resolutionScale: 0.75,
    shadows: "off",
    shadowMapSize: 1024,
    msaa: 0,
    bloom: false,
    vegetation: 0.35,
    particles: 0.35,
    maxFps: 30,
    terrainDetail: "low",
    atmosphere: "simple",
    ao: false,
    dof: false,
    backend: "auto",
  },
  medium: {
    resolutionScale: 1,
    shadows: "soft",
    shadowMapSize: 2048,
    msaa: 2,
    bloom: true,
    vegetation: 0.65,
    particles: 0.65,
    maxFps: 60,
    terrainDetail: "medium",
    atmosphere: "scattering",
    ao: true,
    dof: false,
    backend: "auto",
  },
  /** Steam Deck: 1280×800 at 40 fps (the Deck's sweet spot for battery), lighter shadows and effects. */
  deck: {
    resolutionScale: 1,
    shadows: "soft",
    shadowMapSize: 1024,
    msaa: 0,
    bloom: true,
    vegetation: 0.5,
    particles: 0.5,
    maxFps: 40,
    terrainDetail: "low",
    atmosphere: "scattering",
    ao: false,
    dof: false,
    backend: "auto",
  },
  /**
   * Handhelds and weak laptops aiming at 30 fps: a lower render resolution (the interface stays
   * sharp), no shadows, bloom or occlusion, thin vegetation and the cheap atmosphere.
   */
  handheld: {
    resolutionScale: 0.7,
    shadows: "off",
    shadowMapSize: 1024,
    msaa: 0,
    bloom: false,
    vegetation: 0.35,
    particles: 0.3,
    maxFps: 30,
    terrainDetail: "low",
    atmosphere: "simple",
    ao: false,
    dof: false,
    backend: "auto",
  },
  high: {
    resolutionScale: 1,
    shadows: "soft",
    shadowMapSize: 4096,
    msaa: 4,
    bloom: true,
    vegetation: 1,
    particles: 1,
    maxFps: 0,
    terrainDetail: "high",
    atmosphere: "scattering",
    ao: true,
    dof: true,
    backend: "auto",
  },
};

export function defaultSettings(preset: PresetName = "medium"): Settings {
  return {
    version: 1,
    preset,
    graphics: { ...PRESETS[preset] },
    audio: { master: 0.8, music: 0.6, ambience: 0.8, effects: 0.8 },
    ui: { uiScale: 1, textScale: 1, language: "en", palette: "default", captions: false, invertZoom: false, edgeScroll: false, showFps: false },
  };
}

/** The preset whose values match exactly, or "custom". */
export function detectPreset(g: GraphicsSettings): Preset {
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const p = PRESETS[name];
    if ((Object.keys(p) as (keyof GraphicsSettings)[]).every((k) => p[k] === g[k])) return name;
  }
  return "custom";
}

/** Guess a sensible starting preset from the device. */
export function suggestPreset(hints: { cores?: number; memoryGB?: number; mobile?: boolean }): PresetName {
  if (hints.mobile) return "low";
  const cores = hints.cores ?? 4;
  const mem = hints.memoryGB ?? 8;
  if (cores >= 8 && mem >= 8) return "high";
  if (cores <= 2 || mem <= 2) return "low";
  return "medium";
}

/** Merge unknown stored data over defaults, dropping anything malformed. */
export function sanitize(raw: unknown, base: Settings): Settings {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Settings>;
  const out: Settings = structuredCloneSafe(base);
  const copy = <T extends object>(dst: T, src: unknown) => {
    if (!src || typeof src !== "object") return;
    for (const k of Object.keys(dst) as (keyof T)[]) {
      const v = (src as Record<string, unknown>)[k as string];
      if (v !== undefined && typeof v === typeof dst[k]) dst[k] = v as T[keyof T];
    }
  };
  copy(out.graphics, r.graphics);
  copy(out.audio, r.audio);
  copy(out.ui, r.ui);
  out.preset = detectPreset(out.graphics);
  return out;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type Listener = (s: Settings) => void;

const STORAGE_KEY = "seedfall.settings.v1";
/** Interface scale for the Steam Deck preset. */
export const DECK_UI_SCALE = 1.3;
/** Interface scale for the handheld preset. */
export const HANDHELD_UI_SCALE = 1.25;

export class SettingsStore {
  private s: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(initial: Settings) {
    this.s = initial;
  }

  static load(fallbackPreset: PresetName): SettingsStore {
    const base = defaultSettings(fallbackPreset);
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) return new SettingsStore(sanitize(JSON.parse(raw), base));
    } catch {
      // Storage can be unavailable (private mode, sandboxed frames). Defaults are fine.
    }
    return new SettingsStore(base);
  }

  get(): Settings {
    return this.s;
  }

  applyPreset(p: PresetName): void {
    // The Deck preset also enlarges the interface for its 7-inch screen.
    const ui = p === "deck" ? { ...this.s.ui, uiScale: DECK_UI_SCALE } : p === "handheld" ? { ...this.s.ui, uiScale: HANDHELD_UI_SCALE } : this.s.ui;
    this.s = { ...this.s, preset: p, graphics: { ...PRESETS[p] }, ui };
    this.commit();
  }

  setGraphics(patch: Partial<GraphicsSettings>): void {
    const graphics = { ...this.s.graphics, ...patch };
    this.s = { ...this.s, graphics, preset: detectPreset(graphics) };
    this.commit();
  }

  setAudio(patch: Partial<AudioSettings>): void {
    this.s = { ...this.s, audio: { ...this.s.audio, ...patch } };
    this.commit();
  }

  setUi(patch: Partial<InterfaceSettings>): void {
    this.s = { ...this.s, ui: { ...this.s.ui, ...patch } };
    this.commit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.s));
    } catch {
      // Ignore storage failures; settings still apply for this session.
    }
    for (const l of this.listeners) l(this.s);
  }
}
