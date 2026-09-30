import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import type { Emitter } from "./smoke";
import { SpriteBatch } from "./sprites";

const FLAMES = 2400;
const PER_TILE = 18;

/**
 * Wildfire: tongues of flame licking up from burning tiles and buildings (glowing sprites that
 * rise, flicker and fade from yellow to red), with smoke and embers from the particle system.
 */
export class FireView {
  readonly flames = new SpriteBatch(FLAMES, { additive: true, renderOrder: 8, glow: 0.9 });
  /** Firelight on the ground and trees around the blaze nearest the view. */
  readonly light = new THREE.PointLight("#ff8a3a", 0, 14, 1.6);
  private readonly cache = new Map<string, Emitter>();

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
    private readonly mask: FogMask,
  ) {
    this.flames.mesh.name = "fire";
    // Always in the scene (at zero when nothing burns): adding a light later would recompile
    // every lit material mid-game.
    this.light.name = "firelight";
  }

  /** Draw the flames; returns smoke and ember emitters for the particle system. */
  update(time: number, focus: THREE.Vector3): Emitter[] {
    const eco = this.eco.ecology;
    const out: Emitter[] = [];
    const fb = this.flames;
    let n = 0;
    const p = new THREE.Vector3();
    const glow = new THREE.Vector3();
    let glowN = 0;
    const burn = (t: number, strength: number, key: string) => {
      if (hiddenAt(this.mask, t)) return;
      const base = this.frames.pos(t);
      if (base.distanceTo(focus) < 25) {
        glow.add(base);
        glowN++;
      }
      const up = base.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      for (let i = 0; i < PER_TILE && n < FLAMES; i++) {
        const h1 = SurfaceFrames.hash(t, i * 3 + 41);
        const h2 = SurfaceFrames.hash(t, i * 3 + 42);
        // Tongues: small flames rising fast from a few roots, narrowing and reddening as they
        // climb, so a burning tree reads as flickering columns rather than one glow.
        const f = (time * (1.6 + h2 * 1.2) + h1 * 7) % 1;
        const root = i % 5;
        const r = Math.sqrt(SurfaceFrames.hash(t, root + 61)) * 0.55;
        const a = SurfaceFrames.hash(t, root + 71) * Math.PI * 2;
        const sway = Math.sin(time * 9 + i * 1.3) * 0.05 * f;
        p.copy(base)
          .addScaledVector(tA, Math.cos(a) * r + sway)
          .addScaledVector(tB, Math.sin(a) * r + (h1 - 0.5) * 0.08)
          .addScaledVector(up, 0.05 + f * (0.5 + strength * 1.4));
        fb.pos.set([p.x, p.y, p.z], n * 3);
        fb.color.set([1.9 - f * 0.4, 0.75 - f * 0.55, 0.12 - f * 0.1], n * 3);
        fb.size[n] = (0.22 + strength * 0.24) * (1 - f * 0.75) * (0.85 + 0.3 * Math.sin(time * 17 + i * 2.1));
        fb.alpha[n] = Math.sin(Math.min(1, f * 1.4) * Math.PI) * 0.7;
        n++;
      }
      const top = base.clone().addScaledVector(up, 1.2 + strength);
      out.push(this.emitter(`s${key}`, "soot", 4 + strength * 4, top), this.emitter(`e${key}`, "ember", 4, base.clone().addScaledVector(up, 0.6)));
    };
    for (const t of eco.burning) burn(t, eco.fuel(t), `t${t}`);
    for (const b of this.eco.buildings) if (b.alive && b.burn > 0) burn(b.tile, 1, `b${b.id}`);
    fb.flush(n);
    // One flickering light at the heart of the nearby blaze.
    if (glowN) {
      this.light.position.copy(glow.divideScalar(glowN)).addScaledVector(glow.clone().normalize(), 1.5);
      this.light.intensity = Math.min(160, 30 + glowN * 8) * (0.85 + 0.15 * Math.sin(time * 11) * Math.sin(time * 7.3));
    } else this.light.intensity = 0;
    if (this.cache.size > out.length * 3 + 40) {
      const keep = new Set(out);
      for (const [k, e] of this.cache) if (!keep.has(e)) this.cache.delete(k);
    }
    return out;
  }

  private emitter(key: string, kind: Emitter["kind"], rate: number, pos: THREE.Vector3): Emitter {
    let e = this.cache.get(key);
    if (!e) {
      e = { pos: new THREE.Vector3(), rate, kind };
      this.cache.set(key, e);
    }
    e.rate = rate;
    e.pos.copy(pos);
    return e;
  }

  dispose(): void {
    this.flames.dispose();
  }
}
