import * as THREE from "three/webgpu";
import { atan, clamp, cross, dot, exp, float, max, mix, mrt, mx_noise_float, normalize, positionLocal, pow, smoothstep, time, uniform, vec3, vec4 } from "three/tsl";
import { SpriteBatch } from "./sprites";

/**
 * Sky around the camera. From orbit it is space with stars; near the ground it becomes an
 * atmosphere with a blue zenith, pale horizon, warm sunrise and sunset, a sun disc and haze.
 * The dome follows the camera, so the horizon is always correct on a curved world.
 */
export class SkyDome {
  readonly group = new THREE.Group();
  private readonly u = {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    up: uniform(new THREE.Vector3(0, 1, 0)),
    air: uniform(0),
    sunUp: uniform(1),
    quality: uniform(1),
    /** Aurora strength: high latitudes, at night, inside the atmosphere. */
    aurora: uniform(0),
    /** Sine of the horizon's dip below level at the camera's height (0 on the ground). */
    dip: uniform(0),
    /** Daytime zenith and horizon colours: blue for breathable air, other skies elsewhere. */
    dayZenith: uniform(new THREE.Vector3(0.16, 0.36, 0.78)),
    dayHorizon: uniform(new THREE.Vector3(0.62, 0.76, 0.9)),
  };
  private readonly stars: SpriteBatch;
  private readonly starDir: Float32Array;
  private readonly starSize: Float32Array;
  private readonly starPhase: Float32Array;
  private readonly starTint: Float32Array;
  private readonly radius: number;
  /** Horizon colour of the last update, used for fog and water reflections. */
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  /** Set the daytime sky from the planet's air (see skyColours). */
  setAir(air: { pressure: number; oxygen: number; water: number }): void {
    const c = skyColours(air);
    this.u.dayZenith.value.lerp(c2v(c.zenith), 0.05);
    this.u.dayHorizon.value.lerp(c2v(c.horizon), 0.05);
  }

  /** Jump straight to a planet's sky (arriving, not changing). */
  snapAir(air: { pressure: number; oxygen: number; water: number }): void {
    const c = skyColours(air);
    this.u.dayZenith.value.copy(c2v(c.zenith));
    this.u.dayHorizon.value.copy(c2v(c.horizon));
  }

  /** Planet radius, for the horizon's dip (set by the game). */
  planetRadius = 0;
  /** Debug and screenshots: show the aurora at any latitude (1), not only near the poles. */
  auroraForce = 0;

