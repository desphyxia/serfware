import type { AudioSettings } from "../core/settings";

/**
 * Procedural soundscape built from WebAudio nodes, no samples:
 * wind (filtered noise), sea swell near coasts, birdsong by day, crickets at night, and
 * positional work sounds (axe chops, stone clinks, hammering, saw buzz).
 * Audio starts on the first user gesture, as browsers require.
 */

export interface AmbienceState {
  daylight: number;
  closeness: number;
  /** 0..1 share of water near the view. */
  water: number;
  /** Altitude factor: 1 high above the ground (more wind). */
  altitude: number;
  wind: number;
  /** 0..1 rain falling at the view (0 when it snows: snow is quiet). */
  rain?: number;
}

export interface WorkSound {
  kind: "chop" | "clink" | "hammer" | "saw";
  /** Distance from the camera ground point in world units. */
  distance: number;
  /** -1 left .. 1 right. */
  pan: number;
  /** Stable id so repeated sounds keep their rhythm. */
  id: number;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambienceBus!: GainNode;
  private effectsBus!: GainNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private seaGain!: GainNode;
  private noise!: AudioBuffer;
  private nextBird = 0;
  private nextCricket = 0;
  private readonly lastWork = new Map<number, number>();
  private readonly saws = new Map<number, { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode }>();
  private settings: AudioSettings;
  failed = false;

  constructor(settings: AudioSettings) {
    this.settings = settings;
    const start = () => {
      this.start();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  private start(): void {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      this.failed = true;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.ambienceBus = ctx.createGain();
    this.effectsBus = ctx.createGain();
    this.ambienceBus.connect(this.master);
    this.effectsBus.connect(this.master);
    this.applySettings(this.settings);

    // Two seconds of pink-ish noise, reused by every noise voice.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    const loop = (filterType: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.ambienceBus);
      src.start();
      return { f, g };
    };
    const wind = loop("bandpass", 420, 0.6);
    this.windFilter = wind.f;
    this.windGain = wind.g;
    const sea = loop("lowpass", 520, 0.4);
    this.seaGain = sea.g;
    // Rain: bright hiss on leaves and roofs.
    const rain = loop("highpass", 1800, 0.5);
    this.rainGain = rain.g;
  }

  applySettings(s: AudioSettings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.1);
    this.ambienceBus.gain.setTargetAtTime(s.ambience, t, 0.1);
    this.effectsBus.gain.setTargetAtTime(s.effects, t, 0.1);
  }

  update(state: AmbienceState, work: readonly WorkSound[]): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    this.windGain.gain.setTargetAtTime((0.08 + state.altitude * 0.25 + state.wind * 0.2) * gust, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(300 + gust * 500 + state.altitude * 300, t, 1.2);
    const swell = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 2);
    this.seaGain.gain.setTargetAtTime(state.water * state.closeness * 0.5 * swell, t, 0.5);
    this.rainGain.gain.setTargetAtTime((state.rain ?? 0) * (0.15 + 0.35 * state.closeness), t, 1.5);

    const near = state.closeness * (1 - state.altitude);
    if (t > this.nextBird) {
      this.nextBird = t + 0.8 + Math.random() * 3.5;
      if (state.daylight > 0.35 && near > 0.2 && Math.random() < 0.85) this.birdPhrase(near * state.daylight);
    }
    if (t > this.nextCricket) {
      this.nextCricket = t + 0.25 + Math.random() * 0.5;
      if (state.daylight < 0.3 && near > 0.2) this.cricket(near * (1 - state.daylight) * 0.6);
    }
    this.workSounds(work, t);
  }

  private birdPhrase(level: number): void {
    const ctx = this.ctx as AudioContext;
    const base = 2200 + Math.random() * 2200;
    const notes = 2 + Math.floor(Math.random() * 5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.ambienceBus);
    let at = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      const f0 = base * (0.85 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.4), at + 0.07);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05 * level, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.1);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + 0.12);
      at += 0.09 + Math.random() * 0.08;
    }
  }

  private cricket(level: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    o.type = "sine";
    o.frequency.value = 4200 + Math.random() * 600;
    const at = ctx.currentTime + 0.01;
    g.gain.setValueAtTime(0, at);
    for (let i = 0; i < 4; i++) {
      g.gain.linearRampToValueAtTime(0.018 * level, at + i * 0.05 + 0.01);
      g.gain.linearRampToValueAtTime(0, at + i * 0.05 + 0.035);
    }
    o.connect(g).connect(pan).connect(this.ambienceBus);
    o.start(at);
    o.stop(at + 0.25);
  }

  private hit(kind: WorkSound["kind"], level: number, pan: number): void {
    const ctx = this.ctx as AudioContext;
    const at = ctx.currentTime + 0.005;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.effectsBus);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    if (kind === "chop") {
      f.type = "lowpass";
      f.frequency.value = 1400;
      o.frequency.setValueAtTime(160, at);
      o.frequency.exponentialRampToValueAtTime(70, at + 0.12);
    } else if (kind === "clink") {
      f.type = "highpass";
      f.frequency.value = 2500;
      o.type = "triangle";
      o.frequency.value = 1800 + Math.random() * 400;
    } else {
      f.type = "bandpass";
      f.frequency.value = 900;
      o.type = "square";
      o.frequency.value = 420;
    }
    g.gain.setValueAtTime(0.25 * level, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.08);
    og.gain.setValueAtTime(0.18 * level, at);
    og.gain.exponentialRampToValueAtTime(0.0005, at + (kind === "clink" ? 0.35 : 0.14));
    n.connect(f).connect(g).connect(p);
    o.connect(og).connect(p);
    n.start(at, Math.random() * 1.5, 0.1);
    o.start(at);
    o.stop(at + 0.4);
  }

  private workSounds(work: readonly WorkSound[], t: number): void {
    const ctx = this.ctx as AudioContext;
    const active = new Set<number>();
    for (const w of work) {
      const level = Math.max(0, 1 - w.distance / 30);
      if (level <= 0) continue;
      if (w.kind === "saw") {
        active.add(w.id);
        let s = this.saws.get(w.id);
        if (!s) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = 150;
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = 1200;
          bp.Q.value = 2;
          const gain = ctx.createGain();
          gain.gain.value = 0;
          const pan = ctx.createStereoPanner();
          osc.connect(bp).connect(gain).connect(pan).connect(this.effectsBus);
          osc.start();
          s = { osc, gain, pan };
          this.saws.set(w.id, s);
        }
        s.gain.gain.setTargetAtTime(0.03 * level * (0.8 + 0.2 * Math.sin(t * 7)), t, 0.1);
        s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, w.pan)), t, 0.1);
        s.osc.frequency.setTargetAtTime(140 + 20 * Math.sin(t * 3 + w.id), t, 0.2);
        continue;
      }
      const period = w.kind === "chop" ? 0.9 : w.kind === "clink" ? 1.1 : 0.55;
      const last = this.lastWork.get(w.id) ?? t - Math.random() * period;
      if (t - last >= period) {
        this.lastWork.set(w.id, t);
        this.hit(w.kind, level, w.pan);
      } else if (!this.lastWork.has(w.id)) this.lastWork.set(w.id, last);
    }
    for (const [id, s] of this.saws) {
      if (active.has(id)) continue;
      s.gain.gain.setTargetAtTime(0, t, 0.2);
      s.osc.stop(t + 1);
      this.saws.delete(id);
    }
    if (this.lastWork.size > 200) this.lastWork.clear();
  }
}
