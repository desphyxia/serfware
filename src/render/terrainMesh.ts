import * as THREE from "three";
import type { Planet } from "../sim/planet/planet";
import { Biome } from "../sim/planet/terrain";
import { Noise3 } from "./noise";
import { biomeColor, tileHash } from "./palette";

/**
 * Builds render meshes from the simulation's tile grid. Each tile is a fan of triangles from its
 * centre to its corners; fans are subdivided for detail with shared midpoints so normals are smooth.
 * A per-vertex `aEdge` value (1 at tile centres, 0 on tile borders) lets shaders draw the hex grid.
 */

interface Vert {
  tile: number; // owning tile, for per-tile shading data
  dir: THREE.Vector3; // unit direction
  h: number; // elevation relative to sea level
  color: THREE.Color;
  edge: number;
}

export interface SurfaceBuild {
  land: THREE.BufferGeometry;
  water: THREE.BufferGeometry;
}

export function buildSurface(planet: Planet, subdivisions: number, seed: number): SurfaceBuild {
  const { grid, terrain } = planet;
  const R = planet.params.radius;
  const noise = new Noise3(seed);
  const N = grid.count;
  const C = grid.corners.length / 3;

  const verts: Vert[] = [];
  const tileColor: THREE.Color[] = [];
  const tmp = new THREE.Color();
  for (let t = 0; t < N; t++) {
    const b = terrain.biome[t] as Biome;
    const c = biomeColor(b, tileHash(t), new THREE.Color());
    // Slight darkening with moisture, warming on low ground: keeps the palette alive.
    const m = terrain.moisture[t] as number;
    c.offsetHSL(0, 0, (0.5 - m) * 0.05);
    tileColor.push(c);
    verts.push({ tile: t, dir: new THREE.Vector3(grid.center[t * 3], grid.center[t * 3 + 1], grid.center[t * 3 + 2]), h: terrain.elevation[t] as number, color: c, edge: 1 });
  }
  for (let k = 0; k < C; k++) {
    const t0 = grid.cornerTiles[k * 3] as number;
    const t1 = grid.cornerTiles[k * 3 + 1] as number;
    const t2 = grid.cornerTiles[k * 3 + 2] as number;
    const h = ((terrain.elevation[t0] as number) + (terrain.elevation[t1] as number) + (terrain.elevation[t2] as number)) / 3;
    const col = tmp
      .copy(tileColor[t0] as THREE.Color)
      .add(tileColor[t1] as THREE.Color)
      .add(tileColor[t2] as THREE.Color)
      .multiplyScalar(1 / 3)
      .clone();
    verts.push({ tile: t0, dir: new THREE.Vector3(grid.corners[k * 3], grid.corners[k * 3 + 1], grid.corners[k * 3 + 2]), h, color: col, edge: 0 });
  }

  // Fan triangles: (centre, corner k, corner k+1).
  let tris: number[] = [];
  for (let t = 0; t < N; t++) {
    const cs = grid.cornersOf(t);
    for (let k = 0; k < cs.length; k++) {
      tris.push(t, N + (cs[k] as number), N + (cs[(k + 1) % cs.length] as number));
    }
  }

  // Subdivide with a shared midpoint cache.
  for (let s = 0; s < subdivisions; s++) {
    const mids = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let m = mids.get(key);
      if (m === undefined) {
        const va = verts[a] as Vert;
        const vb = verts[b] as Vert;
        const dir = va.dir.clone().add(vb.dir).normalize();
        // Small visual-only roughness so subdivided land isn't perfectly smooth.
        const land = Math.min(va.h, vb.h) > 0.2;
        const n1 = noise.fbm(dir.x * 45, dir.y * 45, dir.z * 45, 3);
        const bump = land ? n1 * (0.12 + 0.3 * Math.min(1, (va.h + vb.h) * 0.08)) : 0;
        const color = va.color.clone().lerp(vb.color, 0.5);
        if (land) color.offsetHSL(n1 * 0.015, n1 * 0.04, n1 * 0.045);
        m = verts.length;
        verts.push({ tile: va.edge >= vb.edge ? va.tile : vb.tile, dir, h: (va.h + vb.h) / 2 + bump, color, edge: (va.edge + vb.edge) / 2 });
        mids.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i] as number;
      const b = tris[i + 1] as number;
      const c = tris[i + 2] as number;
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next;
  }

  const land = makeGeometry(verts, tris, (v) => R + v.h, true);

  // Water: only triangles that touch water, at sea level, carrying depth for shore foam.
  const wTris: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = verts[tris[i] as number] as Vert;
    const b = verts[tris[i + 1] as number] as Vert;
    const c = verts[tris[i + 2] as number] as Vert;
    if (Math.min(a.h, b.h, c.h) < 0.15) wTris.push(tris[i] as number, tris[i + 1] as number, tris[i + 2] as number);
  }
  const water = makeGeometry(verts, wTris, () => R, false);
  return { land, water };
}

