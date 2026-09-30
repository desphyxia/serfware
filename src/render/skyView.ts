import * as THREE from "three/webgpu";
import { attribute, mx_noise_float, positionWorld, smoothstep, vec3 } from "three/tsl";
import { Region } from "../sim/biomes/regions";
import type { Economy } from "../sim/econ/economy";
import { Feature } from "../sim/econ/landuse";
import type { SurfaceFrames } from "./frames";
import { hiddenAt, type FogMask } from "./fogMask";
import { cableGeometry, gliderGeometry, gondolaGeometry, skiffGeometry, skyIslandGeometry } from "./models";
import { PainterlyMaterial } from "./painterly";
import type { Emitter } from "./smoke";

const UP = new THREE.Vector3(0, 1, 0);
/** How high the islands float above the peak under them, world units. */
const FLOAT = 11;

/**
 * The Skyreef and the mire's air: floating islands drifting on the high winds, ropeway cables
 * and gondolas up to them, skiffs and gliders circling, a cloud sea lapping the high slopes, and
 * spores drifting up from the glowcaps.
 */
export class SkyView {
  readonly group = new THREE.Group();
  private readonly mat = new PainterlyMaterial({ vertexColors: true, flatShading: true, brush: 0.6 });
  private readonly islands: THREE.InstancedMesh;
  private readonly cables: THREE.InstancedMesh;
  private readonly gondolas: THREE.InstancedMesh;
  private readonly skiffs: THREE.InstancedMesh;
  private readonly gliders: THREE.InstancedMesh;
  private readonly clouds: THREE.Mesh | null;
  /** Smoothed display direction of each island (it drifts a tile at a time in the sim). */
  private readonly shown = new Map<number, THREE.Vector3>();
  private readonly emitters = new Map<string, Emitter>();

