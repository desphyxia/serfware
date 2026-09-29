import * as THREE from "three";
import { Noise3 } from "./noise";

/**
 * Batch 1 placeholder: a noise-shaped icosphere with sea, so the debug tools have something real
 * to measure. Batch 2 replaces this with the simulation's hex grid.
 */
export function buildPreviewPlanet(seed: number, radius: number, detail: number): THREE.Group {
  const group = new THREE.Group();
  const noise = new Noise3(seed);
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const deep = new THREE.Color("#7c6a4f");
  const grass = new THREE.Color("#5f8c4e");
  const dark = new THREE.Color("#3f6b3c");
  const rock = new THREE.Color("#8a8278");
  const snow = new THREE.Color("#eef2f4");
  const sand = new THREE.Color("#d8c690");
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const h = noise.fbm(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6, 5);
    const ridge = 1 - Math.abs(noise.fbm(v.x * 3.1, v.y * 3.1 + 7, v.z * 3.1, 3));
    const height = h * 0.9 + Math.max(0, h) * ridge * 0.6;
    const elev = height * radius * 0.08;
    v.multiplyScalar(radius + Math.max(elev, -radius * 0.02));
    pos.setXYZ(i, v.x, v.y, v.z);
    const lat = Math.abs(v.y / radius);
    if (height < 0.02) c.copy(sand).lerp(deep, Math.min(1, -height * 6));
    else if (height > 0.42 || lat > 0.88) c.copy(snow);
    else if (height > 0.28) c.copy(rock);
    else c.copy(grass).lerp(dark, Math.min(1, noise.get(v.x * 0.08, v.y * 0.08, v.z * 0.08) * 0.8 + 0.4));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
  land.castShadow = true;
  land.receiveShadow = true;
  land.name = "land";
  group.add(land);

  const sea = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 1.001, Math.max(3, detail - 1)),
    new THREE.MeshStandardMaterial({ color: "#2b6f86", roughness: 0.45, metalness: 0.02, transparent: true, opacity: 0.88 }),
  );
  sea.receiveShadow = true;
  sea.name = "sea";
  group.add(sea);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; varying vec3 vN; varying vec3 vW;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 3.0);
          float lit = clamp(dot(normalize(vW), normalize(uSunDir)) * 0.8 + 0.35, 0.0, 1.0);
          vec3 col = mix(vec3(0.25, 0.45, 0.9), vec3(1.0, 0.6, 0.35), pow(1.0 - lit, 3.0) * 0.6);
          gl_FragColor = vec4(col * rim * lit * 1.4, rim * lit);
        }`,
    }),
  );
  atmo.name = "atmosphere";
  group.add(atmo);
  return group;
}
