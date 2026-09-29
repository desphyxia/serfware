import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  dot,
  exp,
  float,
  Fn,
  Loop,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  vec3,
} from "three/tsl";

/** Rim glow around the planet seen from orbit. Fades out as the camera descends into the air. */
export class AtmosphereShell {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly sunDir = uniform(new THREE.Vector3(1, 0, 0));
  private readonly opacity = uniform(1);

  constructor(radius: number) {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const rim = pow(float(1).sub(abs(dot(normalize(normalView), vec3(0, 0, 1)))), 2.6);
    const lit = clamp(dot(normalize(positionWorld), normalize(this.sunDir)).mul(0.9).add(0.3), 0, 1);
    const col = mix(vec3(0.28, 0.5, 1.0), vec3(1.0, 0.55, 0.3), pow(float(1).sub(lit), 2.5).mul(0.7));
    mat.colorNode = col.mul(rim).mul(lit.mul(lit)).mul(1.3).mul(this.opacity);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.11, 96, 48), mat);
    this.mesh.name = "atmosphere";
  }

  update(sunDir: THREE.Vector3, orbitFactor: number): void {
    this.sunDir.value.copy(sunDir);
    this.opacity.value = orbitFactor;
    this.mesh.visible = orbitFactor > 0.01;
  }
}

const FRONTS = 16;

/** Drifting cloud layer. Visible from orbit, fades away as you zoom in to build. */
export class CloudLayer {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly u = {
    time: uniform(0),
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    opacity: uniform(1),
    cover: uniform(0.52),
  };
  private readonly fronts = uniformArray(Array.from({ length: FRONTS }, () => new THREE.Vector4()), "vec4");
  private readonly frontR = uniformArray(new Array<number>(FRONTS).fill(0), "float");

  constructor(radius: number, seed: number) {
    const u = this.u;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const seedOff = float((seed % 1000) / 10);
    const vP = normalize(positionLocal);
    const t = u.time.mul(0.004);
    const c = cos(t);
    const s = sin(t);
    const p = vec3(c.mul(vP.x).sub(s.mul(vP.z)), vP.y, s.mul(vP.x).add(c.mul(vP.z)));
    const q = p.mul(3.2).add(seedOff);
    const warp = vec3(mx_fractal_noise_float(q.add(3.1), 4), mx_fractal_noise_float(q.sub(1.7), 4), mx_fractal_noise_float(q.add(7.3), 4));
    const d = mx_fractal_noise_float(q.add(warp.mul(1.6)).add(vec3(0, u.time.mul(0.01), 0)), 5).mul(0.5).add(0.5);
    const band = float(1).sub(abs(vP.y).mul(0.35));
    // Weather fronts from the simulation: thick grey cloud where it rains.
    const storm = Fn(() => {
      const acc = float(0).toVar();
      Loop(FRONTS, ({ i }) => {
        const f = this.fronts.element(i) as unknown as THREE.Node<"vec4">;
        const r = this.frontR.element(i) as unknown as THREE.Node<"float">;
        const ang2 = max(0, float(2).sub(dot(vP, f.xyz).mul(2)));
        acc.addAssign(f.w.mul(exp(ang2.negate().div(r.mul(r).mul(1.3).add(1e-4)))).mul(r.greaterThan(0).select(1, 0)));
      });
      return clamp(acc, 0, 1);
    })();
    const a = smoothstep(u.cover.sub(storm.mul(0.45)), u.cover.add(0.18).sub(storm.mul(0.3)), d.mul(band));
    const lit = clamp(dot(vP, normalize(u.sunDir)).mul(1.4).add(0.25), 0, 1);
    const col = mix(vec3(0.18, 0.2, 0.3), mix(vec3(1.0, 0.72, 0.55), vec3(1), lit), lit).mul(float(1).sub(storm.mul(0.45)));
    mat.colorNode = col;
    mat.opacityNode = a.mul(0.85).mul(u.opacity);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.075, 128, 64), mat);
    this.mesh.renderOrder = 2;
    this.mesh.name = "clouds";
  }

  /** Weather fronts to thicken: unit direction and strength, angular radius. */
  setFronts(fronts: readonly { x: number; y: number; z: number; radius: number; strength: number; age: number; life: number }[]): void {
    const v = this.fronts.array as THREE.Vector4[];
    const r = this.frontR.array as number[];
    for (let i = 0; i < FRONTS; i++) {
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
    this.u.time.value = time;
    this.u.sunDir.value.copy(sunDir);
    this.u.opacity.value = opacity;
    this.mesh.visible = opacity > 0.01;
  }
}
