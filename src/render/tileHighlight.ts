import * as THREE from "three/webgpu";
import type { Planet } from "../sim/planet/planet";

/** Glowing outline of the hovered tile. */
export class TileHighlight {
  readonly line: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private tile = -1;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    this.line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: "#ffd58a", transparent: true, opacity: 0.95, depthTest: false }));
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
    const cs = grid.cornersOf(tile);
    const attr = this.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k] as number;
      let h = 0;
      for (let j = 0; j < 3; j++) h += Math.max(0, terrain.elevation[grid.cornerTiles[c * 3 + j] as number] as number);
      const r = R + h / 3 + 0.12;
      attr.setXYZ(k, (grid.corners[c * 3] as number) * r, (grid.corners[c * 3 + 1] as number) * r, (grid.corners[c * 3 + 2] as number) * r);
    }
    attr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, cs.length);
    this.line.visible = true;
  }
}
