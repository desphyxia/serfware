/**
 * Adaptive music, all procedural (WebAudio, no samples). A soft pad always plays the chords;
 * the town adds layers as it grows: plucked strings for the woodworkers, a flute for the farms,
 * bells for the forges, a low pulse for the water trades, a muffled drum for the mines. Glow
 * picks the mode (bright major when the people are happy, dorian when unsure, minor when low),
 * night thins it to pad and bells, and a festival quickens it with a tambourine and a fiddle.
 */

export type MusicLayer = "wood" | "farm" | "forge" | "water" | "mine";

export interface MusicState {
  /** 0..100. */
  glow: number;
  layers: ReadonlySet<MusicLayer>;
  daylight: number;
  festival: boolean;
}

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;
const PROGRESSIONS = { major: [0, 5, 3, 4], dorian: [0, 3, 6, 4], minor: [0, 5, 2, 6] } as const;
/** D as the home key (MIDI). */
const ROOT = 50;

/** Which buildings feed which layer. */
export const LAYER_OF: Record<string, MusicLayer> = {
  woodcutter: "wood",
  forester: "wood",
  sawmill: "wood",
  treehouse: "wood",
  farm: "farm",
  mill: "farm",
  bakery: "farm",
  orchard: "farm",
  apiary: "farm",
  pasture: "farm",
  smelter: "forge",
  toolsmith: "forge",
  goldsmith: "forge",
  weaponsmith: "forge",
  fisher: "water",
  shellfisher: "water",
  tidemill: "water",
  well: "water",
  coalmine: "mine",
  ironmine: "mine",
  goldmine: "mine",
  granitemine: "mine",
  quarry: "mine",
};

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Music {
  private next = 0;
  private step = 0;
  private melody = 4;
  private state: MusicState = { glow: 60, layers: new Set(), daylight: 1, festival: false };

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.next = ctx.currentTime + 0.5;
  }

  set(state: MusicState): void {
    this.state = state;
  }

  /** Schedule the notes of the next moments (call often; it looks ahead about half a second). */
  tick(): void {
    const ctx = this.ctx;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    const s = this.state;
    const eighth = 60 / (s.festival ? 96 : 76) / 2;
    while (this.next < ctx.currentTime + 0.6) {
      this.play(this.step, this.next, eighth);
      this.next += eighth;
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number, eighth: number): void {
    const s = this.state;
    const mode = s.glow >= 60 ? "major" : s.glow >= 40 ? "dorian" : "minor";
    const scale = MODES[mode];
    const bar = Math.floor(step / 8);
    const deg = PROGRESSIONS[mode][bar % 4]!;
    const note = (d: number, octave: number) => ROOT + 12 * octave + scale[((d % 7) + 7) % 7]! + 12 * Math.floor(d / 7);
    const chord = [note(deg, 0), note(deg + 2, 0), note(deg + 4, 0)];
    const night = s.daylight < 0.3;
    const beat = step % 8;
    // Pad: the chord, swelling at the start of each bar.
    if (beat === 0) for (const m of chord) this.pad(freq(m - 12), t, eighth * 8, night ? 0.025 : 0.035);
    if (night) {
      if (s.layers.has("forge") && beat === 0 && bar % 2 === 0) this.bell(freq(chord[2]! + 12), t, 0.03);
      return;
    }
    if (s.layers.has("wood") && beat % 1 === 0 && Math.random() < 0.8) this.pluck(freq(chord[beat % 3]! + 12 + (beat >= 4 ? 12 : 0)), t, 0.04);
    if (s.layers.has("farm") && beat % 2 === 0 && Math.random() < 0.75) {
      this.melody = Math.max(0, Math.min(11, this.melody + [-2, -1, 1, 2][Math.floor(Math.random() * 4)]!));
      const penta = [0, 1, 2, 4, 5];
      this.flute(freq(note(penta[this.melody % 5]! + 7 * Math.floor(this.melody / 5), 1)), t, eighth * 2, 0.03);
    }
    if (s.layers.has("forge") && (beat === 0 || beat === 4) && Math.random() < 0.6) this.bell(freq(chord[beat === 0 ? 0 : 2]! + 24), t, 0.025);
    if (s.layers.has("water") && beat % 4 === 0) this.bass(freq(chord[0]! - 24), t, eighth * 3.5, 0.05);
    if (s.layers.has("mine") && (beat === 2 || beat === 6)) this.drum(t, 0.12);
    if (s.festival) {
      this.tambourine(t, beat % 2 === 0 ? 0.05 : 0.025);
      if (beat % 2 === 0) this.fiddle(freq(note(deg + [0, 2, 4, 2][(beat / 2) % 4]!, 1)), t, eighth * 2, 0.025);
    }
  }

  private env(t: number, attack: number, hold: number, release: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.out);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, g: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private pad(f: number, t: number, dur: number, v: number): void {
    const g = this.env(t, dur * 0.35, dur * 0.3, dur * 0.6, v);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(g);
    this.osc("sine", f, t, dur * 1.3, lp);
    this.osc("triangle", f * 1.003, t, dur * 1.3, lp);
  }

  private pluck(f: number, t: number, v: number): void {
    const g = this.env(t, 0.005, 0, 0.5, v);
    this.osc("triangle", f, t, 0.55, g);
  }

  private flute(f: number, t: number, dur: number, v: number): void {
    const g = this.env(t, 0.08, dur * 0.6, 0.25, v);
    const o = this.osc("sine", f, t, dur + 0.3, g);
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 5;
    depth.gain.value = f * 0.006;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.35);
  }

  private bell(f: number, t: number, v: number): void {
    const g = this.env(t, 0.003, 0, 2.2, v);
    this.osc("sine", f, t, 2.3, g);
    this.osc("sine", f * 2.76, t, 1.0, this.env(t, 0.003, 0, 0.9, v * 0.4));
  }

  private bass(f: number, t: number, dur: number, v: number): void {
    const g = this.env(t, 0.03, dur * 0.5, dur * 0.5, v);
    this.osc("triangle", f, t, dur, g);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, decay: number, v: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    const g = this.env(t, 0.002, 0, decay, v);
    src.connect(filt).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.05);
  }

  private drum(t: number, v: number): void {
    this.noiseHit(t, "lowpass", 180, 0.25, v);
  }

  private tambourine(t: number, v: number): void {
    this.noiseHit(t, "highpass", 6000, 0.12, v);
  }

  private fiddle(f: number, t: number, dur: number, v: number): void {
    const g = this.env(t, 0.04, dur * 0.7, 0.15, v);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    lp.connect(g);
    this.osc("sawtooth", f, t, dur + 0.2, lp);
  }
}
