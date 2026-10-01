import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import type { SurfaceFrames } from "./frames";
import { PainterlyMaterial } from "./painterly";
import type { Emitter } from "./smoke";

/** Ticks a falling star takes from the top of the sky to the ground. */
const FALL = 90;

/**
 * What adversity looks like: floodwater lying over the low ground by a river, falling stars
 * streaking down to their impact (with a burst of sparks), and rats scurrying round a store.
 */
export class AdversityView {
  readonly group = new THREE.Group();
  private readonly water: THREE.InstancedMesh;
  private readonly streaks: THREE.InstancedMesh;
  private readonly rats: THREE.InstancedMesh;
  private readonly emitters = new Map<string, Emitter>();

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
  ) {
    const plate = new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardNodeMaterial({ color: "#5a7f8a", transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0 });
    this.water = new THREE.InstancedMesh(plate, waterMat, 160);
    this.water.renderOrder = 5;
    const streakMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.4, 1.9, 1.2), transparent: true, opacity: 0.9, depthWrite: false });
    this.streaks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.32, 1, 6).translate(0, -0.5, 0), streakMat, 16);
    this.rats = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.05, 0.12, 2, 6).rotateX(Math.PI / 2), new PainterlyMaterial({ color: "#4a4440", brush: 0 }), 12);
    for (const m of [this.water, this.streaks, this.rats]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.name = "adversity";
  }

  update(time: number, tick: number): Emitter[] {
    const out: Emitter[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    let nw = 0;
    let ns = 0;
    let nr = 0;
    const R = this.frames.field.R;
    for (const e of this.eco.adversity.live()) {
      if (!e.started) continue;
      if (e.kind === "flood") {
        for (const t of e.tiles) {
          if (nw >= this.water.instanceMatrix.count) break;
          this.frames.pos(t, 0.12, p);
          this.frames.orient(p, null, q);
          m.compose(p, q, new THREE.Vector3(this.eco.land.spacing * R * 0.62, 1, this.eco.land.spacing * R * 0.62));
          this.water.setMatrixAt(nw++, m);
        }
      } else if (e.kind === "meteors") {
        for (let i = 0; i < e.tiles.length; i++) {
          const at = e.times[i]!;
          if (at < 0 || tick < at - FALL || ns >= this.streaks.instanceMatrix.count) continue;
          // From high in the sky, slanting in, to the ground.
          const ground = this.frames.pos(e.tiles[i]!, 0);
          const up = ground.clone().normalize();
          const side = new THREE.Vector3(0, 1, 0).cross(up).normalize();
          const start = ground.clone().addScaledVector(up, 45).addScaledVector(side, 30);
          const f = Math.min(1, (tick - (at - FALL)) / FALL);
          p.copy(start).lerp(ground, f);
          const dir = ground.clone().sub(start).normalize();
          q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
          m.compose(p, q, new THREE.Vector3(1.6, 12, 1.6));
          this.streaks.setMatrixAt(ns++, m);
          const key = `m${e.id}:${i}`;
          let em = this.emitters.get(key);
          if (!em) this.emitters.set(key, (em = { pos: p.clone(), rate: 40, kind: "spark" }));
          em.pos.copy(p);
          out.push(em);
        }
      } else if (e.kind === "pests") {
        const c = this.frames.pos(e.tile, 0.08);
        const up = c.clone().normalize();
        const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
        const north = up.clone().cross(east);
        for (let k = 0; k < 5 && nr < this.rats.instanceMatrix.count; k++) {
          const a = time * (1.6 + k * 0.3) + k * 1.3;
          const r = 1.4 + 0.3 * Math.sin(time * 2 + k);
          const at = c.clone().addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r);
          const ahead = c.clone().addScaledVector(east, Math.cos(a + 0.1) * r).addScaledVector(north, Math.sin(a + 0.1) * r);
          this.frames.orient(at, ahead, q);
          m.compose(at, q, new THREE.Vector3(1, 1, 1));
          this.rats.setMatrixAt(nr++, m);
        }
      }
    }
    for (const [mesh, n] of [
      [this.water, nw],
      [this.streaks, ns],
      [this.rats, nr],
    ] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.emitters.size > 64) this.emitters.clear();
    return out;
  }

  dispose(): void {
    for (const mesh of [this.water, this.streaks, this.rats]) mesh.geometry.dispose();
  }
}
