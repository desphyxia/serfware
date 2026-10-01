import * as THREE from "three/webgpu";
import { Feature, Use, type LandUse } from "../sim/econ/landuse";
import { Biome } from "../sim/planet/terrain";
import { hiddenAt, type FogMask } from "./fogMask";
import { SurfaceFrames } from "./frames";
import { PainterlyMaterial } from "./painterly";
import { ROAD_HALF } from "./terrain/field";

const MAX = 6000;
/** Ring radius in tiles at full vegetation; Low draws a smaller ring. */
const RING = 18;

/** A soft bush: a few rounded lumps with outward-leaning normals, darker underneath. */
export function bushGeometry(): THREE.BufferGeometry {
  const lumps: [number, number, number, number][] = [
    [0, 0.16, 0, 0.2],
    [0.14, 0.12, 0.05, 0.14],
    [-0.12, 0.11, -0.04, 0.15],
    [0.02, 0.1, -0.14, 0.13],
  ];
  const geos = lumps.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z).toNonIndexed());
  const out = new THREE.BufferGeometry();
  const count = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  const c = new THREE.Vector3(0, 0.12, 0);
  const v = new THREE.Vector3();
  for (const g of geos) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++, o++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      pos.set([v.x, v.y, v.z], o * 3);
      v.sub(c).normalize();
      nor.set([v.x, v.y, v.z], o * 3);
      const k = 0.6 + 0.4 * (v.y * 0.5 + 0.5);
      col.set([k, k, k], o * 3);
    }
  }
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

