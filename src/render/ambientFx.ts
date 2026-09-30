import * as THREE from "three/webgpu";
import { PainterlyMaterial } from "./painterly";
import { SpriteBatch } from "./sprites";

const LEAVES = 260;
const MOTES = 80;

/** A small leaf: a pointed diamond, bent a little along its midrib. */
function leafGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const s = 0.07;
  const p = [0, 0, -s, s * 0.5, 0.012, 0, 0, 0, s * 0.9, 0, 0, -s, 0, 0, s * 0.9, -s * 0.5, 0.012, 0];
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Small ambient life in the air near the view: leaves tumbling from turning trees in autumn,
 * and motes of pollen and dust catching the low sun on warm, still afternoons.
 */
export class AmbientFx {
  readonly group = new THREE.Group();
  private readonly leaves: THREE.InstancedMesh;
  private readonly motes = new SpriteBatch(MOTES, { additive: true, renderOrder: 8, glow: 0.6 });
  /** Per leaf: x, y, z, fall left (0 = free), phase, spin, colour index. */
  private readonly leaf = new Float32Array(LEAVES * 8);
  private readonly moteLocal = new Float32Array(MOTES * 3);
  private seed = 5;
  private spawnAcc = 0;
  private readonly palette = ["#d9902e", "#c4562a", "#e6b640", "#9a4a22", "#d8c24a"].map((c) => new THREE.Color(c));

  constructor() {
    this.leaves = new THREE.InstancedMesh(leafGeometry(), new PainterlyMaterial({ vertexColors: false, side: THREE.DoubleSide, brush: 0 }), LEAVES);
    this.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LEAVES * 3).fill(1), 3);
    this.leaves.frustumCulled = false;
    this.leaves.count = 0;
    for (let i = 0; i < MOTES * 3; i++) this.moteLocal[i] = this.rand();
    this.group.add(this.leaves, this.motes.mesh);
    this.group.name = "ambient";
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * @param crowns leaf-dropping tree crowns (x, y, z, fall) from the nature view
   * @param warmth 0..1 how much the air shimmers with motes (season, hour and weather)
   * @param amount effect budget from the graphics preset
   */
  update(dt: number, time: number, focus: THREE.Vector3, span: number, crowns: Float32Array, wind: THREE.Vector3, warmth: number, sun: THREE.Color, amount: number): void {
    const on = amount > 0 && span < 45;
    this.group.visible = on;
    if (!on) return;
    this.updateLeaves(dt, time, focus, span, crowns, wind, amount);
    this.updateMotes(dt, time, focus, span, warmth * amount, sun);
  }

  private updateLeaves(dt: number, time: number, focus: THREE.Vector3, span: number, crowns: Float32Array, wind: THREE.Vector3, amount: number): void {
    const L = this.leaf;
    // Spawn from crowns near the focus, at a rate following how much they are dropping.
    const near: number[] = [];
    const r2 = (span * 0.9) ** 2;
    for (let i = 0; i < crowns.length; i += 4) {
      const dx = (crowns[i] as number) - focus.x;
      const dy = (crowns[i + 1] as number) - focus.y;
      const dz = (crowns[i + 2] as number) - focus.z;
      if (dx * dx + dy * dy + dz * dz < r2) near.push(i);
    }
    this.spawnAcc += dt * Math.min(40, near.length * 0.6) * amount;
    while (this.spawnAcc >= 1 && near.length) {
      this.spawnAcc -= 1;
      const c = near[Math.floor(this.rand() * near.length)] as number;
      if (this.rand() > (crowns[c + 3] as number)) continue;
      const slot = this.freeLeaf();
      if (slot < 0) break;
      const o = slot * 8;
      L[o] = (crowns[c] as number) + (this.rand() - 0.5) * 0.7;
      L[o + 1] = (crowns[c + 1] as number) + (this.rand() - 0.5) * 0.5;
      L[o + 2] = (crowns[c + 2] as number) + (this.rand() - 0.5) * 0.7;
      L[o + 3] = 1.2 + this.rand() * 0.6;
      L[o + 4] = this.rand() * 6.28;
      L[o + 5] = 2 + this.rand() * 4;
      L[o + 6] = Math.floor(this.rand() * this.palette.length);
    }
    if (!near.length) this.spawnAcc = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3();
    const p = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < LEAVES; i++) {
      const o = i * 8;
      if ((L[o + 3] as number) <= 0) continue;
      p.set(L[o] as number, L[o + 1] as number, L[o + 2] as number);
      up.copy(p).normalize();
      const ph = (L[o + 4] as number) + time * 2.2;
      // Fall slowly, swinging side to side like a pendulum, carried by the wind.
      const fall = 0.32 * dt;
      p.addScaledVector(up, -fall).addScaledVector(wind, dt * 1.4);
      p.x += Math.cos(ph) * dt * 0.35;
      p.z += Math.sin(ph * 0.7) * dt * 0.35;
      L[o] = p.x;
      L[o + 1] = p.y;
      L[o + 2] = p.z;
      L[o + 3] = (L[o + 3] as number) - fall;
      const spin = (L[o + 5] as number) * time;
      e.set(Math.sin(ph) * 0.9, spin, Math.cos(ph * 1.3) * 0.6);
      q.setFromEuler(e);
      m.compose(p, q, one);
      this.leaves.setMatrixAt(n, m);
      this.leaves.setColorAt(n, this.palette[L[o + 6] as number] as THREE.Color);
      n++;
    }
    this.leaves.count = n;
    this.leaves.instanceMatrix.needsUpdate = true;
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
  }

  private freeLeaf(): number {
    for (let k = 0; k < LEAVES; k++) {
      const i = Math.floor(this.rand() * LEAVES);
      if ((this.leaf[i * 8 + 3] as number) <= 0) return i;
    }
    return -1;
  }

  private updateMotes(dt: number, time: number, focus: THREE.Vector3, span: number, warmth: number, sun: THREE.Color): void {
    const count = Math.floor(MOTES * Math.min(1, warmth));
    if (count <= 0) {
      this.motes.flush(0);
      return;
    }
    const up = focus.clone().normalize();
    const a = new THREE.Vector3(0, 1, 0).cross(up);
    if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
    a.normalize();
    const b = up.clone().cross(a);
    const w = span * 0.6;
    const M = this.moteLocal;
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // Drift up slowly and wrap; wander in small loops.
      let y = (M[i * 3 + 1] as number) + dt * 0.02;
      if (y > 1) y -= 1;
      M[i * 3 + 1] = y;
      const t = time * 0.3 + i;
      p.copy(focus)
        .addScaledVector(a, ((M[i * 3] as number) * 2 - 1) * w + Math.sin(t) * 0.3)
        .addScaledVector(b, ((M[i * 3 + 2] as number) * 2 - 1) * w + Math.cos(t * 0.8) * 0.3)
        .addScaledVector(up, 0.3 + y * 2.2);
      this.motes.pos.set([p.x, p.y, p.z], i * 3);
      this.motes.color.set([sun.r * 1.4, sun.g * 1.25, sun.b * 0.8], i * 3);
      this.motes.size[i] = 0.02 + (i % 5) * 0.006;
      // Fade in and out along the climb, and twinkle as they turn in the light.
      this.motes.alpha[i] = Math.sin(y * Math.PI) * (0.35 + 0.35 * Math.sin(time * 3 + i * 1.7) ** 2);
    }
    this.motes.flush(count);
  }

  dispose(): void {
    this.leaves.geometry.dispose();
    (this.leaves.material as THREE.Material).dispose();
    this.leaves.dispose();
    this.motes.dispose();
  }
}