function makeGeometry(verts: Vert[], tris: number[], radius: (v: Vert) => number, withColor: boolean): THREE.BufferGeometry {
  // Compact to the vertices actually used.
  const remap = new Int32Array(verts.length).fill(-1);
  const used: number[] = [];
  for (const i of tris) {
    if (remap[i] === -1) {
      remap[i] = used.length;
      used.push(i);
    }
  }
  const pos = new Float32Array(used.length * 3);
  const col = withColor ? new Float32Array(used.length * 3) : null;
  const edge = new Float32Array(used.length);
  const depth = new Float32Array(used.length);
  const owner = new Int32Array(used.length);
  used.forEach((vi, j) => {
    const v = verts[vi] as Vert;
    const r = radius(v);
    pos[j * 3] = v.dir.x * r;
    pos[j * 3 + 1] = v.dir.y * r;
    pos[j * 3 + 2] = v.dir.z * r;
    if (col) {
      col[j * 3] = v.color.r;
      col[j * 3 + 1] = v.color.g;
      col[j * 3 + 2] = v.color.b;
    }
    edge[j] = v.edge;
    owner[j] = v.tile;
    depth[j] = -v.h;
  });
  const index = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) index[i] = remap[tris[i] as number] as number;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
  g.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
  g.setAttribute("aWear", new THREE.BufferAttribute(new Float32Array(used.length), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aFog", new THREE.BufferAttribute(new Float32Array(used.length), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aClimate", new THREE.BufferAttribute(new Float32Array(used.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.userData.owner = owner;
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Terrain material: standard lighting plus an optional hex-grid overlay and soft rim darkening in hollows. */
export function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const uniforms = { uGrid: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = uniforms.uGrid;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aEdge;\nattribute float aWear;\nattribute float aFog;\nattribute vec3 aClimate;\nvarying float vEdge;\nvarying float vWear;\nvarying float vFog;\nvarying vec3 vClimate;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEdge = aEdge;\nvWear = aWear;\nvFog = aFog;\nvClimate = aClimate;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGrid;\nvarying float vEdge;\nvarying float vWear;\nvarying float vFog;\nvarying vec3 vClimate;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float w = fwidth(vEdge) * 1.4;
        float line = 1.0 - smoothstep(0.0, w + 0.02, vEdge);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.2), smoothstep(0.04, 1.0, vWear) * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.06, 0.05, 0.02), line * uGrid * 0.85);
        // Seasons: grass goes gold in autumn; mud darkens; snow lies white.
        float green = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 4.0, 0.0, 1.0);
        float luma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.48, 0.22) * (luma * 1.9 + 0.1), vClimate.y * green * 0.9);
        diffuseColor.rgb *= 1.0 - 0.28 * vClimate.z;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), smoothstep(0.08, 0.55, vClimate.x) * 0.95);
        // Fog of war: remembered land is a little faded, unexplored land dark and grey.
        float grey = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(grey), diffuseColor.rgb, 0.7) * 0.86, smoothstep(0.1, 0.5, vFog));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(grey), diffuseColor.rgb, 0.3) * 0.1 + vec3(0.008, 0.011, 0.02), smoothstep(0.55, 1.0, vFog));`,
      );
  };
  return mat;
}
