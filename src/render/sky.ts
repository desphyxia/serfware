import * as THREE from "three";

/**
 * Background sky: a large sphere with a gradient that follows the sun, plus a starfield that
 * fades in at night. Stars are Points with per-star size and twinkle phase.
 */
export class SkyDome {
  readonly group = new THREE.Group();
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;

  constructor(seed: number, radius = 4000) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uDay: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uDay;
        varying vec3 vDir;
        void main() {
          float s = dot(normalize(vDir), normalize(uSunDir));
          vec3 night = vec3(0.012, 0.018, 0.045);
          vec3 day = vec3(0.10, 0.16, 0.30);
          vec3 base = mix(night, day, uDay);
          float halo = pow(max(s, 0.0), 12.0);
          float wide = pow(max(s, 0.0), 2.5);
          vec3 warm = vec3(1.0, 0.62, 0.36);
          vec3 col = base + warm * (wide * 0.12 + halo * 0.45) * (0.35 + 0.65 * uDay);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);

    const count = 2600;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    let s = seed >>> 0 || 7;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * radius * 0.9, z * radius * 0.9, Math.sin(a) * r * radius * 0.9], i * 3);
      size[i] = Math.pow(rnd(), 6) * 5 + 1;
      phase[i] = rnd() * 6.283;
      const t = rnd();
      tint.set(t < 0.15 ? [1, 0.8, 0.6] : t < 0.3 ? [0.7, 0.8, 1] : [1, 0.97, 0.92], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aPhase; attribute vec3 aTint;
        uniform float uTime; uniform float uPixel;
        varying float vA; varying vec3 vTint;
        void main() {
          vA = 0.65 + 0.35 * sin(uTime * (0.8 + aPhase * 0.3) + aPhase * 9.0);
          vTint = aTint;
          gl_PointSize = aSize * uPixel;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight; varying float vA; varying vec3 vTint;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float f = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vTint * f * vA * uNight, f * vA * uNight);
        }`,
    });
    const stars = new THREE.Points(g, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    this.group.add(stars);
  }

  update(sunDir: THREE.Vector3, daylight: number, time: number, pixelRatio: number): void {
    (this.skyMat.uniforms.uSunDir as THREE.IUniform<THREE.Vector3>).value.copy(sunDir);
    (this.skyMat.uniforms.uDay as THREE.IUniform<number>).value = daylight;
    (this.starMat.uniforms.uTime as THREE.IUniform<number>).value = time;
    (this.starMat.uniforms.uNight as THREE.IUniform<number>).value = Math.max(0.15, 1 - daylight * 1.1);
    (this.starMat.uniforms.uPixel as THREE.IUniform<number>).value = pixelRatio;
  }
}
