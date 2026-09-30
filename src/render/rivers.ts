import * as THREE from "three/webgpu";
import { abs, attribute, float, mrt, smoothstep, vec4 } from "three/tsl";
import { waterNodes, type WaterUniforms } from "./waterShade";
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
  constructor(
    land: LandUse,
    frames: SurfaceFrames,
    u: WaterUniforms,
  ) {
    // Rivers: small ripples drifting downstream, foam at bends and mouths, soft outer edge.
    this.riverMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    this.riverMat.polygonOffset = true;
    this.riverMat.polygonOffsetFactor = -3;
    this.riverMat.polygonOffsetUnits = -8;
    const across = attribute("aAcross", "float");
    const river = waterNodes(u, {
      flow: attribute("aFlow", "vec3"),
      speed: float(1),
      fog: attribute("aFog", "float"),
      foam: attribute("aFoam", "float").mul(smoothstep(0.3, 1, abs(across)).mul(0.6).add(0.4)),
      scale: 2.2,
    });
    this.riverMat.colorNode = river.color;
    this.riverMat.opacityNode = smoothstep(0, 0.08, float(1).sub(abs(across)));
    this.riverMat.mrtNode = mrt({ emissive: vec4(river.glint.mul(0.6), 1) });
    // Lakes: still water.
    this.lakeMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const lake = waterNodes(u, { fog: attribute("aFog", "float"), scale: 1.6 });
    this.lakeMat.colorNode = lake.color;
    this.lakeMat.mrtNode = mrt({ emissive: vec4(lake.glint.mul(0.6), 1) });
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
    const flowDir: number[] = [];
    const foam: number[] = [];
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
    for (const course of field.rivers) {
      // Stop at the first point in the sea or a lake: that water draws itself, and a second
      // layer over it would show as a lighter patch.
      const firstWet = course.findIndex((p) => p.wet);
      const samples = firstWet >= 0 ? course.slice(0, firstWet + 1) : course;
      if (samples.length < 2) continue;
      const base = pos.length / 3;
      // Last vertex placed on each side: an edge never steps backward along the flow (on the
      // inside of a tight bend it waits in place instead of folding the ribbon over itself).
      const lastEdge: (THREE.Vector3 | null)[] = [null, null];
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
        fwd.normalize();
        // Foam where the river meets the sea or a lake.
        const mouth = smp.wet || samples[Math.min(samples.length - 1, i + 2)]!.wet ? 0.55 : 0;
        const w = smp.width * RIVER_SURFACE * unit * (smp.wet ? 1.4 : 1);
        // On the inside of a bend the ribbon must not fold back on itself: limit that side to the
        // bend's radius (the water leaves a small dry bar there, as real rivers do).
        const a0 = smp.d.clone().sub(prev);
        const a1 = next.clone().sub(smp.d);
        const len = (a0.length() + a1.length()) * 0.5 * R;
        const turn = a1.normalize().sub(a0.normalize());
        const curvature = i > 0 && i < samples.length - 1 && len > 1e-6 ? turn.length() / len : 0;
        const inner = Math.sign(turn.dot(side));
        const limit = curvature > 1e-6 ? 0.8 / curvature : Infinity;
        for (const sg of [-1, 1]) {
          const ws = sg === inner ? Math.min(w, limit) : w;
          let v = pt.clone().addScaledVector(side, sg * ws);
          const k = sg < 0 ? 0 : 1;
          const last = lastEdge[k];
          if (last && v.clone().sub(last).dot(fwd) < 0.02) v = last.clone();
          lastEdge[k] = v;
          pos.push(v.x, v.y, v.z);
          along.push(alongBase + i * 0.15);
          across.push(sg);
          width.push(w);
          flowDir.push(fwd.x, fwd.y, fwd.z);
          foam.push(mouth);
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
    g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flowDir, 3));
    g.setAttribute("aFoam", new THREE.Float32BufferAttribute(foam, 1));
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
