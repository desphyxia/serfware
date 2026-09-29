import * as THREE from "three/webgpu";
import { abs, float, mrt, pow, sin, time, uniform, uv, vec3, vec4 } from "three/tsl";
import { PainterlyMaterial } from "./painterly";
import type { Planet } from "../sim/planet/planet";

/**
 * Star Well markers on the twelve pentagon tiles: a ring of five standing stones, a glowing
 * pentagon inlay and a faint column of light that pulses slowly.
 */
export class StarWellMarkers {
  readonly group = new THREE.Group();
  private readonly beamMat: THREE.MeshBasicNodeMaterial;
  private readonly inlayMat: THREE.MeshBasicNodeMaterial;
  private readonly beamStrength = uniform(1);
  private readonly inlayGlow = uniform(0.6);

  constructor(planet: Planet) {
    const { grid } = planet;
    const stoneGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.3, 5, 1);
    stoneGeo.translate(0, 0.6, 0);
    const stoneMat = new PainterlyMaterial({ color: "#8f8a80", flatShading: true, brush: 1.4 });
    const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, grid.pentagons.length * 5);
    stones.castShadow = true;
    stones.receiveShadow = true;

    this.inlayMat = new THREE.MeshBasicNodeMaterial({ color: "#ffd58a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.inlayMat.opacityNode = this.inlayGlow;
    this.inlayMat.mrtNode = mrt({ emissive: vec4(vec3(1.0, 0.8, 0.5).mul(this.inlayGlow).mul(0.6), 1) });
    this.beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const vUv = uv();
    const fade = pow(float(1).sub(vUv.y), 2.2);
    const pulse = sin(time.mul(0.8).add(vUv.y.mul(6))).mul(0.3).add(0.7);
    const edge = float(1).sub(abs(vUv.x.sub(0.5)).mul(2));
    const beam = vec3(1.0, 0.82, 0.52).mul(fade).mul(pulse).mul(edge).mul(0.35).mul(this.beamStrength);
    this.beamMat.colorNode = beam;
    this.beamMat.mrtNode = mrt({ emissive: vec4(beam.mul(0.5), 1) });
    const beamGeo = new THREE.CylinderGeometry(0.9, 1.3, 26, 20, 1, true);
    beamGeo.translate(0, 13, 0);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let si = 0;
    for (const p of grid.pentagons) {
      const dir = new THREE.Vector3(...grid.centerOf(p));
      const r = planet.surfaceRadius(p);
      q.setFromUnitVectors(up, dir);
      // Tangent basis for placing the stones in a ring.
      const tA = new THREE.Vector3(0, 1, 0).cross(dir);
      if (tA.lengthSq() < 1e-6) tA.set(1, 0, 0);
      tA.normalize();
      const tB = dir.clone().cross(tA).normalize();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const pos = dir
          .clone()
          .multiplyScalar(r - 0.1)
          .addScaledVector(tA, Math.cos(a) * 1.25)
          .addScaledVector(tB, Math.sin(a) * 1.25);
        const s = 0.85 + ((p * 7 + k * 13) % 5) * 0.08;
        m.compose(pos, q, new THREE.Vector3(s, s * (0.8 + (k % 3) * 0.15), s));
        stones.setMatrixAt(si++, m);
      }
      // Pentagon inlay from the tile's corners, slightly above ground.
      const cs = grid.cornersOf(p);
      const shape: number[] = [];
      const center = dir.clone().multiplyScalar(r + 0.08);
      for (let k = 0; k < cs.length; k++) {
        const c0 = new THREE.Vector3(...cornerVec(planet, cs[k] as number)).lerp(dir, 0.35).normalize().multiplyScalar(r + 0.08);
        const c1 = new THREE.Vector3(...cornerVec(planet, cs[(k + 1) % cs.length] as number)).lerp(dir, 0.35).normalize().multiplyScalar(r + 0.08);
        shape.push(...center.toArray(), ...c0.toArray(), ...c1.toArray());
      }
      const inlayGeo = new THREE.BufferGeometry();
      inlayGeo.setAttribute("position", new THREE.Float32BufferAttribute(shape, 3));
      const inlay = new THREE.Mesh(inlayGeo, this.inlayMat);
      inlay.renderOrder = 3;
      this.group.add(inlay);

      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.position.copy(dir).multiplyScalar(r);
      beam.quaternion.copy(q);
      beam.renderOrder = 4;
      this.group.add(beam);
    }
    stones.instanceMatrix.needsUpdate = true;
    this.group.add(stones);
    this.group.name = "star-wells";
  }

  update(time: number, night: number, closeness: number): void {
    this.beamStrength.value = (0.45 + night * 0.9) * (0.25 + 0.75 * closeness);
    this.inlayGlow.value = Math.min(1, 0.35 + 0.25 * Math.sin(time * 0.8) + night * 0.4);
  }
}

function cornerVec(planet: Planet, c: number): [number, number, number] {
  const g = planet.grid.corners;
  return [g[c * 3] as number, g[c * 3 + 1] as number, g[c * 3 + 2] as number];
}