  constructor(seed: number, radius = 5000) {
    this.radius = radius;
    const u = this.u;
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    const d = normalize(positionLocal);
    const L = normalize(u.sunDir);
    const e = dot(d, u.up);
    const mu = dot(d, L);
    const day = smoothstep(-0.18, 0.25, u.sunUp);
    const dusk = exp(pow(u.sunUp.mul(4), 2).negate());
    const zenith = mix(vec3(0.012, 0.02, 0.06), u.dayZenith, day);
    let horizon = mix(vec3(0.03, 0.045, 0.1), u.dayHorizon, day);
    const sunSide = pow(max(mu.mul(0.5).add(0.5), 0), 3).mul(0.85).add(0.15);
    horizon = mix(horizon, vec3(1.0, 0.52, 0.28), dusk.mul(0.8).mul(sunSide));
    const h = pow(clamp(float(1).sub(max(e, 0)), 0, 1), 4);
    let col = mix(zenith, horizon, h);
    // Mie halo and sun disc.
    const halo = pow(max(mu, 0), 12).mul(dusk.add(0.35));
    col = col.add(vec3(1.0, 0.7, 0.45).mul(halo).mul(day.mul(0.6).add(0.4)).mul(u.quality));
    col = col.add(vec3(1.0, 0.95, 0.85).mul(smoothstep(0.9993, 0.9997, mu)).mul(6));
    // Light shafts at dawn and dusk: soft bright and dark rays fanning out from the sun.
    const ax = normalize(cross(L, u.up).add(vec3(1e-4, 0, 0)));
    const ay = cross(ax, L);
    const az = atan(dot(d, ay), dot(d, ax));
    const bands = mx_noise_float(vec3(az.mul(7), time.mul(0.03), 0)).mul(0.5).add(0.5);
    const rays = pow(bands, 3).sub(0.12).mul(pow(max(mu, 0), 3)).mul(dusk).mul(smoothstep(-0.05, 0.1, e)).mul(float(1).sub(smoothstep(0.1, 0.6, e)));
    col = col.add(vec3(1.0, 0.72, 0.45).mul(rays).mul(0.5).mul(u.quality));
    // Below the horizon: darker haze.
    col = mix(col, horizon.mul(0.55), smoothstep(0, -0.25, e));
    col = mix(vec3(0.004, 0.006, 0.016), col, u.air);
    // Aurora: curtains of light on a high sky plane, folding slowly, green at the hem and violet
    // above, with fine vertical rays drifting along them.
    // Heights above the visible horizon, which dips below level when the camera is high up.
    const eh = e.add(u.dip);
    const plane = d.sub(u.up.mul(e)).div(max(eh, 0.06)).mul(0.55);
    const fold = mx_noise_float(plane.mul(0.7).add(vec3(time.mul(0.012), 0, time.mul(-0.009))));
    // Squares written out: pow() of a negative base is undefined on the GPU.
    const f1 = fold.div(0.085);
    const f2 = fold.sub(0.28).div(0.06);
    const band = exp(f1.mul(f1).negate());
    const band2 = exp(f2.mul(f2).negate()).mul(0.55);
    const streaks = mx_noise_float(plane.mul(7).add(vec3(0, time.mul(0.25), 0))).mul(0.5).add(0.6);
    const reach = smoothstep(0.0, 0.1, eh).mul(float(1).sub(smoothstep(0.35, 0.85, e)));
    const auroraCol = mix(vec3(0.08, 0.95, 0.42), vec3(0.6, 0.2, 0.9), smoothstep(0.1, 0.5, eh));
    const aurora = auroraCol.mul(band.add(band2).mul(streaks).mul(reach).mul(u.aurora).mul(0.55));
    mat.colorNode = col;
    // The sun disc feeds bloom.
    mat.mrtNode = mrt({ emissive: vec4(vec3(1.0, 0.9, 0.75).mul(smoothstep(0.9993, 0.9997, mu)).mul(u.air), 1) });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);
    // The aurora: its own additive layer, outside the fog (which swallows the dome near the ground).
    const auroraMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    auroraMat.fog = false;
    auroraMat.colorNode = aurora;
    auroraMat.mrtNode = mrt({ emissive: vec4(aurora.mul(0.5), 1) });
    const auroraMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 48, 24), auroraMat);
    auroraMesh.frustumCulled = false;
    auroraMesh.renderOrder = -8;
    this.group.add(auroraMesh);

    const count = 3200;
    this.stars = new SpriteBatch(count, { additive: true, sizeMode: "pixels", renderOrder: -9 });
    this.starDir = new Float32Array(count * 3);
    this.starSize = new Float32Array(count);
    this.starPhase = new Float32Array(count);
    this.starTint = new Float32Array(count * 3);
    let st = seed >>> 0 || 7;
    const rnd = () => {
      st ^= st << 13;
      st ^= st >>> 17;
      st ^= st << 5;
      return (st >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      // A faint band of denser stars, like a galactic plane.
      let z = rnd() * 2 - 1;
      if (rnd() < 0.35) z *= 0.18;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      this.starDir.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
      this.stars.pos.set([Math.cos(a) * r * radius * 0.9, z * radius * 0.9, Math.sin(a) * r * radius * 0.9], i * 3);
      this.starSize[i] = Math.pow(rnd(), 7) * 5.5 + 0.9;
      this.starPhase[i] = rnd() * 6.283;
      const t = rnd();
      this.starTint.set(t < 0.12 ? [1, 0.78, 0.58] : t < 0.3 ? [0.72, 0.82, 1] : [1, 0.97, 0.92], i * 3);
    }
    this.group.add(this.stars.mesh);
  }

  /**
   * @param up    local up at the camera (normalised camera position)
   * @param air   0 in space, 1 inside the atmosphere
   */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, up: THREE.Vector3, air: number, time: number, pixelRatio: number, quality: number): void {
    this.group.position.copy(camera.position);
    const sunUp = sunDir.dot(up);
    const u = this.u;
    u.sunDir.value.copy(sunDir);
    u.up.value.copy(up);
    u.air.value = air;
    u.sunUp.value = sunUp;
    const rc = camera.position.length();
    u.dip.value = this.planetRadius > 0 && rc > this.planetRadius ? Math.sqrt(1 - (this.planetRadius / rc) ** 2) : 0;
    u.quality.value = quality;
    const day = THREE.MathUtils.smoothstep(sunUp, -0.18, 0.25);
    const night = 1 - day * air;
    // Near the poles on a clear night the aurora comes out.
    u.aurora.value = Math.max(this.auroraForce, THREE.MathUtils.smoothstep(Math.abs(up.y), 0.55, 0.8)) * (1 - THREE.MathUtils.smoothstep(sunUp, -0.2, -0.02)) * air;
    const st = this.stars;
    const n = this.starSize.length;
    if (night < 0.02) st.flush(0);
    else {
      const twinkle = 0.85 + (0.55 - 0.85) * air;
      for (let i = 0; i < n; i++) {
        let a = twinkle + (1 - twinkle) * Math.sin(time * (0.8 + (this.starPhase[i] as number) * 0.4) + (this.starPhase[i] as number) * 9);
        // Stars near the horizon are dimmed by the air.
        const e = (this.starDir[i * 3] as number) * up.x + (this.starDir[i * 3 + 1] as number) * up.y + (this.starDir[i * 3 + 2] as number) * up.z;
        a *= 1 + (THREE.MathUtils.smoothstep(e, -0.02, 0.25) - 1) * air;
        const k = Math.max(0, a * night);
        st.color[i * 3] = (this.starTint[i * 3] as number) * k;
        st.color[i * 3 + 1] = (this.starTint[i * 3 + 1] as number) * k;
        st.color[i * 3 + 2] = (this.starTint[i * 3 + 2] as number) * k;
        st.size[i] = (this.starSize[i] as number) * pixelRatio;
        st.alpha[i] = Math.min(1, k);
      }
      st.flush(n);
    }
    // CPU copy of the horizon colour for fog and water.
    const dusk = Math.exp(-Math.pow(sunUp * 4, 2));
    this.horizon.setRGB(0.03, 0.045, 0.1).lerp(v2c(this.u.dayHorizon.value), day).lerp(new THREE.Color(1, 0.6, 0.38), dusk * 0.45);
    this.zenith.setRGB(0.012, 0.02, 0.06).lerp(v2c(this.u.dayZenith.value), day);
  }
}

