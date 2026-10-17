import * as THREE from "three/webgpu";
import type { Planet } from "../sim/planet/planet";

/**
 * Glowing ring round the hovered spot. Spots are the corners of the ground's triangles (where
 * flags and buildings stand, as in Serf City), so the ring sits on the corner, a third of the way
 * out toward the neighbouring triangles. A closed line strip (the WebGPU renderer has no
 * LineLoop, so the first point is repeated at the end).
 */
export class TileHighlight {
  readonly line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private tile = -1;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#ffd58a", transparent: true, opacity: 0.95, depthTest: false }));
    this.line.renderOrder = 10;
    this.line.visible = false;
    this.line.frustumCulled = false;
  }

  set(planet: Planet, tile: number): void {
    if (tile === this.tile) return;
    this.tile = tile;
    if (tile < 0) {
      this.line.visible = false;
      return;
    }
    const { grid, terrain } = planet;
    const R = planet.params.radius;
    if (tile >= grid.count) return this.setCorner(planet, tile - grid.count);
    const cs = grid.cornersOf(tile);
    const attr = this.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const h = Math.max(0, terrain.elevation[tile] as number);
    const r = R + h + 0.15;
    const p = new THREE.Vector3();
    const centre = new THREE.Vector3(...grid.centerOf(tile));
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k] as number;
      p.set(grid.corners[c * 3] as number, grid.corners[c * 3 + 1] as number, grid.corners[c * 3 + 2] as number).lerp(centre, 0.55).normalize().multiplyScalar(r);
      attr.setXYZ(k, p.x, p.y, p.z);
    }
    attr.setXYZ(cs.length, attr.getX(0), attr.getY(0), attr.getZ(0));
    attr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, cs.length + 1);
    this.line.visible = true;
  }

  /** A small ring round a tile corner (a lattice flag spot). */
  private setCorner(planet: Planet, c: number): void {
    const { grid, terrain } = planet;
    const R = planet.params.radius;
    const o = c * 3;
    const centre = new THREE.Vector3(grid.corners[o] as number, grid.corners[o + 1] as number, grid.corners[o + 2] as number);
    const t0 = grid.cornerTiles[o] as number;
    const r = R + Math.max(0, terrain.elevation[t0] as number) + 0.15;
    const up = centre.clone();
    const a = new THREE.Vector3().subVectors(new THREE.Vector3(...grid.centerOf(t0)), centre);
    a.addScaledVector(up, -a.dot(up)).normalize();
    const b = new THREE.Vector3().crossVectors(up, a);
    const rad = centre.distanceTo(new THREE.Vector3(...grid.centerOf(t0))) * R * 0.22;
    const attr = this.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const N = 8;
    for (let k = 0; k <= N; k++) {
      const ang = (k / N) * Math.PI * 2;
      p.copy(centre).multiplyScalar(r).addScaledVector(a, Math.cos(ang) * rad).addScaledVector(b, Math.sin(ang) * rad);
      attr.setXYZ(k, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, N + 1);
    this.line.visible = true;
  }
}
