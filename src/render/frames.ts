import * as THREE from "three";
import type { Planet } from "../sim/planet/planet";

const UP = new THREE.Vector3(0, 1, 0);

/** Helpers to place objects upright on the planet surface. */
export class SurfaceFrames {
  constructor(readonly planet: Planet) {}

  dir(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.planet.grid.center;
    return out.set(c[t * 3] as number, c[t * 3 + 1] as number, c[t * 3 + 2] as number);
  }

  radius(t: number): number {
    return this.planet.surfaceRadius(t);
  }

  /** World position on the ground at tile t, lifted by `lift`. */
  pos(t: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return this.dir(t, out).multiplyScalar(this.radius(t) + lift);
  }

  /** Point between two tiles at fraction f, on the ground. */
  between(a: number, b: number, f: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const da = this.dir(a, new THREE.Vector3());
    const db = this.dir(b, new THREE.Vector3());
    const r = this.radius(a) + (this.radius(b) - this.radius(a)) * f + lift;
    return out.copy(da).lerp(db, f).normalize().multiplyScalar(r);
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
