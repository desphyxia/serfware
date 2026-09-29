import * as THREE from "three";

const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
`;

/** Rim glow around the planet seen from orbit. Fades out as the camera descends into the air. */
export class AtmosphereShell {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(radius: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.11, 96, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW;
          void main() {
            vN = normalize(normalMatrix * normal);
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir; uniform float uOpacity; varying vec3 vN; varying vec3 vW;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 2.6);
            float lit = clamp(dot(normalize(vW), normalize(uSunDir)) * 0.9 + 0.3, 0.0, 1.0);
            vec3 col = mix(vec3(0.28, 0.5, 1.0), vec3(1.0, 0.55, 0.3), pow(1.0 - lit, 2.5) * 0.7);
            gl_FragColor = vec4(col * rim * (lit * lit) * 1.3 * uOpacity, 1.0);
          }`,
      }),
    );
    this.mesh.name = "atmosphere";
  }

  update(sunDir: THREE.Vector3, orbitFactor: number): void {
    this.mesh.material.uniforms.uSunDir!.value.copy(sunDir);
    this.mesh.material.uniforms.uOpacity!.value = orbitFactor;
    this.mesh.visible = orbitFactor > 0.01;
  }
}

/** Drifting cloud layer. Visible from orbit, fades away as you zoom in to build. */
export class CloudLayer {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(radius: number, seed: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.075, 128, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uOpacity: { value: 1 },
          uSeed: { value: (seed % 1000) / 10 },
          uCover: { value: 0.52 },
          uFronts: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
          uFrontR: { value: new Float32Array(16) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vP;
          void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSunDir; uniform float uOpacity; uniform float uSeed; uniform float uCover;
          uniform vec4 uFronts[16]; uniform float uFrontR[16];
          varying vec3 vP;
          ${NOISE_GLSL}
          void main() {
            float t = uTime * 0.004;
            float c = cos(t), s = sin(t);
            vec3 p = vec3(c * vP.x - s * vP.z, vP.y, s * vP.x + c * vP.z);
            vec3 q = p * 3.2 + uSeed;
            vec3 warp = vec3(fbm(q + 3.1), fbm(q - 1.7), fbm(q + 7.3));
            float d = fbm(q + warp * 1.6 + vec3(0.0, uTime * 0.01, 0.0));
            float band = 1.0 - abs(vP.y) * 0.35;
            // Weather fronts from the simulation: thick grey cloud where it rains.
            float storm = 0.0;
            for (int i = 0; i < 16; i++) {
              float r = uFrontR[i];
              if (r <= 0.0) continue;
              float ang2 = max(0.0, 2.0 - 2.0 * dot(vP, uFronts[i].xyz));
              storm += uFronts[i].w * exp(-ang2 / (r * r * 1.3));
            }
            storm = clamp(storm, 0.0, 1.0);
            float a = smoothstep(uCover - storm * 0.45, uCover + 0.18 - storm * 0.3, d * band);
            float lit = clamp(dot(vP, normalize(uSunDir)) * 1.4 + 0.25, 0.0, 1.0);
            vec3 col = mix(vec3(0.18, 0.2, 0.3), mix(vec3(1.0, 0.72, 0.55), vec3(1.0), lit), lit);
            col *= 1.0 - storm * 0.45;
            gl_FragColor = vec4(col, a * 0.85 * uOpacity);
          }`,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.name = "clouds";
  }

  /** Weather fronts to thicken: unit direction and strength, angular radius. */
  setFronts(fronts: readonly { x: number; y: number; z: number; radius: number; strength: number; age: number; life: number }[]): void {
    const u = this.mesh.material.uniforms;
    const v = u.uFronts!.value as THREE.Vector4[];
    const r = u.uFrontR!.value as Float32Array;
    for (let i = 0; i < 16; i++) {
      const f = fronts[i];
      if (!f) {
        r[i] = 0;
        continue;
      }
      const grow = Math.min(1, f.age / 12, (f.life - f.age) / 12);
      v[i]!.set(f.x, f.y, f.z, f.strength * Math.max(0, grow));
      r[i] = f.radius;
    }
  }

  update(time: number, sunDir: THREE.Vector3, opacity: number): void {
    const u = this.mesh.material.uniforms;
    u.uTime!.value = time;
    u.uSunDir!.value.copy(sunDir);
    u.uOpacity!.value = opacity;
    this.mesh.visible = opacity > 0.01;
  }
}
