import * as THREE from "three";
import type { LandUse } from "../sim/econ/landuse";
import type { SurfaceFrames } from "./frames";

/**
 * Rivers as flowing ribbons that widen downstream, and lakes as flat water at their spill
 * height. Rivers run from tile centre to the tile they drain into, on into the sea.
 */
export class RiverView {
  readonly group = new THREE.Group();
  private readonly riverMat: THREE.ShaderMaterial;
  private readonly lakeMat: THREE.ShaderMaterial;

  constructor(land: LandUse, frames: SurfaceFrames) {
    const uniforms = { uTime: { value: 0 }, uDay: { value: 1 }, uSky: { value: new THREE.Color("#8fb6d8") } };
    this.riverMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -8,
      vertexShader: /* glsl */ `
        attribute float aAlong; attribute float aAcross; attribute float aWidth; attribute float aFog;
        varying float vAlong; varying float vAcross; varying float vWidth; varying float vFog; varying vec3 vW;
        void main() {
          vAlong = aAlong; vAcross = aAcross; vWidth = aWidth; vFog = aFog;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uDay; uniform vec3 uSky;
        varying float vAlong; varying float vAcross; varying float vWidth; varying float vFog; varying vec3 vW;
        void main() {
          float edge = 1.0 - abs(vAcross);
          float ripple = sin(vAlong * 7.0 - uTime * 2.4 + vAcross * 2.0) * 0.5 + 0.5;
          float ripple2 = sin(vAlong * 13.0 - uTime * 3.7 - vAcross * 3.0) * 0.5 + 0.5;
          vec3 deep = vec3(0.12, 0.34, 0.45);
          vec3 shallow = vec3(0.35, 0.62, 0.62);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 0.8, edge) * min(1.0, vWidth));
          col += vec3(0.9, 0.95, 1.0) * pow(ripple * ripple2, 6.0) * 0.35;
          col = mix(col, uSky, 0.18) * mix(0.3, 1.0, uDay);
          col = mix(col, col * 0.15, smoothstep(0.55, 1.0, vFog));
          float a = smoothstep(0.0, 0.35, edge) * 0.9;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.lakeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aFog; varying float vFog; varying vec3 vW;
        void main() { vFog = aFog; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uDay; uniform vec3 uSky;
        varying float vFog; varying vec3 vW;
        void main() {
          float r = sin(dot(vW, vec3(1.3, 0.7, 1.1)) * 2.2 + uTime * 0.9) * sin(dot(vW, vec3(-0.6, 1.2, 0.8)) * 3.1 - uTime * 0.7);
          vec3 col = mix(vec3(0.16, 0.38, 0.46), uSky, 0.25) + vec3(r * 0.03);
          col *= mix(0.3, 1.0, uDay);
          col = mix(col, col * 0.15, smoothstep(0.55, 1.0, vFog));
          gl_FragColor = vec4(col, 0.88);
          #include <colorspace_fragment>
        }`,
    });
    this.group.add(this.buildRivers(land, frames), this.buildLakes(land));
    this.group.name = "rivers";
  }

  /** Tile index per vertex, for fog. */
  readonly riverTiles: number[] = [];
  readonly lakeTiles: number[] = [];

  private buildRivers(land: LandUse, frames: SurfaceFrames): THREE.Mesh {
    const { hydro } = land;
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
      const to = hydro.flowTo[t] as number;
      if (to < 0) continue;
      const w0 = Math.min(0.9, 0.22 + 0.16 * Math.sqrt((hydro.flow[t] as number) / hydro.riverFlow));
      const w1 = land.isLand(to) ? Math.min(0.9, 0.22 + 0.16 * Math.sqrt((hydro.flow[to] as number) / hydro.riverFlow)) : w0 * 1.6;
      const seg = 5;
      const base = pos.length / 3;
      for (let k = 0; k <= seg; k++) {
        const f = k / seg;
        frames.between(t, to, f, 0.07, p);
        frames.between(t, to, Math.min(1, f + 0.05), 0.07, q);
        up.copy(p).normalize();
        dir.copy(q).sub(p);
        if (k === seg) {
          frames.between(t, to, f - 0.05, 0.07, q);
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
          idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
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

  update(time: number, daylight: number, sky: THREE.Color): void {
    this.riverMat.uniforms.uTime!.value = time;
    this.riverMat.uniforms.uDay!.value = daylight;
    (this.riverMat.uniforms.uSky!.value as THREE.Color).copy(sky);
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
