import * as THREE from "three/webgpu";
import type { Planet } from "../sim/planet/planet";
import type { TerrainField } from "./terrain/field";

const UP = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();

/** Helpers to place objects upright on the planet surface, on the detailed ground. */
export class SurfaceFrames {
  private readonly tileR: Float32Array;

  constructor(
    readonly planet: Planet,
    readonly field: TerrainField,
  ) {
    this.tileR = new Float32Array(planet.grid.count);
  }

  /** Forget cached tile heights (after pads change). */
  invalidate(): void {
    this.tileR.fill(0);
  }

  dir(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.planet.grid.center;
    return out.set(c[t * 3] as number, c[t * 3 + 1] as number, c[t * 3 + 2] as number);
  }

  /** Ground radius at a tile centre (cached). */
  radius(t: number): number {
    let r = this.tileR[t] as number;
    if (!r) {
      r = this.field.tileRadius(t);
      this.tileR[t] = r;
    }
    return r;
  }

  /** World position on the ground at tile t, lifted by `lift`. */
  pos(t: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return this.dir(t, out).multiplyScalar(this.radius(t) + lift);
  }

  /** Point between two tiles at fraction f, on the ground (the detailed surface in between). */
  between(a: number, b: number, f: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    if (f <= 0) return this.pos(a, lift, out);
    if (f >= 1) return this.pos(b, lift, out);
    const da = this.dir(a, new THREE.Vector3());
    const db = this.dir(b, _tmp);
    out.copy(da).lerp(db, f).normalize();
    return out.multiplyScalar(Math.max(this.field.R, this.field.radiusAt(out, f < 0.5 ? a : b)) + lift);
  }

  /** Ground radius at any unit direction. */
  groundAt(dir: THREE.Vector3, hint?: number): number {
    return Math.max(this.field.R, this.field.radiusAt(dir, hint));
  }

  /** Orientation with local +Y along the surface normal and local +Z toward `toward` (a world point). */
  orient(at: THREE.Vector3, toward: THREE.Vector3 | null, out = new THREE.Quaternion()): THREE.Quaternion {
    const up = at.clone().normalize();
    out.setFromUnitVectors(UP, up);
    if (toward) {
      const fwd = toward.clone().sub(at);
      fwd.addScaledVector(up, -fwd.dot(up));
      if (fwd.lengthSq() > 1e-8) {
        fwd.normalize();
        const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(out);
        const angle = Math.atan2(localZ.clone().cross(fwd).dot(up), localZ.dot(fwd));
        out.premultiply(new THREE.Quaternion().setFromAxisAngle(up, angle));
      }
    }
    return out;
  }

  /** Stable pseudo-random yaw for decorations on a tile. */
  static hash(t: number, salt = 0): number {
    let h = Math.imul((t + salt * 7919) ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
}
