import * as THREE from "three/webgpu";
import { MEMORIAL } from "../sim/econ/economy";
import { Feature, FIELD_RIPE, TREE_MATURE, type LandUse } from "../sim/econ/landuse";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import { birchGeometry, broadleafGeometry, coniferGeometry, palmGeometry, pineGeometry, fieldRowsGeometry, fieldSoilGeometry, rockGeometry, signpostGeometry, stumpGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";
import { Biome } from "../sim/planet/terrain";

/** Tree species drawn for the simulation's trees; chosen per tile from climate and variety. */
export enum Species {
  Spruce,
  Oak,
  Birch,
  Pine,
  Palm,
}

/**
 * Which species grows on a tile: spruce and birch in the cold, oak, birch and some pine in the
 * temperate belt, pine on dry warm ground and palms on hot coasts and in deserts. Memorial trees
 * are always oaks.
 */
export function speciesAt(temperature: number, moisture: number, biome: Biome, variety: number, memorial: boolean): Species {
  if (memorial) return Species.Oak;
  if (temperature < 5) return variety === 2 ? Species.Birch : Species.Spruce;
  if (temperature < 14) return variety < 2 ? Species.Spruce : variety === 2 ? Species.Birch : Species.Pine;
  if (temperature >= 22 && (biome === Biome.Beach || biome === Biome.Desert || variety === 3)) return Species.Palm;
  if (moisture < 0.35 && variety !== 2) return Species.Pine;
  return variety === 2 ? Species.Birch : variety === 3 && temperature < 18 ? Species.Spruce : Species.Oak;
}

/**
 * Trees, rocks and stumps from the simulation's tile features, drawn as instanced meshes and
 * rebuilt when the features change. Each tree tile shows a small cluster; density follows the
 * vegetation setting (visual only, the simulation still sees one tree per tile).
 */
export class NatureView {
  readonly group = new THREE.Group();
  /** One instanced mesh per Species. */
  private readonly trees: THREE.InstancedMesh[];
  /** Full and lighter tree geometry per Species; the lighter set is used at low vegetation. */
  private readonly treeGeo: { full: THREE.BufferGeometry; lite: THREE.BufferGeometry }[];
  private readonly rocks: THREE.InstancedMesh;
  private readonly stumps: THREE.InstancedMesh;
  private readonly soil: THREE.InstancedMesh;
  private readonly rows: THREE.InstancedMesh;
  private readonly signs: THREE.InstancedMesh;
  /** Crowns of leaf-dropping trees (x, y, z, leaf fall 0..1) for the falling-leaf effect. */
  crowns = new Float32Array(0);
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
    // Smooth shading: the foliage carries soft, outward-leaning normals.
    const treeMat = new PainterlyMaterial({ vertexColors: true, wind: 1, brush: 1.4 });
    const make = (g: THREE.BufferGeometry, n: number, material = mat) => {
      const m = new THREE.InstancedMesh(g, material, n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    // Palm fronds are thin sheets: drawn from both sides.
    const palmMat = new PainterlyMaterial({ vertexColors: true, wind: 1.3, brush: 1.2, side: THREE.DoubleSide });
    const palm = palmGeometry();
    this.treeGeo = [
      { full: coniferGeometry(), lite: coniferGeometry(true) },
      { full: broadleafGeometry(), lite: broadleafGeometry(true) },
      { full: birchGeometry(), lite: birchGeometry(true) },
      { full: pineGeometry(), lite: pineGeometry(true) },
      { full: palm, lite: palm },
    ];
    const sizes = [3, 3, 2, 2, 1];
    this.trees = this.treeGeo.map((g, i) => make(g.full, capacity * (sizes[i] as number), i === 4 ? palmMat : treeMat));
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
    for (let i = 0; i < this.trees.length; i++) {
      const g = this.treeGeo[i] as { full: THREE.BufferGeometry; lite: THREE.BufferGeometry };
      (this.trees[i] as THREE.InstancedMesh).geometry = density < 0.5 ? g.lite : g.full;
    }
    const land = this.land;
    const n = land.planet.grid.count;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    const counts = { r: 0, s: 0, f: 0 };
    const treeCount = this.trees.map(() => 0);
    const crowns: number[] = [];
    const { temperature, moisture, biome } = land.planet.terrain;
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
        const species = speciesAt(temperature[t] as number, moisture[t] as number, biome[t] as Biome, land.variety[t] as number, memorial);
        // Spruce and pine keep their needles; the rest turn and drop their leaves (palms do not).
        const evergreen = species === Species.Spruce || species === Species.Pine || species === Species.Palm;
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
          const mesh = this.trees[species] as THREE.InstancedMesh;
          const idx = (treeCount[species] as number)++;
          if (idx >= mesh.instanceMatrix.count) continue;
          mesh.setMatrixAt(idx, m);
          if (memorial) color.setRGB(2.4, 1.35, 1.9);
          else {
            color.setRGB(0.85 + 0.3 * h2, 0.85 + 0.3 * h2 + 0.05 * h1, 0.85 + 0.25 * h2);
            const sea = this.season(t);
            // Broadleaves turn gold and red in autumn and go bare-brown in winter; snow whitens all.
            // Birches go butter-yellow, oaks gold and russet.
            const turn = species === Species.Birch ? new THREE.Color(1.75 + 0.2 * h1, 1.35 + 0.2 * h2, 0.35) : new THREE.Color(1.9 + 0.5 * h1, 0.95 + 0.4 * h2, 0.35);
            if (!evergreen && sea.autumn > 0) color.lerp(turn, sea.autumn * (0.6 + 0.4 * h1));
            if (!evergreen && sea.bare > 0) color.lerp(new THREE.Color(0.95, 0.75, 0.6), sea.bare);
            if (sea.snow > 0.15) color.lerp(new THREE.Color(1.6, 1.65, 1.75), Math.min(0.7, sea.snow) * (evergreen ? 0.7 : 0.5));
          }
          mesh.setColorAt(idx, color);
          if (!evergreen && !memorial && stage >= 1) {
            const sea = this.season(t);
            const fall = Math.min(1, sea.autumn * 0.8 + sea.bare * 0.6);
            if (fall > 0.05) crowns.push(p.x + up.x * sc * 1.25, p.y + up.y * sc * 1.25, p.z + up.z * sc * 1.25, fall);
          }
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
    this.crowns = new Float32Array(crowns);
    for (const [mesh, c] of [
      ...this.trees.map((m, i) => [m, treeCount[i] as number] as const),
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
    for (const g of this.treeGeo) {
      g.full.dispose();
      g.lite.dispose();
    }
    for (const c of this.group.children) {
      const m = c as THREE.InstancedMesh;
      m.geometry.dispose();
      m.dispose();
    }
    for (const c of this.group.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
  }
}