/**
 * The daytime sky of an atmosphere: deep blue over breathable air; near-black and dusty over
 * thin air; butterscotch over dry, oxygen-less air; yellow haze over thick, hot air; pale over a
 * wet sky. Terraforming shifts it toward blue.
 */
export function skyColours(air: { pressure: number; oxygen: number; water: number }): { zenith: THREE.Color; horizon: THREE.Color } {
  const cl = (x: number) => Math.max(0, Math.min(1, x));
  const thick = cl(air.pressure / 0.9);
  const earth = cl(Math.min(air.oxygen / 0.18, 1.2 - Math.abs(air.pressure - 1) / 1.5, air.water / 0.6));
  const dust = cl((1 - air.water) * 1.2) * (1 - earth);
  const haze = cl((air.pressure - 1.6) / 1.5) * (1 - earth);
  const zenith = new THREE.Color(0.03, 0.035, 0.07).lerp(new THREE.Color(0.2, 0.3, 0.52), thick);
  const horizon = new THREE.Color(0.24, 0.22, 0.24).lerp(new THREE.Color(0.66, 0.7, 0.74), thick);
  zenith.lerp(new THREE.Color(0.52, 0.4, 0.3), dust * 0.8 * thick);
  horizon.lerp(new THREE.Color(0.82, 0.64, 0.46), dust * 0.85);
  zenith.lerp(new THREE.Color(0.72, 0.6, 0.34), haze);
  horizon.lerp(new THREE.Color(0.92, 0.78, 0.48), haze);
  zenith.lerp(new THREE.Color(0.16, 0.36, 0.78), earth);
  horizon.lerp(new THREE.Color(0.62, 0.76, 0.9), earth);
  return { zenith, horizon };
}

const v2c = (v: THREE.Vector3) => new THREE.Color(v.x, v.y, v.z);
const c2v = (c: THREE.Color) => new THREE.Vector3(c.r, c.g, c.b);