function boulderGeometry(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.22, 0).toNonIndexed();
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * (1 + Math.sin(i * 1.7) * 0.08), y * 0.7 + 0.1, p.getZ(i));
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.72 + 0.28 * Math.min(1, Math.max(0, p.getY(i) / 0.25));
    col.set([k, k, k], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** A clump of reeds: tall thin blades with brown seed heads. */
function reedGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996;
    const r = 0.03 + (i % 3) * 0.035;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.45 + (i % 4) * 0.08;
    const lean = 0.06;
    const tx = x + Math.cos(a) * lean;
    const tz = z + Math.sin(a) * lean;
    const w = 0.012;
    pos.push(x - w, 0, z, x + w, 0, z, tx, h, tz);
    col.push(0.3, 0.42, 0.2, 0.3, 0.42, 0.2, 0.62, 0.66, 0.36);
    if (i % 3 === 0) {
      // Seed head: a small dark spindle near the tip.
      pos.push(tx - 0.018, h - 0.14, tz, tx + 0.018, h - 0.14, tz, tx, h + 0.02, tz);
      col.push(0.35, 0.24, 0.14, 0.35, 0.24, 0.14, 0.45, 0.32, 0.2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A fern: arching fronds from a crown, tapering to their tips, drawn from both sides. */
function fernGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
    const len = 0.32 + (i % 3) * 0.06;
    const pt = (f: number, side: number): [number, number, number] => {
      const r = f * len;
      const h = (0.9 * f - 0.75 * f * f) * len;
      const w = Math.sin(Math.PI * Math.min(1, f * 1.05)) * 0.055 * side;
      return [Math.cos(a) * r - Math.sin(a) * w, h + Math.abs(w) * 0.25, Math.sin(a) * r + Math.cos(a) * w];
    };
    for (let k = 0; k < 4; k++) {
      const f0 = k / 4;
      const f1 = (k + 1) / 4;
      for (const side of [-1, 1]) {
        const tri = [pt(f0, 0), pt(f0, side), pt(f1, side), pt(f0, 0), pt(f1, side), pt(f1, 0)];
        for (const t of [...tri, ...[tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]]]) {
          pos.push(...(t as [number, number, number]));
          const k2 = 0.55 + 0.45 * f1;
          col.push(0.2 * k2, 0.36 * k2, 0.13 * k2);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Mid-distance undergrowth around the camera focus, by biome: ferns and dark bushes under
 * forests, heather on tundra, grey-green sage scrub on steppe and desert, boulders on rocky and
 * dry ground (sandy in deserts, lichened in the cold), reeds along rivers, lakes and marshes. Like the grass, the layout per
 * tile is fixed (hash-based), so nothing reshuffles as the camera moves.
 */
export class Undergrowth {
  readonly group = new THREE.Group();
  private readonly bushes: THREE.InstancedMesh;
  private readonly boulders: THREE.InstancedMesh;
  private readonly reeds: THREE.InstancedMesh;
  private readonly ferns: THREE.InstancedMesh;
  private centerTile = -1;
  private key = "";
  /** Ground cover (0..255) from the ecology: burnt ground is bare until it regrows. */
  cover: { cover: Uint8Array; groundVersion: number } | null = null;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
    private readonly mask: FogMask,
  ) {
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number, shadow: boolean) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      this.group.add(mesh);
      return mesh;
    };
    this.bushes = mk(bushGeometry(), new PainterlyMaterial({ vertexColors: true, wind: 0.5, brush: 1.2 }), MAX, true);
    this.boulders = mk(boulderGeometry(), new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 1 }), MAX / 2, true);
    this.reeds = mk(reedGeometry(), new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, wind: 0.6, brush: 0.4 }), MAX, false);
    this.ferns = mk(fernGeometry(), new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, wind: 0.5, brush: 0.6 }), MAX, false);
    this.group.name = "undergrowth";
  }

  update(focus: THREE.Vector3, closeness: number, density: number): void {
    const visible = closeness > 0.12;
    this.group.visible = visible;
    if (!visible) return;
    const grid = this.land.planet.grid;
    const t = grid.nearestTile([focus.x, focus.y, focus.z], this.centerTile >= 0 ? this.centerTile : 0);
    const key = `${this.land.useVersion}:${this.land.featureVersion}:${this.land.lifeVersion}:${density}:${this.mask.version}:${this.cover?.groundVersion ?? 0}`;
    if (this.centerTile >= 0 && key === this.key) {
      const d = this.frames.dir(t).dot(this.frames.dir(this.centerTile));
      if (d > Math.cos(this.land.spacing * 5)) return;
    }
    this.centerTile = t;
    this.key = key;
    this.rebuild(t, density);
  }

  private rebuild(center: number, density: number): void {
    const land = this.land;
    const { terrain, grid } = land.planet;
    const tiles = [center, ...land.ring(center, Math.round(RING * (0.55 + 0.45 * Math.min(1, density))))];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);
    const wet = (t: number) => !land.isLand(t) || land.hydro.lake[t] === 1 || land.isRiver(t);
    let nb = 0;
    let nr = 0;
    let nd = 0;
    let nf = 0;
    for (const t of tiles) {
      if (!land.isLand(t) || land.hydro.lake[t] || land.use[t] === Use.Building || land.use[t] === Use.Flag || (land.life[t] as number) < 3 || hiddenAt(this.mask, t)) continue;
      const b = terrain.biome[t] as Biome;
      const feature = land.feature[t] as Feature;
      const road = land.use[t] === Use.Road;
      const field = feature === Feature.Field;
      let bushes = b === Biome.Forest || b === Biome.DeepForest ? 1.6 : b === Biome.Meadow ? 0.7 : b === Biome.Marsh ? 1.2 : b === Biome.Steppe ? 0.6 : b === Biome.Tundra ? 1.1 : b === Biome.Desert ? 0.3 : b === Biome.Beach ? 0.15 : 0;
      let ferns = b === Biome.DeepForest ? 3.5 : b === Biome.Forest ? 2.2 : b === Biome.Marsh ? 1 : feature === Feature.Tree ? 1 : 0;
      let boulders = feature === Feature.Rock ? 2.5 : b === Biome.Rock ? 1.5 : b === Biome.Tundra ? 0.8 : b === Biome.Steppe ? 0.4 : 0.12;
      const shore = wet(t) || grid.neighborsOf(t).some(wet);
      let reeds = b === Biome.Marsh ? 3 : shore ? 2.5 : 0;
      // Burnt ground: nothing but a few blackened boulders until it greens again.
      const green = this.cover ? Math.min(1, (this.cover.cover[t] as number) / 200) : 1;
      bushes *= green;
      ferns *= green;
      reeds *= 0.3 + 0.7 * green;
      if (road || field) {
        bushes *= 0.2;
        ferns *= 0.1;
        boulders *= 0.2;
        reeds *= 0.3;
      }
      const up = this.frames.dir(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(up);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = up.clone().cross(tA);
      const base = this.frames.pos(t);
      const place = (salt: number, reach: number) => {
        const h1 = SurfaceFrames.hash(t, salt);
        const h2 = SurfaceFrames.hash(t, salt + 1);
        const r = Math.sqrt(h1) * reach;
        const a = h2 * Math.PI * 2;
        p.copy(base).addScaledVector(tA, Math.cos(a) * r).addScaledVector(tB, Math.sin(a) * r);
        const d = p.clone().normalize();
        p.copy(d).multiplyScalar(this.frames.groundAt(d, t) - 0.02);
        this.frames.orient(p, null, q);
        q.multiply(turn.setFromAxisAngle(Y, SurfaceFrames.hash(t, salt + 2) * 6.28));
        // Keep the road surface and open water clear (-1 = skip); reeds stand at the waterline.
        const field = this.frames.field;
        if (field.roadDistance(d.x, d.y, d.z, t) < ROAD_HALF + 0.25) return -1;
        const edge = field.riverEdge(d.x, d.y, d.z, t);
        if (salt >= 3000 && salt < 4000 ? edge < -0.35 : edge < 0.2) return -1;
        if (p.length() < field.R + 0.05) return -1;
        return SurfaceFrames.hash(t, salt + 3);
      };
      const count = (x: number, salt: number) => Math.floor(x * density + SurfaceFrames.hash(t, salt));
      for (let i = 0, n = count(bushes, 901); i < n && nb < MAX; i++) {
        const h = place(1000 + i * 7, 1.6);
        if (h < 0) continue;
        const sc = 0.7 + h * 0.9;
        m.compose(p, q, s.set(sc, sc * (0.8 + h * 0.4), sc));
        this.bushes.setMatrixAt(nb, m);
        if (b === Biome.Tundra) c.setHSL(0.93 + h * 0.06, 0.28, 0.2 + h * 0.06);
        else if (b === Biome.Steppe || b === Biome.Desert || b === Biome.Beach) c.setHSL(0.17 + h * 0.05, 0.22, 0.24 + h * 0.08);
        else c.setHSL(0.27 + (h - 0.5) * 0.06 + (b === Biome.Marsh ? 0.03 : 0), 0.5, (b === Biome.DeepForest ? 0.1 : 0.13) + h * 0.07);
        this.bushes.setColorAt(nb++, c);
      }
      for (let i = 0, n = count(boulders, 902); i < n && nd < MAX / 2; i++) {
        const h = place(2000 + i * 7, 1.7);
        if (h < 0) continue;
        const sc = 0.6 + h * h * 2.2;
        m.compose(p, q, s.set(sc, sc * (0.7 + h * 0.5), sc * (0.8 + h * 0.3)));
        this.boulders.setMatrixAt(nd, m);
        if (b === Biome.Desert || b === Biome.Beach) c.setHSL(0.08, 0.3 + h * 0.1, 0.55 + h * 0.1);
        else if (b === Biome.Tundra || b === Biome.Snow) c.setHSL(0.2, 0.1 + h * 0.08, 0.48 + h * 0.1);
        else c.setHSL(0.09, 0.06 + h * 0.05, 0.5 + h * 0.12);
        this.boulders.setColorAt(nd++, c);
      }
      for (let i = 0, n = count(ferns, 904); i < n && nf < MAX; i++) {
        const h = place(4000 + i * 7, 1.7);
        if (h < 0) continue;
        const sc = 0.7 + h * 0.8;
        m.compose(p, q, s.set(sc, sc * (0.8 + h * 0.4), sc));
        this.ferns.setMatrixAt(nf, m);
        c.setRGB(0.95, 1, 0.9).multiplyScalar(0.7 + h * 0.4);
        this.ferns.setColorAt(nf++, c);
      }
      for (let i = 0, n = count(reeds, 903); i < n && nr < MAX; i++) {
        const h = place(3000 + i * 7, 1.75);
        if (h < 0) continue;
        const sc = 0.8 + h * 0.8;
        m.compose(p, q, s.set(sc, sc, sc));
        this.reeds.setMatrixAt(nr, m);
        c.setRGB(1, 1, 1).multiplyScalar(1.3 + h * 0.4);
        this.reeds.setColorAt(nr++, c);
      }
    }
    this.bushes.count = nb;
    this.boulders.count = nd;
    this.reeds.count = nr;
    this.ferns.count = nf;
    for (const mesh of [this.bushes, this.boulders, this.reeds, this.ferns]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [this.bushes, this.boulders, this.reeds, this.ferns]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
