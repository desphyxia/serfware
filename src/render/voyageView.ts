import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import type { Voyage, Voyages } from "../sim/system/voyages";
import type { SurfaceFrames } from "./frames";
import { hearthshipCraftGeometry, probeGeometry, skyshipGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";

/** Ticks a craft takes to climb out of sight after launch, or to come down before it lands. */
const ASCENT = 500;
const DESCENT = 500;
const HIGH = 70;

/**
 * Craft of the voyages over this planet: loaded ships waiting on their launch rails, launches
 * climbing away along the ramp, skyships coming down to their keep, and a Hearthship circling
 * in orbit while its landing site is chosen.
 */
export class VoyageView {
  readonly group = new THREE.Group();
  private readonly mat = new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 0.6 });
  private readonly meshes: Record<Voyage["kind"], THREE.InstancedMesh>;
  private voyages: Voyages | null = null;
  private planet = -1;
  private tick: () => number = () => 0;
  /** Smoothed positions per voyage (ticks come ten times a second; frames come faster). */
  private readonly shown = new Map<number, THREE.Vector3>();

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
  ) {
    const make = (g: THREE.BufferGeometry, n: number) => {
      const m = new THREE.InstancedMesh(g, this.mat, n);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.meshes = { skyship: make(skyshipGeometry(), 24), hearthship: make(hearthshipCraftGeometry(), 4), probe: make(probeGeometry(), 8) };
    this.group.name = "voyages";
  }

  /** Which voyages to show: those touching `planet`, timed by the home world's clock. */
  bind(voyages: Voyages | null, planet: number, tick: () => number): void {
    this.voyages = voyages;
    this.planet = planet;
    this.tick = tick;
  }

  /** The launch rail's cradle and the way its ramp climbs (away from its flag). */
  private ramp(eco: Economy | null, v: Voyage): { at: THREE.Vector3; away: THREE.Vector3; up: THREE.Vector3 } | null {
    const b = eco?.buildings[v.rail];
    if (!eco || !b || !b.alive) return null;
    const at = this.frames.pos(b.tile, 0.9);
    const up = at.clone().normalize();
    const flag = this.frames.pos(eco.flags[b.flag]!.tile, 0.9);
    const away = at.clone().sub(flag);
    away.addScaledVector(up, -away.dot(up)).normalize();
    return { at, away, up };
  }

  update(time: number, dt: number, focus: THREE.Vector3): void {
    const n: Record<Voyage["kind"], number> = { skyship: 0, hearthship: 0, probe: 0 };
    const v = this.voyages;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const seen = new Set<number>();
    if (v) {
      const tick = this.tick();
      const put = (voy: Voyage, p: THREE.Vector3, ahead: THREE.Vector3, scale = 1) => {
        const mesh = this.meshes[voy.kind];
        if (n[voy.kind] >= mesh.instanceMatrix.count) return;
        let s = this.shown.get(voy.id);
        if (!s || s.distanceTo(p) > 20) this.shown.set(voy.id, (s = p.clone()));
        s.lerp(p, Math.min(1, dt * 6));
        seen.add(voy.id);
        this.frames.orient(s, ahead.clone().add(s).sub(p), q);
        m.compose(s, q, one.clone().multiplyScalar(scale));
        mesh.setMatrixAt(n[voy.kind]++, m);
      };
      for (const voy of v.list) {
        if (voy.from === this.planet && (voy.state === "waiting" || (voy.departs >= 0 && tick - voy.departs < ASCENT))) {
          const r = this.ramp(this.eco, voy);
          if (!r) continue;
          // Parked on the ramp, then fired up it and away, climbing ever steeper.
          const u = voy.state === "waiting" ? 0 : Math.min(1, (tick - voy.departs) / ASCENT);
          const base = r.at.clone().addScaledVector(r.away, 0.6).addScaledVector(r.up, 0.35);
          const dir = r.away.clone().multiplyScalar(0.86).addScaledVector(r.up, 0.5).normalize();
          const path = (x: number) => base.clone().addScaledVector(dir, 2.5 * x + 40 * x * x).addScaledVector(r.up, HIGH * x * x * x);
          const small = voy.kind === "hearthship" ? 0.32 : voy.kind === "skyship" ? 0.45 : 0.8;
          put(voy, path(u), path(u + 0.02).addScaledVector(dir, 0.05), small * (1 + 1.2 * u));
        } else if (voy.to === this.planet && voy.state === "done" && voy.kind === "skyship" && tick - voy.arrives < DESCENT && tick >= voy.arrives - DESCENT) {
          // Coming down over the keep it unloads at.
          const keep = this.eco.buildings[this.eco.keeps[voy.owner] ?? -1];
          if (!keep) continue;
          const at = this.frames.pos(keep.tile, 2.5);
          const up = at.clone().normalize();
          const side = new THREE.Vector3(0, 1, 0).cross(up).normalize();
          const u = Math.min(1, (tick - voy.arrives + DESCENT) / DESCENT);
          const path = (x: number) => at.clone().addScaledVector(up, HIGH * (1 - x) ** 3).addScaledVector(side, 14 * (1 - x) ** 2);
          put(voy, path(u), u < 0.98 ? path(u + 0.02) : path(u).add(side));
        } else if (voy.to === this.planet && voy.state === "orbit") {
          // Circling high over the view while its landing site is chosen.
          const up = focus.clone().normalize();
          const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
          const north = up.clone().cross(east);
          const R = this.frames.field.R + 11;
          const a = time * 0.08 + voy.id;
          const at = (x: number) => up.clone().multiplyScalar(R).addScaledVector(east, Math.cos(x) * 9).addScaledVector(north, Math.sin(x) * 9);
          put(voy, at(a), at(a + 0.05), 1.3);
        }
      }
    }
    for (const id of [...this.shown.keys()]) if (!seen.has(id)) this.shown.delete(id);
    for (const [kind, mesh] of Object.entries(this.meshes) as [Voyage["kind"], THREE.InstancedMesh][]) {
      mesh.count = n[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of Object.values(this.meshes)) mesh.geometry.dispose();
    this.mat.dispose();
  }
}
