import * as THREE from "three/webgpu";
import { abs, attribute, dot, float, min, mix, positionWorld, pow, sin, smoothstep, time, uniform, vec3 } from "three/tsl";
import { rgb } from "./painterly";
import type { LandUse } from "../sim/econ/landuse";
import type { SurfaceFrames } from "./frames";

/**
 * Rivers as flowing ribbons that widen downstream, and lakes as flat water at their spill
 * height. Rivers run from tile centre to the tile they drain into, on into the sea.
 */
export class RiverView {
  readonly group = new THREE.Group();
  private readonly riverMat: THREE.MeshBasicNodeMaterial;
  private readonly lakeMat: THREE.MeshBasicNodeMaterial;
  private readonly u = { day: uniform(1), sky: uniform(new THREE.Color("#8fb6d8")) };

  constructor(land: LandUse, frames: SurfaceFrames) {
    const u = this.u;
    this.riverMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.riverMat.polygonOffset = true;
    this.riverMat.polygonOffsetFactor = -3;
    this.riverMat.polygonOffsetUnits = -8;
    const along = attribute("aAlong", "float");
    const across = attribute("aAcross", "float");
    const width = attribute("aWidth", "float");
    const fogR = attribute("aFog", "float");
    const edge = float(1).sub(abs(across));
    const ripple = sin(along.mul(7).sub(time.mul(2.4)).add(across.mul(2))).mul(0.5).add(0.5);
    const ripple2 = sin(along.mul(13).sub(time.mul(3.7)).sub(across.mul(3))).mul(0.5).add(0.5);
    let rc = mix(vec3(0.35, 0.62, 0.62), vec3(0.12, 0.34, 0.45), smoothstep(0, 0.8, edge).mul(min(width, 1)));
    rc = rc.add(vec3(0.9, 0.95, 1.0).mul(pow(ripple.mul(ripple2), 6)).mul(0.35));
    rc = mix(rc, rgb(u.sky), 0.18).mul(mix(0.3, 1, u.day));
    rc = mix(rc, rc.mul(0.15), smoothstep(0.55, 1, fogR));
    this.riverMat.colorNode = rc;
    this.riverMat.opacityNode = smoothstep(0, 0.35, edge).mul(0.9);

    this.lakeMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const fogL = attribute("aFog", "float");
    const w = positionWorld;
    const r = sin(dot(w, vec3(1.3, 0.7, 1.1)).mul(2.2).add(time.mul(0.9))).mul(sin(dot(w, vec3(-0.6, 1.2, 0.8)).mul(3.1).sub(time.mul(0.7))));
    let lc = mix(vec3(0.16, 0.38, 0.46), rgb(u.sky), 0.25).add(vec3(r.mul(0.03)));
    lc = lc.mul(mix(0.3, 1, u.day));
    lc = mix(lc, lc.mul(0.15), smoothstep(0.55, 1, fogL));
    this.lakeMat.colorNode = lc;
    this.lakeMat.opacityNode = float(0.88);
    this.group.add(this.buildRivers(land, frames), this.buildLakes(land));
    this.group.name = "rivers";
  }

  /** Tile index per vertex, for fog. */
  readonly riverTiles: number[] = [];
  readonly lakeTiles: number[] = [];

  private buildRivers(land: LandUse, frames: SurfaceFrames): THREE.Mesh {
    const pos: number[] = [];
    const along: number[] = [];
    const across: number[] = [];
    const width: number[] = [];
    const idx: number[] = [];
    const up = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let t = 0; t < land.soil.length; t++) {
      if (!land.isRiver(t)) continue;
      const to = land.hydro.flowTo[t] as number;
      if (to < 0) continue;
      // Fill the carved bed to about 60% of its depth; the surface spans the bed at that level.
      const field = frames.field;
      const unit = field.spacing * field.R;
      const pa = field.riverProfile(t);
      const pb = land.isRiver(to) ? field.riverProfile(to) : pa;
      const w0 = pa.width * 1.5 * unit;
      const w1 = land.isLand(to) ? pb.width * 1.5 * unit : w0 * 1.6;
      const lift0 = pa.depth * 0.6;
      const lift1 = land.isLand(to) ? pb.depth * 0.6 : 0.07;
      const seg = 5;
      const base = pos.length / 3;
      for (let k = 0; k <= seg; k++) {
        const f = k / seg;
        const lift = lift0 + (lift1 - lift0) * f;
        frames.between(t, to, f, lift, p);
        frames.between(t, to, Math.min(1, f + 0.05), lift, q);
        up.copy(p).normalize();
        dir.copy(q).sub(p);
        if (k === seg) {
          frames.between(t, to, f - 0.05, lift, q);
          dir.copy(p).sub(q);
        }
        side.crossVectors(dir, up).normalize();
        const w = w0 + (w1 - w0) * f;
        for (const s of [-1, 1]) {
          const v = p.clone().addScaledVector(side, s * w);
          pos.push(v.x, v.y, v.z);
          along.push(t * 0.37 + f * 1.2);
          across.push(s);
          width.push(w);
          this.riverTiles.push(f < 0.5 ? t : to);
        }
        if (k > 0) {
          const o = base + (k - 1) * 2;
          // Counter-clockwise seen from above (front faces up).
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
    g.setAttribute("aWidth", new THREE.Float32BufferAttribute(width, 1));
    g.setAttribute("aFog", new THREE.Float32BufferAttribute(new Float32Array(width.length), 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.riverMat);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildLakes(land: LandUse): THREE.Mesh {
    const { grid } = land.planet;
    const R = land.planet.params.radius;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let t = 0; t < grid.count; t++) {
      if (!land.hydro.lake[t]) continue;
      const r = R + (land.hydro.lakeLevel[t] as number);
      const base = pos.length / 3;
      pos.push((grid.center[t * 3] as number) * r, (grid.center[t * 3 + 1] as number) * r, (grid.center[t * 3 + 2] as number) * r);
      this.lakeTiles.push(t);
      const cs = grid.cornersOf(t);
      for (const c of cs) {
        pos.push((grid.corners[c * 3] as number) * r, (grid.corners[c * 3 + 1] as number) * r, (grid.corners[c * 3 + 2] as number) * r);
        this.lakeTiles.push(t);
      }
      for (let k = 0; k < cs.length; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % cs.length));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aFog", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.lakeMat);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return mesh;
  }

  update(_time: number, daylight: number, sky: THREE.Color): void {
    this.u.day.value = daylight;
    this.u.sky.value.copy(sky);
  }

  /** Fog of war: per-tile values (0 seen, 0.5 remembered, 1 unknown). */
  setFog(value: (t: number) => number): void {
    const [rivers, lakes] = this.group.children as THREE.Mesh[];
    for (const [mesh, tiles] of [[rivers, this.riverTiles], [lakes, this.lakeTiles]] as const) {
      const attr = (mesh as THREE.Mesh).geometry.getAttribute("aFog") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < tiles.length; i++) arr[i] = value(tiles[i] as number);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.riverMat.dispose();
    this.lakeMat.dispose();
  }
}
