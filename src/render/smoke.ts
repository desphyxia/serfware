import * as THREE from "three/webgpu";
import { SpriteBatch } from "./sprites";

export interface Emitter {
  pos: THREE.Vector3;
  /** Particles per second. */
  rate: number;
  kind: "smoke" | "steam" | "dust" | "spark" | "ember" | "soot";
}

const MAX = 700;

/**
 * Soft particle system for chimney smoke, sawmill steam and work dust. Particles rise along the
 * local up direction and drift with the wind; they grow and fade as they age.
 */
export class Particles {
  /** The drawable (kept as `points` for callers). */
  readonly points: THREE.Mesh;
  private readonly smoke = new SpriteBatch(MAX, { renderOrder: 7 });
  private readonly sparks = new SpriteBatch(160, { additive: true, renderOrder: 8, glow: 1.5 });
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(99);
  private readonly life = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly shade = new Float32Array(MAX);
  private readonly kind = new Uint8Array(MAX);
  private next = 0;
  private readonly acc = new Map<Emitter, number>();
  private seed = 7;

  constructor() {
    const g = new THREE.Group();
    g.add(this.smoke.mesh, this.sparks.mesh);
    this.points = g as unknown as THREE.Mesh;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, emitters: readonly Emitter[], wind: THREE.Vector3, light: THREE.Color, _pixelRatio: number, amount: number): void {
    for (const e of emitters) {
      let a = (this.acc.get(e) ?? this.rand()) + dt * e.rate * amount;
      while (a >= 1) {
        a -= 1;
        this.spawn(e);
      }
      this.acc.set(e, a);
    }
    if (this.acc.size > emitters.length * 2) this.acc.clear();
    const up = new THREE.Vector3();
    let n = 0;
    let ns = 0;
    const sm = this.smoke;
    const sp = this.sparks;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      up.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!).normalize();
      const k = this.kind[i]!;
      const rise = k === 2 ? 0.2 : k === 3 ? -0.4 : k === 4 ? 0.9 : 0.55;
      for (let j = 0; j < 3; j++) {
        this.pos[i * 3 + j]! += (this.vel[i * 3 + j]! + up.getComponent(j) * rise + wind.getComponent(j) * t * 0.8) * dt;
        this.vel[i * 3 + j]! *= 0.98;
      }
      const base = k === 0 ? 0.5 : k === 1 ? 0.35 : k >= 3 ? 1 : 0.45;
      // Embers flicker as they climb.
      if (k === 4) for (let j = 0; j < 3; j++) this.vel[i * 3 + j]! += (this.rand() - 0.5) * dt * 1.2;
      this.size[i] = k === 4 ? 0.14 * (1 - t * 0.6) : k === 3 ? 0.35 * (1 - t) : (k === 2 ? 0.6 : 0.5) + t * (k === 2 ? 1.4 : 2.2);
      this.alpha[i] = base * Math.sin(Math.min(1, t) * Math.PI) * (1 - t * 0.4);
      if (k >= 3) {
        if (ns >= sp.capacity) continue;
        sp.pos.set([this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!], ns * 3);
        if (k === 4) sp.color.set([1.8, 0.75 + (1 - t) * 0.35, 0.25], ns * 3);
        else sp.color.set([1.6, 1.0, 0.45], ns * 3);
        sp.size[ns] = this.size[i]! * 0.5;
        sp.alpha[ns] = this.alpha[i]!;
        ns++;
      } else {
        sm.pos.set([this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!], n * 3);
        const s = this.shade[i]!;
        sm.color.set([s * light.r, s * light.g, s * light.b], n * 3);
        // Old point sizes were in pixels at a reference distance; about a tenth of a unit each.
        sm.size[n] = this.size[i]! * 0.55;
        sm.alpha[n] = this.alpha[i]!;
        n++;
      }
    }
    sm.flush(n);
    sp.flush(ns);
  }

  private spawn(e: Emitter): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const j = () => (this.rand() - 0.5) * 0.12;
    this.pos[i * 3] = e.pos.x + j();
    this.pos[i * 3 + 1] = e.pos.y + j();
    this.pos[i * 3 + 2] = e.pos.z + j();
    const burst = e.kind === "spark" ? 12 : e.kind === "ember" ? 2 : 1;
    this.vel[i * 3] = j() * burst;
    this.vel[i * 3 + 1] = j() * burst;
    this.vel[i * 3 + 2] = j() * burst;
    this.age[i] = 0;
    this.kind[i] = e.kind === "smoke" || e.kind === "soot" ? 0 : e.kind === "steam" ? 1 : e.kind === "dust" ? 2 : e.kind === "spark" ? 3 : 4;
    this.life[i] = e.kind === "dust" ? 1.2 : e.kind === "spark" ? 0.45 : e.kind === "ember" ? 1.1 + this.rand() * 0.8 : 3.5 + this.rand() * 2;
    this.shade[i] = e.kind === "soot" ? 0.22 + this.rand() * 0.1 : e.kind === "smoke" ? 0.6 + this.rand() * 0.15 : e.kind === "steam" ? 0.95 : e.kind === "spark" ? 2.4 : 0.75;
  }

  dispose(): void {
    this.smoke.dispose();
    this.sparks.dispose();
  }
}

