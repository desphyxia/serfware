import * as THREE from "three/webgpu";
import { MEMORIAL } from "../sim/econ/economy";
import { Feature, FIELD_RIPE, TREE_MATURE, type LandUse } from "../sim/econ/landuse";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import { broadleafGeometry, coniferGeometry, fieldRowsGeometry, fieldSoilGeometry, rockGeometry, signpostGeometry, stumpGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";

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
  private readonly soil: THREE.InstancedMesh;
  private readonly rows: THREE.InstancedMesh;
  private readonly signs: THREE.InstancedMesh;
  private signVersion = -1;
  private version = -1;
  private maskVersion = -1;
  /** Changes a few times a day so trees follow the seasons and the snow. */
  seasonKey = 0;
  private builtSeason = -1;
  private density = -1;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
    capacity: number,
    private readonly mask: FogMask,
    private readonly season: (t: number) => { autumn: number; bare: number; snow: number } = () => ({ autumn: 0, bare: 0, snow: 0 }),
  ) {
    const mat = new PainterlyMaterial({ vertexColors: true, flatShading: true });
    const treeMat = new PainterlyMaterial({ vertexColors: true, flatShading: true, wind: 1 });
    const make = (g: THREE.BufferGeometry, n: number, material = mat) => {
      const m = new THREE.InstancedMesh(g, material, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.conifers = make(coniferGeometry(), capacity * 3, treeMat);
    this.broadleaves = make(broadleafGeometry(), capacity * 3, treeMat);
    this.rocks = make(rockGeometry(), capacity);
    this.stumps = make(stumpGeometry(), capacity);
    this.soil = make(fieldSoilGeometry(), capacity);
    this.soil.castShadow = false;
    const rowMat = new PainterlyMaterial({ vertexColors: true, wind: 0.35 });
    this.rows = make(fieldRowsGeometry(), capacity, rowMat);
    this.signs = make(signpostGeometry(), 2000);
    this.group.name = "nature";
  }

  update(density: number): void {
    if (this.land.signVersion !== this.signVersion) {
      this.signVersion = this.land.signVersion;
      this.updateSigns();
    }
    if (this.land.featureVersion === this.version && density === this.density && this.mask.version === this.maskVersion && this.seasonKey === this.builtSeason) return;
    this.builtSeason = this.seasonKey;
    this.version = this.land.featureVersion;
    this.maskVersion = this.mask.version;
    this.density = density;
    const land = this.land;
    const n = land.planet.grid.count;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    const counts = { c: 0, b: 0, r: 0, s: 0, f: 0 };
    const green = new THREE.Color("#6f9a45");
    const gold = new THREE.Color("#e2c060");
    const perTile = 1 + Math.round(density * 2);
    for (let t = 0; t < n; t++) {
      const f = land.feature[t];
      if (f === Feature.None || hiddenAt(this.mask, t)) continue;
      const base = this.frames.pos(t);
      const up = base.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      if (f === Feature.Tree) {
        const stage = (land.amount[t] as number) / TREE_MATURE;
        const memorial = land.variety[t] === MEMORIAL;
        const conifer = !memorial && ((land.variety[t] as number) < 2 ? (land.planet.terrain.temperature[t] as number) < 14 : (land.variety[t] as number) === 3);
        const k = stage < 1 || memorial ? 1 : perTile;
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
          if (memorial) color.setRGB(2.4, 1.35, 1.9);
          else {
            color.setRGB(0.85 + 0.3 * h2, 0.85 + 0.3 * h2 + 0.05 * h1, 0.85 + 0.25 * h2);
            const sea = this.season(t);
            // Broadleaves turn gold and red in autumn and go bare-brown in winter; snow whitens all.
            if (!conifer && sea.autumn > 0) color.lerp(new THREE.Color(1.9 + 0.5 * h1, 0.95 + 0.4 * h2, 0.35), sea.autumn * (0.6 + 0.4 * h1));
            if (!conifer && sea.bare > 0) color.lerp(new THREE.Color(0.95, 0.75, 0.6), sea.bare);
            if (sea.snow > 0.15) color.lerp(new THREE.Color(1.6, 1.65, 1.75), Math.min(0.7, sea.snow) * (conifer ? 0.7 : 0.5));
          }
          mesh.setColorAt(idx, color);
        }
      } else if (f === Feature.Rock) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 5) * 6.28));
        const sc = 0.7 + (land.amount[t] as number) * 0.09;
        s.set(sc, sc, sc);
        m.compose(base, q, s);
        if (counts.r < this.rocks.instanceMatrix.count) this.rocks.setMatrixAt(counts.r++, m);
      } else if (f === Feature.Field) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 7) * Math.PI));
        s.set(1, 1, 1);
        m.compose(base, q, s);
        if (counts.f < this.soil.instanceMatrix.count) {
          this.soil.setMatrixAt(counts.f, m);
          const g = (land.amount[t] as number) / FIELD_RIPE;
          s.set(1, 0.08 + g * 0.92, 1);
          m.compose(base, q, s);
          this.rows.setMatrixAt(counts.f, m);
          color.copy(green).lerp(gold, Math.max(0, g * 1.4 - 0.4));
          this.rows.setColorAt(counts.f, color);
          counts.f++;
        }
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
      [this.soil, counts.f],
      [this.rows, counts.f],
    ] as const) {
      mesh.count = Math.min(c, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private updateSigns(): void {
    const land = this.land;
    const colors = ["#ffffff", "#a8a8a8", "#26262a", "#b0603f", "#f0c85a", "#d8d4cc"].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let t = 0; t < land.sign.length && n < this.signs.instanceMatrix.count; t++) {
      const v = land.sign[t] as number;
      if (!v) continue;
      const p = this.frames.pos(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(p.clone().normalize()).normalize();
      p.addScaledVector(tA, 0.9);
      this.frames.orient(p, null, q);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 3) * 6.28));
      m.compose(p, q, one);
      this.signs.setMatrixAt(n, m);
      this.signs.setColorAt(n, colors[v] ?? (colors[0] as THREE.Color));
      n++;
    }
    this.signs.count = n;
    this.signs.instanceMatrix.needsUpdate = true;
    if (this.signs.instanceColor) this.signs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const c of this.group.children) {
      const m = c as THREE.InstancedMesh;
      m.geometry.dispose();
      m.dispose();
    }
    for (const c of this.group.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
  }
}
