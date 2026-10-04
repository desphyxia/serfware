import * as THREE from "three/webgpu";
import { Feature, Use, type LandUse } from "../sim/econ/landuse";
import { Biome } from "../sim/planet/terrain";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import { PainterlyMaterial } from "./painterly";
import { ROAD_HALF } from "./terrain/field";

const MAX = 24000;

/**
 * Grass tufts and wildflowers around the camera focus. They are regenerated when the focus moves,
 * always with the same layout per tile (hash-based), so nothing pops or shuffles.
 */
export class GrassPatch {
  readonly group = new THREE.Group();
  private readonly tufts: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly pebbles: THREE.InstancedMesh;
  private readonly leaves: THREE.InstancedMesh;
  private centerTile = -1;
  private key = "";
  /** Ground cover (0..255) from the ecology: burnt ground is bare until it regrows. */
  cover: { cover: Uint8Array; groundVersion: number } | null = null;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
    private readonly mask: FogMask,
    private readonly autumnAt: (t: number) => number = () => 0,
  ) {
    const blades = new THREE.BufferGeometry();
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + i;
      const r = 0.06;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const tx = Math.cos(a + 0.3) * 0.14;
      const tz = Math.sin(a + 0.3) * 0.14;
      const h = 0.14 + (i % 3) * 0.05;
      const w = 0.035;
      pos.push(x - w * Math.sin(a), 0, z + w * Math.cos(a), x + w * Math.sin(a), 0, z - w * Math.cos(a), tx, h, tz);
      col.push(0.32, 0.48, 0.2, 0.32, 0.48, 0.2, 0.62, 0.78, 0.36);
    }
    blades.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    blades.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    blades.computeVertexNormals();
    const grassMat = new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, wind: 0.25, brush: 0.6 });
    this.tufts = new THREE.InstancedMesh(blades, grassMat, MAX);
    this.tufts.count = 0;
    this.tufts.frustumCulled = false;
    this.tufts.receiveShadow = true;

    const flower = new THREE.BufferGeometry();
    const fp: number[] = [0, 0, 0, 0.012, 0, 0, 0, 0.2, 0];
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const b = a + Math.PI / petals;
      fp.push(0, 0.2, 0, Math.cos(a) * 0.06, 0.21, Math.sin(a) * 0.06, Math.cos(b) * 0.06, 0.21, Math.sin(b) * 0.06);
    }
    flower.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    const fc: number[] = [];
    for (let i = 0; i < fp.length / 3; i++) fc.push(...(i < 3 ? [0.3, 0.5, 0.2] : [1, 1, 1]));
    flower.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
    flower.computeVertexNormals();
    const flowerMat = new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: "#140c04", wind: 0.3, brush: 0 });
    this.flowers = new THREE.InstancedMesh(flower, flowerMat, MAX / 4);
    this.flowers.count = 0;
    this.flowers.frustumCulled = false;
    // Pebbles: small flattened stones, darker underneath.
    const pebble = new THREE.DodecahedronGeometry(0.05, 0).scale(1.2, 0.55, 1).translate(0, 0.012, 0);
    pebble.computeVertexNormals();
    const pp = pebble.getAttribute("position");
    const pc = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const k = 0.7 + 0.3 * Math.min(1, Math.max(0, pp.getY(i) / 0.04));
      pc.set([k, k, k], i * 3);
    }
    pebble.setAttribute("color", new THREE.BufferAttribute(pc, 3));
    this.pebbles = new THREE.InstancedMesh(pebble, new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 0.8 }), MAX / 4);
    this.pebbles.count = 0;
    this.pebbles.frustumCulled = false;
    this.pebbles.receiveShadow = true;
    // Fallen leaves: small flat, slightly cupped quads.
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute("position", new THREE.Float32BufferAttribute([-0.04, 0.012, 0, 0, 0.004, -0.028, 0.04, 0.012, 0, -0.04, 0.012, 0, 0.04, 0.012, 0, 0, 0.004, 0.028], 3));
    leaf.computeVertexNormals();
    this.leaves = new THREE.InstancedMesh(leaf, new PainterlyMaterial({ side: THREE.DoubleSide, brush: 0.5 }), MAX / 4);
    this.leaves.count = 0;
    // Colour buffers exist from the start, so the material compiles with per-instance colour
    // even if the first layout has no leaves.
    for (const mesh of [this.tufts, this.flowers, this.pebbles, this.leaves]) {
      mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
    }
    this.leaves.frustumCulled = false;
    this.leaves.receiveShadow = true;
    this.group.add(this.tufts, this.flowers, this.pebbles, this.leaves);
  }

  update(focus: THREE.Vector3, closeness: number, density: number): void {
    const visible = closeness > 0.35;
    this.group.visible = visible;
    if (!visible) return;
    const grid = this.land.planet.grid;
    const t = grid.nearestTile([focus.x, focus.y, focus.z], this.centerTile >= 0 ? this.centerTile : 0);
    const key = `${this.land.useVersion}:${this.land.featureVersion}:${this.land.lifeVersion}:${density}:${this.mask.version}:${Math.round(this.autumnAt(t) * 4)}:${this.cover?.groundVersion ?? 0}`;
    if (this.centerTile >= 0 && key === this.key) {
      // Only rebuild once the focus has moved a few tiles.
      const d = this.frames.dir(t).dot(this.frames.dir(this.centerTile));
      if (d > Math.cos(this.land.spacing * 3)) return;
    }
    this.centerTile = t;
    this.key = key;
    this.rebuild(t, density);
  }

  private rebuild(center: number, density: number): void {
    const land = this.land;
    const { terrain } = land.planet;
    const tiles = [center, ...land.ring(center, 11)];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const flowerColors = ["#f4d35e", "#ee964b", "#f2f2f2", "#c38bd9", "#e56b6f", "#7fb7e8"].map((x) => new THREE.Color(x));
    let n = 0;
    let f = 0;
    let st = 0;
    const stoneColors = ["#9b958b", "#a8a296", "#8a847a", "#b3aa98"].map((x) => new THREE.Color(x));
    const ground = (v: THREE.Vector3, t: number) => {
      const len = this.frames.groundAt(v.normalize(), t);
      return v.multiplyScalar(len - 0.02);
    };
    for (const t of tiles) {
      if (!land.isLand(t) || land.use[t] === Use.Building || hiddenAt(this.mask, t)) continue;
      const b = terrain.biome[t] as Biome;
      let per: number;
      let hue = 0;
      let bloom = 0;
      switch (b) {
        case Biome.Meadow: per = 20; bloom = 0.22; break;
        case Biome.Forest: per = 12; hue = -0.02; bloom = 0.06; break;
        case Biome.DeepForest: per = 8; hue = -0.03; break;
        case Biome.Marsh: per = 20; hue = 0.02; bloom = 0.03; break;
        case Biome.Steppe: per = 14; hue = 0.05; bloom = 0.05; break;
        case Biome.Tundra: per = 6; hue = 0.06; break;
        case Biome.Beach: per = 1; hue = 0.08; break;
        default: per = 0;
      }
      if (land.use[t] === Use.Road || land.use[t] === Use.Flag) per = Math.floor(per / 4);
      if (land.feature[t] === Feature.Rock) per = Math.floor(per / 2);
      // Bare worlds grow no grass until terraforming brings it (moss gives a few tufts).
      const life = land.life[t] as number;
      if (life < 3) per = life === 2 ? Math.floor(per / 4) : 0;
      per = Math.round(per * density * (this.cover ? Math.min(1, 0.1 + (this.cover.cover[t] as number) / 230) : 1));
      const up = this.frames.dir(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      const base = this.frames.pos(t, -0.02);
      for (let i = 0; i < per && n < MAX; i++) {
        const h1 = SurfaceFrames.hash(t, i * 5 + 11);
        const h2 = SurfaceFrames.hash(t, i * 5 + 12);
        const h3 = SurfaceFrames.hash(t, i * 5 + 13);
        const r = Math.sqrt(h1) * 1.7;
        const a = h2 * Math.PI * 2;
        ground(p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r), t);
        // No grass on the road surface itself.
        const fx = p.x / p.length();
        const fy = p.y / p.length();
        const fz = p.z / p.length();
        if (this.frames.field.roadDistance(fx, fy, fz, t) < ROAD_HALF + 0.06 || this.frames.field.riverEdge(fx, fy, fz, t) < 0.05) continue;
        this.frames.orient(p, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h3 * 6.28));
        const sc = 0.6 + h3 * 0.7;
        s.set(sc, sc * (0.8 + h1 * 0.5), sc);
        m.compose(p, q, s);
        this.tufts.setMatrixAt(n, m);
        c.setHSL(0.25 + hue + (h2 - 0.5) * 0.04, 0.4, 0.42 + h3 * 0.14);
        c.multiplyScalar(1.7);
        this.tufts.setColorAt(n, c);
        n++;
        if (h3 < bloom && f < this.flowers.instanceMatrix.count) {
          m.compose(p, q, s.set(1, 0.8 + h1 * 0.6, 1));
          this.flowers.setMatrixAt(f, m);
          this.flowers.setColorAt(f, flowerColors[Math.floor(h2 * flowerColors.length) % flowerColors.length] as THREE.Color);
          f++;
        }
      }
    }
    // Pebbles on every land tile: a few in grass, more on rocky, dry and sandy ground.
    for (const t of tiles) {
      if (!land.isLand(t) || land.use[t] === Use.Building || hiddenAt(this.mask, t)) continue;
      const b = terrain.biome[t] as Biome;
      let per = land.feature[t] === Feature.Rock ? 10 : b === Biome.Steppe || b === Biome.Beach || b === Biome.Tundra ? 5 : 2;
      if (land.use[t] === Use.Road) per += 3;
      per = Math.round(per * density * (this.cover ? Math.min(1, 0.1 + (this.cover.cover[t] as number) / 230) : 1));
      const up = this.frames.dir(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      const base = this.frames.pos(t);
      for (let i = 0; i < per && st < this.pebbles.instanceMatrix.count; i++) {
        const h1 = SurfaceFrames.hash(t, i * 7 + 301);
        const h2 = SurfaceFrames.hash(t, i * 7 + 302);
        const h3 = SurfaceFrames.hash(t, i * 7 + 303);
        const r = Math.sqrt(h1) * 1.75;
        const a = h2 * Math.PI * 2;
        ground(p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r), t);
        this.frames.orient(p, null, q);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h3 * 6.28));
        const sc = 0.5 + h3 * h3 * 1.6;
        m.compose(p, q, s.set(sc, sc, sc));
        this.pebbles.setMatrixAt(st, m);
        this.pebbles.setColorAt(st, stoneColors[Math.floor(h1 * 97) % stoneColors.length] as THREE.Color);
        st++;
      }
    }
    // Autumn: leaves under and around trees.
    let lv = 0;
    const leafColors = ["#c8742e", "#d99a3a", "#a94a2a", "#b8862f", "#8a5a2a"].map((x) => new THREE.Color(x));
    for (const t of tiles) {
      const autumn = this.autumnAt(t);
      if (autumn < 0.15 || !land.isLand(t) || hiddenAt(this.mask, t)) continue;
      const nearTree = land.feature[t] === Feature.Tree || land.planet.grid.neighborsOf(t).some((x) => land.feature[x] === Feature.Tree);
      if (!nearTree) continue;
      const per = Math.round((land.feature[t] === Feature.Tree ? 26 : 8) * autumn * density);
      const up = this.frames.dir(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      const base = this.frames.pos(t);
      for (let i = 0; i < per && lv < this.leaves.instanceMatrix.count; i++) {
        const h1 = SurfaceFrames.hash(t, i * 5 + 501);
        const h2 = SurfaceFrames.hash(t, i * 5 + 502);
        const h3 = SurfaceFrames.hash(t, i * 5 + 503);
        const r = Math.sqrt(h1) * 1.7;
        const a = h2 * Math.PI * 2;
        ground(p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r), t);
        p.addScaledVector(up, 0.025);
        this.frames.orient(p, null, q);
        q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((h3 - 0.5) * 0.5, h3 * 6.28, (h1 - 0.5) * 0.5)));
        m.compose(p, q, s.set(1, 1, 1).multiplyScalar(0.8 + h3 * 0.6));
        this.leaves.setMatrixAt(lv, m);
        this.leaves.setColorAt(lv, leafColors[Math.floor(h2 * 97) % leafColors.length] as THREE.Color);
        lv++;
      }
    }
    this.tufts.count = n;
    this.flowers.count = f;
    this.pebbles.count = st;
    this.leaves.count = lv;
    for (const mesh of [this.tufts, this.flowers, this.pebbles, this.leaves]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [this.tufts, this.flowers, this.pebbles, this.leaves]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
