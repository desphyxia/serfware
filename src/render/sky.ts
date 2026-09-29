import * as THREE from "three";

/**
 * Sky around the camera. From orbit it is space with stars; near the ground it becomes an
 * atmosphere with a blue zenith, pale horizon, warm sunrise and sunset, a sun disc and haze.
 * The dome follows the camera, so the horizon is always correct on a curved world.
 */
export class SkyDome {
  readonly group = new THREE.Group();
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  /** Horizon colour of the last update, used for fog and water reflections. */
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();

  constructor(seed: number, radius = 5000) {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uAir: { value: 0 },
        uSunUp: { value: 1 },
        uQuality: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; uniform vec3 uUp; uniform float uAir; uniform float uSunUp; uniform float uQuality;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 L = normalize(uSunDir);
          float e = dot(d, uUp);
          float mu = dot(d, L);
          float day = smoothstep(-0.18, 0.25, uSunUp);
          float dusk = exp(-pow(uSunUp * 4.0, 2.0));
          vec3 zenith = mix(vec3(0.012, 0.02, 0.06), vec3(0.16, 0.36, 0.78), day);
          vec3 horizon = mix(vec3(0.03, 0.045, 0.1), vec3(0.62, 0.76, 0.9), day);
          float sunSide = 0.15 + 0.85 * pow(max(mu * 0.5 + 0.5, 0.0), 3.0);
          horizon = mix(horizon, vec3(1.0, 0.52, 0.28), dusk * 0.8 * sunSide);
          float h = pow(clamp(1.0 - max(e, 0.0), 0.0, 1.0), 4.0);
          vec3 col = mix(zenith, horizon, h);
          // Mie halo and sun disc.
          float halo = pow(max(mu, 0.0), 12.0) * (0.35 + dusk);
          col += vec3(1.0, 0.7, 0.45) * halo * (0.4 + 0.6 * day) * uQuality;
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, mu) * 6.0;
          // Below the horizon: darker haze.
          col = mix(col, horizon * 0.55, smoothstep(0.0, -0.25, e));
          vec3 space = vec3(0.004, 0.006, 0.016);
          col = mix(space, col, uAir);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);

    const count = 3200;
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
      // A faint band of denser stars, like a galactic plane.
      let z = rnd() * 2 - 1;
      if (rnd() < 0.35) z *= 0.18;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * radius * 0.9, z * radius * 0.9, Math.sin(a) * r * radius * 0.9], i * 3);
      size[i] = Math.pow(rnd(), 7) * 5.5 + 0.9;
      phase[i] = rnd() * 6.283;
      const t = rnd();
      tint.set(t < 0.12 ? [1, 0.78, 0.58] : t < 0.3 ? [0.72, 0.82, 1] : [1, 0.97, 0.92], i * 3);
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
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uAir: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aPhase; attribute vec3 aTint;
        uniform float uTime; uniform float uPixel; uniform vec3 uUp; uniform float uAir;
        varying float vA; varying vec3 vTint;
        void main() {
          float twinkle = mix(0.85, 0.55, uAir);
          vA = twinkle + (1.0 - twinkle) * sin(uTime * (0.8 + aPhase * 0.4) + aPhase * 9.0);
          // Stars near the horizon are dimmed by the air.
          float e = dot(normalize(position), uUp);
          vA *= mix(1.0, smoothstep(-0.02, 0.25, e), uAir);
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

  /**
   * @param up    local up at the camera (normalised camera position)
   * @param air   0 in space, 1 inside the atmosphere
   */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, up: THREE.Vector3, air: number, time: number, pixelRatio: number, quality: number): void {
    this.group.position.copy(camera.position);
    const sunUp = sunDir.dot(up);
    const u = this.skyMat.uniforms;
    u.uSunDir!.value.copy(sunDir);
    u.uUp!.value.copy(up);
    u.uAir!.value = air;
    u.uSunUp!.value = sunUp;
    u.uQuality!.value = quality;
    const su = this.starMat.uniforms;
    const day = THREE.MathUtils.smoothstep(sunUp, -0.18, 0.25);
    su.uTime!.value = time;
    su.uNight!.value = 1 - day * air;
    su.uPixel!.value = pixelRatio;
    su.uUp!.value.copy(up);
    su.uAir!.value = air;
    // CPU copy of the horizon colour for fog and water.
    const dusk = Math.exp(-Math.pow(sunUp * 4, 2));
    this.horizon.setRGB(0.03, 0.045, 0.1).lerp(new THREE.Color(0.62, 0.76, 0.9), day).lerp(new THREE.Color(1, 0.6, 0.38), dusk * 0.45);
    this.zenith.setRGB(0.012, 0.02, 0.06).lerp(new THREE.Color(0.16, 0.36, 0.78), day);
  }
}