  constructor(
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
    private readonly mask: FogMask,
  ) {
    const make = (g: THREE.BufferGeometry, n: number, material: THREE.Material = this.mat) => {
      const m = new THREE.InstancedMesh(g, material, n);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.islands = make(skyIslandGeometry(), 8);
    this.cables = make(cableGeometry(), 32);
    this.cables.castShadow = false;
    this.gondolas = make(gondolaGeometry(), 32);
    this.skiffs = make(skiffGeometry(), 16);
    const wingMat = new PainterlyMaterial({ vertexColors: true, side: THREE.DoubleSide, brush: 0.3 });
    this.gliders = make(gliderGeometry(), 32, wingMat);
    this.clouds = this.buildClouds();
    if (this.clouds) this.group.add(this.clouds);
    this.group.name = "sky";
  }

  /** A soft cloud sea over and around the Skyreef, below the peaks, which break through it. */
  private buildClouds(): THREE.Mesh | null {
    const land = this.eco.land;
    const grid = land.planet.grid;
    const weight = new Float32Array(grid.count);
    let front: number[] = [];
    for (let t = 0; t < grid.count; t++) if (land.region[t] === Region.Skyreef) {
      weight[t] = 1;
      front.push(t);
    }
    if (!front.length) return null;
    for (let d = 1; d <= 5 && front.length; d++) {
      const next: number[] = [];
      for (const t of front) for (const n of grid.neighborsOf(t)) if (weight[n] === 0) {
        weight[n] = 1 - d / 6;
        next.push(n);
      }
      front = next;
    }
    const cornerTiles = new Map<number, number[]>();
    for (let t = 0; t < grid.count; t++) {
      if (!weight[t]) continue;
      for (const c of grid.cornersOf(t)) {
        if (cornerTiles.has(c)) continue;
        const ts: number[] = [];
        for (const n of [t, ...grid.neighborsOf(t)]) if (grid.cornersOf(n).includes(c)) ts.push(n);
        cornerTiles.set(c, ts);
      }
    }
    const R = this.frames.field.R;
    const h = land.planet.terrain.params.mountainHeight * 0.62;
    const pos: number[] = [];
    const w: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (let t = 0; t < grid.count; t++) {
      if (!weight[t]) continue;
      const base = pos.length / 3;
      this.frames.dir(t, v).multiplyScalar(R + h);
      pos.push(v.x, v.y, v.z);
      w.push(weight[t] as number);
      const cs = grid.cornersOf(t);
      for (const c of cs) {
        v.set(grid.corners[c * 3] as number, grid.corners[c * 3 + 1] as number, grid.corners[c * 3 + 2] as number).normalize().multiplyScalar(R + h);
        pos.push(v.x, v.y, v.z);
        // Corners take the mean of the tiles meeting there, so the sheet fades out smoothly.
        const around = cornerTiles.get(c) ?? [t];
        w.push((around.reduce((a, x) => a + (weight[x] as number), 0) / around.length) * 0.85);
      }
      for (let k = 0; k < cs.length; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % cs.length));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aW", new THREE.Float32BufferAttribute(w, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
    const p = positionWorld;
    const billow = mx_noise_float(p.mul(0.12)).mul(0.6).add(mx_noise_float(p.mul(0.4)).mul(0.3));
    mat.colorNode = vec3(0.93, 0.94, 0.97).mul(billow.mul(0.1).add(0.95));
    mat.opacityNode = attribute("aW", "float").mul(smoothstep(-0.35, 0.35, billow)).mul(0.85);
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  update(time: number, dt: number, focus: THREE.Vector3): Emitter[] {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3();
    let ni = 0;
    let ns = 0;
    let ng = 0;
    const isleAt = new Map<number, THREE.Vector3>();
    for (const isle of this.eco.skyIslands()) {
      const target = this.frames.dir(isle.at);
      let d = this.shown.get(isle.id);
      if (!d) this.shown.set(isle.id, (d = target.clone()));
      d.lerp(target, Math.min(1, dt * 0.05)).normalize();
      const bob = Math.sin(time * 0.3 + isle.id * 2) * 0.35;
      p.copy(d).multiplyScalar(this.frames.radius(isle.home) + FLOAT + bob);
      isleAt.set(isle.id, p.clone());
      if (hiddenAt(this.mask, isle.at)) continue;
      this.frames.orient(p, null, q);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, isle.id * 1.7 + time * 0.01));
      // Islands shrink a little as their stone is hauled down.
      const sc = 0.7 + 0.3 * Math.min(1, isle.stone / 40);
      m.compose(p, q, new THREE.Vector3(sc, sc, sc));
      this.islands.setMatrixAt(ni++, m);
      // Skiffs and gliders circle the island.
      up.copy(p).normalize();
      const east = new THREE.Vector3().crossVectors(UP, up).normalize();
      const north = new THREE.Vector3().crossVectors(up, east);
      for (let k = 0; k < 2 && ns < this.skiffs.instanceMatrix.count; k++) {
        const a = time * 0.12 + k * Math.PI + isle.id;
        const at = p.clone().addScaledVector(east, Math.cos(a) * 6).addScaledVector(north, Math.sin(a) * 6).addScaledVector(up, -1.5 + k);
        const ahead = p.clone().addScaledVector(east, Math.cos(a + 0.1) * 6).addScaledVector(north, Math.sin(a + 0.1) * 6).addScaledVector(up, -1.5 + k);
        this.frames.orient(at, ahead, q);
        m.compose(at, q, one);
        this.skiffs.setMatrixAt(ns++, m);
      }
      for (let k = 0; k < 4 && ng < this.gliders.instanceMatrix.count; k++) {
        const r = 8 + k * 1.6;
        const a = -time * (0.25 - k * 0.03) + k * 1.6 + isle.id;
        const at = p.clone().addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r).addScaledVector(up, 1 + Math.sin(time * 0.5 + k) * 1.5);
        const ahead = p.clone().addScaledVector(east, Math.cos(a - 0.1) * r).addScaledVector(north, Math.sin(a - 0.1) * r).addScaledVector(up, 1 + Math.sin(time * 0.5 + k) * 1.5);
        this.frames.orient(at, ahead, q);
        // Bank into the turn.
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.45));
        m.compose(at, q, new THREE.Vector3(1.4, 1.4, 1.4));
        this.gliders.setMatrixAt(ng++, m);
      }
    }
    // Ropeways: a cable from each working station up to its island, a gondola riding it.
    let nc = 0;
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built || b.def.job !== "ropeway" || nc >= this.cables.instanceMatrix.count) continue;
      const isle = this.eco.islandNear(b.tile, b.def.radius ?? 3);
      if (!isle) continue;
      const top = this.frames.pos(b.tile, 2.8);
      const under = (isleAt.get(isle.id) ?? top).clone();
      under.addScaledVector(under.clone().normalize(), -2.5);
      const span = under.clone().sub(top);
      const len = span.length();
      q.setFromUnitVectors(UP, span.clone().normalize());
      m.compose(top, q, new THREE.Vector3(1, len, 1));
      this.cables.setMatrixAt(nc, m);
      const f = 0.5 - 0.5 * Math.cos(time * 0.25 + b.id);
      const g = top.clone().addScaledVector(span, f);
      this.frames.orient(g, g.clone().add(span), q);
      m.compose(g, q, one);
      this.gondolas.setMatrixAt(nc, m);
      nc++;
    }
    for (const [mesh, n] of [
      [this.islands, ni],
      [this.skiffs, ns],
      [this.gliders, ng],
      [this.cables, nc],
      [this.gondolas, nc],
    ] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    return this.spores(focus);
  }

  /** Spores rising from glowcaps near the view. */
  private spores(focus: THREE.Vector3): Emitter[] {
    const land = this.eco.land;
    const out: Emitter[] = [];
    const at = land.planet.grid.nearestTile([focus.x, focus.y, focus.z], 0);
    for (const t of [at, ...land.ring(at, 7)]) {
      if (out.length >= 14) break;
      if (land.feature[t] !== Feature.Glowcap || (land.amount[t] as number) < 3 || hiddenAt(this.mask, t)) continue;
      let e = this.emitters.get(`s${t}`);
      if (!e) {
        e = { pos: this.frames.pos(t, 0.3), rate: 3, kind: "spore" };
        this.emitters.set(`s${t}`, e);
      }
      out.push(e);
    }
    if (this.emitters.size > 200) this.emitters.clear();
    return out;
  }

  dispose(): void {
    for (const mesh of [this.islands, this.cables, this.gondolas, this.skiffs, this.gliders]) mesh.geometry.dispose();
    this.clouds?.geometry.dispose();
    this.mat.dispose();
  }
}
