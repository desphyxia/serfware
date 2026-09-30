import * as THREE from "three/webgpu";
import { MEMORIAL } from "../sim/econ/economy";
import { Feature, FIELD_RIPE, ORCHARD, TREE_MATURE, type LandUse } from "../sim/econ/landuse";
import { Region } from "../sim/biomes/regions";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import { birchGeometry, broadleafGeometry, coniferGeometry, fruitTreeGeometry, giantTreeGeometry, hedgeGeometry, palmGeometry, pineGeometry, fieldRowsGeometry, fieldSoilGeometry, rockGeometry, signpostGeometry, spireGeometry, stumpGeometry, ventGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";
import { bushGeometry } from "./undergrowth";
import type { Ecology } from "../sim/econ/ecology";
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
export function speciesAt(temperature: number, moisture: number, biome: Biome, variety: number, memorial: boolean, region = 0): Species {
  if (memorial) return Species.Oak;
  // The Canopy Deeps are broadleaf all the way down, with palms where it's hottest.
  if (region === Region.CanopyDeeps) return temperature >= 22 && variety === 3 ? Species.Palm : variety === 2 ? Species.Birch : Species.Oak;
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
  /** Emberglass vents and Saltglass spires. */
  private readonly vents: THREE.InstancedMesh;
  private readonly spires: THREE.InstancedMesh;
  private readonly stumps: THREE.InstancedMesh;
  /** Canopy Deeps giants, orchard trees and hedgerow segments. */
  private readonly giants: THREE.InstancedMesh;
  private readonly fruit: THREE.InstancedMesh;
  private readonly hedges: THREE.InstancedMesh;
  /** Scrub on old clearings (succession), a few bushes per tile. */
  private readonly shrubs: THREE.InstancedMesh;
  /** The ecology, for charred stumps on burnt ground (set by the world view). */
  ecology: Ecology | null = null;
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
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.vents = make(ventGeometry(), Math.max(64, Math.ceil(capacity / 20)));
    // Spires glow faintly rose after dark.
    this.spires = make(spireGeometry(), Math.max(64, Math.ceil(capacity / 16)), new PainterlyMaterial({ vertexColors: true, flatShading: true, emissive: "#3a1e2c", brush: 0.6 }));
    this.stumps = make(stumpGeometry(), capacity);
    this.stumps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.giants = make(giantTreeGeometry(), Math.max(64, Math.ceil(capacity / 6)), treeMat);
    this.giants.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.giants.instanceMatrix.count * 3).fill(1), 3);
    this.fruit = make(fruitTreeGeometry(), Math.max(64, Math.ceil(capacity / 4)), treeMat);
    this.fruit.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.fruit.instanceMatrix.count * 3).fill(1), 3);
    this.hedges = make(hedgeGeometry(), capacity, new PainterlyMaterial({ vertexColors: true, wind: 0.8, brush: 1.2 }));
    this.hedges.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.shrubs = make(bushGeometry(), capacity * 3, new PainterlyMaterial({ vertexColors: true, wind: 0.6, brush: 1.2 }));
    this.shrubs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 9).fill(1), 3);
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
    const counts = { r: 0, s: 0, f: 0, h: 0, g: 0, o: 0, e: 0, v: 0, p: 0 };
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
      if (f === Feature.Tree && land.variety[t] === ORCHARD) {
        this.placeFruitTree(t, base, tA, tB, counts);
      } else if (f === Feature.Giant) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 13) * 6.28));
        const sc = 0.95 + SurfaceFrames.hash(t, 14) * 0.25;
        s.set(sc, sc * (0.95 + SurfaceFrames.hash(t, 15) * 0.15), sc);
        m.compose(base, q, s);
        if (counts.g < this.giants.instanceMatrix.count) {
          const sea = this.season(t);
          color.setRGB(0.9 + 0.2 * SurfaceFrames.hash(t, 16), 0.95, 0.9);
          // A giant marked for felling is picked out, faintly, in autumn gold.
          if (land.variety[t] === 1) color.setRGB(1.5, 1.2, 0.7);
          if (sea.snow > 0.15) color.lerp(new THREE.Color(1.6, 1.65, 1.75), Math.min(0.5, sea.snow) * 0.6);
          this.giants.setColorAt(counts.g, color);
          this.giants.setMatrixAt(counts.g++, m);
        }
      } else if (f === Feature.Hedge) {
        this.placeHedge(t, base, counts);
      } else if (f === Feature.Tree) {
        const stage = (land.amount[t] as number) / TREE_MATURE;
        const memorial = land.variety[t] === MEMORIAL;
        const species = speciesAt(temperature[t] as number, moisture[t] as number, biome[t] as Biome, land.variety[t] as number, memorial, land.region[t]);
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
        if (counts.r < this.rocks.instanceMatrix.count) {
          // Rock by a vent is black volcanic glass; tundra rock is frosted.
          if (land.nearVent(t, 2)) color.setRGB(0.2, 0.19, 0.25);
          else color.setRGB(1, 1, 1).lerp(new THREE.Color(1.15, 1.2, 1.3), Math.min(0.5, this.season(t).snow));
          this.rocks.setColorAt(counts.r, color);
          this.rocks.setMatrixAt(counts.r++, m);
        }
      } else if (f === Feature.Spire) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 25) * 6.28));
        const sc = 0.9 + SurfaceFrames.hash(t, 26) * 0.6;
        s.set(sc, sc * (0.85 + SurfaceFrames.hash(t, 27) * 0.5), sc);
        m.compose(base, q, s);
        if (counts.p < this.spires.instanceMatrix.count) this.spires.setMatrixAt(counts.p++, m);
      } else if (f === Feature.Vent) {
        this.frames.orient(base, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), SurfaceFrames.hash(t, 23) * 6.28));
        const sc = 1.35 + SurfaceFrames.hash(t, 24) * 0.3;
        s.set(sc, sc * 0.9, sc);
        m.compose(base, q, s);
        if (counts.v < this.vents.instanceMatrix.count) this.vents.setMatrixAt(counts.v++, m);
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
        if (counts.s < this.stumps.instanceMatrix.count) {
          // Burnt stumps are charred black.
          const burnt = ((this.ecology?.scorch[t] as number | undefined) ?? 0) / 255;
          color.setRGB(1, 1, 1).lerp(new THREE.Color(0.18, 0.15, 0.13), Math.min(1, burnt * 1.5));
          this.stumps.setColorAt(counts.s, color);
          this.stumps.setMatrixAt(counts.s++, m);
        }
      } else if (f === Feature.Shrub) {
        const b = land.planet.terrain.biome[t] as Biome;
        const sea = this.season(t);
        for (let i = 0; i < 1 + perTile; i++) {
          if (counts.h >= this.shrubs.instanceMatrix.count) break;
          const h1 = SurfaceFrames.hash(t, i * 5 + 21);
          const h2 = SurfaceFrames.hash(t, i * 5 + 22);
          const r = i === 0 ? 0.15 * h1 : 0.4 + 0.5 * h1;
          const a = h2 * Math.PI * 2 + i * 2.4;
          p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r);
          this.frames.orient(p, null, q);
          q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h1 * 6.28));
          const sc = 1.3 + h2 * 1.1;
          s.set(sc, sc * (0.8 + 0.4 * h1), sc);
          m.compose(p, q, s);
          this.shrubs.setMatrixAt(counts.h, m);
          if (b === Biome.Tundra) color.setHSL(0.95, 0.3, 0.22 + h1 * 0.06);
          else if (b === Biome.Steppe) color.setHSL(0.17 + h1 * 0.04, 0.24, 0.26 + h2 * 0.06);
          else color.setHSL(0.26 + (h1 - 0.5) * 0.06, 0.45, 0.16 + h2 * 0.08);
          if (sea.autumn > 0) color.lerp(new THREE.Color(0.55, 0.32, 0.12), sea.autumn * 0.6 * h2);
          if (sea.snow > 0.15) color.lerp(new THREE.Color(0.85, 0.88, 0.92), Math.min(0.6, sea.snow));
          this.shrubs.setColorAt(counts.h++, color);
        }
      }
    }
    this.crowns = new Float32Array(crowns);
    for (const [mesh, c] of [
      ...this.trees.map((m, i) => [m, treeCount[i] as number] as const),
      [this.rocks, counts.r],
      [this.vents, counts.v],
      [this.spires, counts.p],
      [this.stumps, counts.s],
      [this.shrubs, counts.h],
      [this.giants, counts.g],
      [this.fruit, counts.o],
      [this.hedges, counts.e],
      [this.soil, counts.f],
      [this.rows, counts.f],
    ] as const) {
      mesh.count = Math.min(c, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** An orchard tree: blossom in spring, fruit through summer and autumn, bare in winter. */
  private placeFruitTree(t: number, base: THREE.Vector3, tA: THREE.Vector3, tB: THREE.Vector3, counts: { o: number }): void {
    if (counts.o >= this.fruit.instanceMatrix.count) return;
    const land = this.land;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const h1 = SurfaceFrames.hash(t, 31);
    const p = base.clone().addScaledVector(tA, (h1 - 0.5) * 0.3).addScaledVector(tB, (SurfaceFrames.hash(t, 32) - 0.5) * 0.3);
    this.frames.orient(p, null, q);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h1 * 6.28));
    const stage = (land.amount[t] as number) / TREE_MATURE;
    const sc = (0.35 + 0.65 * stage) * (1.1 + h1 * 0.2);
    m.compose(p, q, new THREE.Vector3(sc, sc, sc));
    this.fruit.setMatrixAt(counts.o, m);
    const sea = this.season(t);
    const c = new THREE.Color(1, 1, 1);
    const spring = Math.max(0, 1 - sea.autumn * 2 - sea.bare * 2) * (this.seasonKeyBlossom() ? 1 : 0);
    if (spring > 0) c.lerp(new THREE.Color(1.7, 1.45, 1.55), 0.45 * spring);
    if (sea.autumn > 0) c.lerp(new THREE.Color(1.6, 1.1, 0.5), sea.autumn * 0.5);
    if (sea.bare > 0) c.lerp(new THREE.Color(0.9, 0.75, 0.6), sea.bare);
    if (sea.snow > 0.15) c.lerp(new THREE.Color(1.6, 1.65, 1.75), Math.min(0.6, sea.snow) * 0.6);
    this.fruit.setColorAt(counts.o++, c);
  }

  /** Spring blossom: set by the world view from the season at the focus. */
  blossom = 0;
  private seasonKeyBlossom(): boolean {
    return this.blossom > 0.5;
  }

  /** A hedgerow: a line of bushes from the tile's middle toward each neighbouring hedge, or a short run on its own. */
  private placeHedge(t: number, base: THREE.Vector3, counts: { e: number }): void {
    const land = this.land;
    const grid = land.planet.grid;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = base.clone().normalize();
    const links = Array.from(grid.neighborsOf(t)).filter((n) => land.feature[n] === Feature.Hedge);
    const targets: THREE.Vector3[] = links.length ? links.map((n) => this.frames.pos(n)) : [base.clone().add(new THREE.Vector3(0, 1, 0).cross(up).normalize().multiplyScalar(1.4))];
    if (!links.length) targets.push(base.clone().multiplyScalar(2).sub(targets[0] as THREE.Vector3));
    const k = 0.78 + SurfaceFrames.hash(t, 6) * 0.2;
    const tint = new THREE.Color(k * 0.95, k * (0.9 + SurfaceFrames.hash(t, 5) * 0.08), k * 0.85);
    for (const target of targets) {
      if (counts.e >= this.hedges.instanceMatrix.count) return;
      const dir = target.clone().sub(base);
      dir.addScaledVector(up, -dir.dot(up));
      const half = dir.length() * 0.5;
      if (half < 1e-4) continue;
      dir.normalize();
      // Frame: y up, z along the hedge.
      const x = up.clone().cross(dir).normalize();
      m.makeBasis(x, up, dir);
      q.setFromRotationMatrix(m);
      m.compose(base, q, new THREE.Vector3(1, 1, half + 0.1));
      this.hedges.setMatrixAt(counts.e, m);
      this.hedges.setColorAt(counts.e++, tint);
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
