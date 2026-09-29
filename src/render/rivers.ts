import * as THREE from "three/webgpu";
import { abs, attribute, dot, float, min, mix, positionWorld, pow, sin, smoothstep, time, uniform, vec3 } from "three/tsl";
import { rgb } from "./painterly";
import type { LandUse } from "../sim/econ/landuse";
import type { SurfaceFrames } from "./frames";
import { RIVER_SURFACE } from "./terrain/field";

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
    const field = frames.field;
    const R = field.R;
    const unit = field.spacing * R;
    const { hydro } = land;
    const pt = new THREE.Vector3();
    const side = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    let alongBase = 0;
    // The same smoothed courses the terrain carves its beds along.
    for (const samples of field.rivers) {
      const base = pos.length / 3;
      samples.forEach((smp, i) => {
        const tile = smp.tile;
        // Water level: the carved bed (ignoring pads and roads) plus the water depth; at the
        // mouth it settles to sea or lake level.
        const bed = field.height(smp.d.x, smp.d.y, smp.d.z, tile, null, false, false).h;
        const level = smp.wet ? Math.max(0, hydro.lake[tile] ? (hydro.lakeLevel[tile] as number) : 0) + 0.05 : Math.max(0.03, bed + smp.depth * 0.5);
        pt.copy(smp.d).multiplyScalar(R + level);
        const prev = samples[Math.max(0, i - 1)]!.d;
        const next = samples[Math.min(samples.length - 1, i + 1)]!.d;
        fwd.copy(next).sub(prev);
        side.crossVectors(fwd, smp.d).normalize();
        const w = smp.width * RIVER_SURFACE * unit * (smp.wet ? 1.4 : 1);
        for (const sg of [-1, 1]) {
          const v = pt.clone().addScaledVector(side, sg * w);
          pos.push(v.x, v.y, v.z);
          along.push(alongBase + i * 0.15);
          across.push(sg);
          width.push(w);
          this.riverTiles.push(tile);
        }
        if (i > 0) {
          const o = base + (i - 1) * 2;
          // Counter-clockwise seen from above (front faces up).
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      });
      alongBase += samples.length * 0.15 + 3.7;
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
    // Corners on the shore push outward, so the water runs under the rising bank and the
    // ground (not the hex outline) draws the shoreline.
    const cornerTiles = new Map<number, number[]>();
    for (let t = 0; t < grid.count; t++) for (const c of grid.cornersOf(t)) {
      let l = cornerTiles.get(c);
      if (!l) cornerTiles.set(c, (l = []));
      l.push(t);
    }
    const spacing = Math.sqrt((4 * Math.PI) / grid.count);
    const corner = (c: number, out: THREE.Vector3) => {
      out.set(grid.corners[c * 3] as number, grid.corners[c * 3 + 1] as number, grid.corners[c * 3 + 2] as number);
      const ts = cornerTiles.get(c) ?? [];
      const lakes = ts.filter((x) => land.hydro.lake[x]);
      if (lakes.length === ts.length || lakes.length === 0) return out;
      const mid = new THREE.Vector3();
      for (const x of lakes) mid.add(new THREE.Vector3(...grid.centerOf(x)));
      mid.multiplyScalar(1 / lakes.length);
      return out.addScaledVector(out.clone().sub(mid).normalize(), spacing * 0.45).normalize();
    };
    const cv = new THREE.Vector3();
    for (let t = 0; t < grid.count; t++) {
      if (!land.hydro.lake[t]) continue;
      const r = R + (land.hydro.lakeLevel[t] as number);
      const base = pos.length / 3;
      pos.push((grid.center[t * 3] as number) * r, (grid.center[t * 3 + 1] as number) * r, (grid.center[t * 3 + 2] as number) * r);
      this.lakeTiles.push(t);
      const cs = grid.cornersOf(t);
      for (const c of cs) {
        corner(c, cv).multiplyScalar(r);
        pos.push(cv.x, cv.y, cv.z);
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
