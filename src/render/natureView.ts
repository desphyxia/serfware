import * as THREE from "three";
import { Feature, TREE_MATURE, type LandUse } from "../sim/econ/landuse";
import { SurfaceFrames } from "./frames";
import { broadleafGeometry, coniferGeometry, rockGeometry, stumpGeometry } from "./models";

/**
 * Trees, rocks and stumps from the simulation's tile features, drawn as instanced meshes and
 * rebuilt when the features change. Each tree tile shows a small cluster; density follows the
 * vegetation setting (visual only, the simulation still sees one tree per tile).
 */
export class NatureView {
  readonly group = new THREE.Group();
  private readonly conifers: THREE.InstancedMesh;
  private readonly broadleaves: THREE.InstancedMesh;
  private readonly rocks: THREE.InstancedMesh;
  private readonly stumps: THREE.InstancedMesh;
  private version = -1;
  private density = -1;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
    capacity: number,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const make = (g: THREE.BufferGeometry, n: number) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.conifers = make(coniferGeometry(), capacity * 3);
    this.broadleaves = make(broadleafGeometry(), capacity * 3);
    this.rocks = make(rockGeometry(), capacity);
    this.stumps = make(stumpGeometry(), capacity);
    this.group.name = "nature";
  }

  update(density: number): void {
    if (this.land.featureVersion === this.version && density === this.density) return;
    this.version = this.land.featureVersion;
    this.density = density;
    const land = this.land;
    const n = land.planet.grid.count;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    const counts = { c: 0, b: 0, r: 0, s: 0 };
    const perTile = 1 + Math.round(density * 2);
    for (let t = 0; t < n; t++) {
      const f = land.feature[t];
      if (f === Feature.None) continue;
      const base = this.frames.pos(t);
      const up = base.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      if (f === Feature.Tree) {
        const stage = (land.amount[t] as number) / TREE_MATURE;
        const conifer = (land.variety[t] as number) < 2 ? (land.planet.terrain.temperature[t] as number) < 14 : (land.variety[t] as number) === 3;
        const k = stage < 1 ? 1 : perTile;
        for (let i = 0; i < k; i++) {
          const h1 = SurfaceFrames.hash(t, i * 3 + 1);
          const h2 = SurfaceFrames.hash(t, i * 3 + 2);
          const r = i === 0 ? 0.2 * h1 : 0.6 + 0.55 * h1;
          const a = h2 * Math.PI * 2 + i * 2.1;
          p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r);
          this.frames.orient(p, null, q);
          q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h1 * 6.28));
          const sc = (0.25 + 0.75 * stage) * (0.75 + 0.5 * SurfaceFrames.hash(t, i + 9)) * (i === 0 ? 1.1 : 0.85);
          s.set(sc, sc * (0.9 + 0.3 * h2), sc);
          m.compose(p, q, s);
          const mesh = conifer ? this.conifers : this.broadleaves;
          const idx = conifer ? counts.c++ : counts.b++;
          if (idx >= mesh.instanceMatrix.count) continue;
          mesh.setMatrixAt(idx, m);
          color.setRGB(0.85 + 0.3 * h2, 0.85 + 0.3 * h2 + 0.05 * h1, 0.85 + 0.25 * h2);
          mesh.setColorAt(idx, color);
        }
      } else if (f === Feature.Rock) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 5) * 6.28));
        const sc = 0.7 + (land.amount[t] as number) * 0.09;
        s.set(sc, sc, sc);
        m.compose(base, q, s);
        if (counts.r < this.rocks.instanceMatrix.count) this.rocks.setMatrixAt(counts.r++, m);
      } else if (f === Feature.Stump) {
        this.frames.orient(base, null, q);
        s.set(1, 1, 1);
        m.compose(base, q, s);
        if (counts.s < this.stumps.instanceMatrix.count) this.stumps.setMatrixAt(counts.s++, m);
      }
    }
    for (const [mesh, c] of [
      [this.conifers, counts.c],
      [this.broadleaves, counts.b],
      [this.rocks, counts.r],
      [this.stumps, counts.s],
    ] as const) {
      mesh.count = Math.min(c, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const c of this.group.children) {
      const m = c as THREE.InstancedMesh;
      m.geometry.dispose();
      m.dispose();
    }
    ((this.group.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  }
}
