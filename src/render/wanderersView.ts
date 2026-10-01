import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import { CARAVAN_STEP, CREATURE_STEP } from "../sim/econ/wanderers";
import { AnimalBatch, Pose } from "./animals";
import type { SurfaceFrames } from "./frames";
import { hamletGeometry, wagonGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";
import type { Emitter } from "./smoke";

/**
 * Folk and beasts beyond the borders: nomad wagons drawn by an ox, hamlets of three cottages
 * with smoke from the chimney (gone once they join a settlement), and the herds of native
 * creatures, big and slow, grazing the wild.
 */
export class WanderersView {
  readonly group = new THREE.Group();
  private readonly wagons: THREE.InstancedMesh;
  private readonly hamlets: THREE.InstancedMesh;
  private readonly oxen = new AnimalBatch("cow", 8);
  // Native beasts: the cattle shape with a mossy coat.
  private readonly beasts = new AnimalBatch("cow", 48, "#9fb07a");
  private readonly smoke = new Map<number, Emitter>();
  private hamletVersion = -1;

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
  ) {
    const mat = new PainterlyMaterial({ vertexColors: true, brush: 0.5 });
    this.wagons = new THREE.InstancedMesh(wagonGeometry(), mat, 8);
    this.hamlets = new THREE.InstancedMesh(hamletGeometry(), mat, 8);
    for (const m of [this.wagons, this.hamlets]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.group.add(this.wagons, this.hamlets, this.oxen.mesh, this.beasts.mesh);
    this.group.name = "wanderers";
  }

  /** Somewhere between a mover's last tile and its current one. */
  private along(prev: number, tile: number, movedAt: number, step: number, tick: number, out: THREE.Vector3, ahead: THREE.Vector3): void {
    const f = Math.max(0, Math.min(1, (tick - movedAt) / step));
    const a = this.frames.pos(prev);
    const b = this.frames.pos(tile);
    out.copy(a).lerp(b, f);
    if (prev === tile) ahead.copy(out).add(new THREE.Vector3(0.01, 0, 0));
    else ahead.copy(b).sub(a).add(out);
  }

  update(time: number, tick: number): Emitter[] {
    const w = this.eco.wanderers;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    if (w.version !== this.hamletVersion) {
      this.hamletVersion = w.version;
      let n = 0;
      this.smoke.clear();
      for (const h of w.hamlets) {
        if (h.joined >= 0 || n >= this.hamlets.instanceMatrix.count) continue;
        this.frames.pos(h.tile, 0, p);
        this.frames.orient(p, null, q);
        m.compose(p, q, new THREE.Vector3(1.4, 1.4, 1.4));
        this.hamlets.setMatrixAt(n++, m);
        // Chimney smoke (the chimney sits at about (-0.85, 1.0, -0.35) in the model, scaled).
        const up = p.clone().normalize();
        this.smoke.set(h.tile, { pos: p.clone().addScaledVector(up, 1.5).add(new THREE.Vector3(-1.2, 0, -0.5).applyQuaternion(q)), rate: 3, kind: "smoke" });
      }
      this.hamlets.count = n;
      this.hamlets.instanceMatrix.needsUpdate = true;
    }
    let nw = 0;
    for (const c of w.caravans) {
      if (c.done || nw >= this.wagons.instanceMatrix.count) continue;
      this.along(c.prev, c.tile, c.movedAt, CARAVAN_STEP, tick, p, ahead);
      this.frames.orient(p, ahead, q);
      m.compose(p, q, one.clone().multiplyScalar(1.3));
      this.wagons.setMatrixAt(nw, m);
      // The ox walks ahead, in the shafts.
      const fwd = ahead.clone().sub(p).normalize();
      const ox = p.clone().addScaledVector(fwd, 1.3);
      const moving = tick - c.movedAt < CARAVAN_STEP;
      this.oxen.set(nw, ox, q, moving ? Pose.Walk : Pose.Graze, c.id * 1.3, 1.1);
      nw++;
    }
    this.wagons.count = nw;
    this.wagons.instanceMatrix.needsUpdate = true;
    this.oxen.flush(nw, time);
    let nb = 0;
    for (const c of w.creatures) {
      if (!c.alive || nb >= this.beasts.capacity) continue;
      this.along(c.prev, c.tile, c.movedAt, CREATURE_STEP, tick, p, ahead);
      this.frames.orient(p, ahead, q);
      const moving = tick - c.movedAt < CREATURE_STEP && c.prev !== c.tile;
      this.beasts.set(nb++, p, q, moving ? Pose.Walk : (c.id + Math.floor(tick / 200)) % 3 ? Pose.Graze : Pose.Idle, c.id * 2.1, 1.55);
    }
    this.beasts.flush(nb, time);
    return [...this.smoke.values()];
  }

  dispose(): void {
    this.wagons.geometry.dispose();
    this.hamlets.geometry.dispose();
  }
}
