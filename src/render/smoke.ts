import * as THREE from "three";

export interface Emitter {
  pos: THREE.Vector3;
  /** Particles per second. */
  rate: number;
  kind: "smoke" | "steam" | "dust" | "spark";
}

const MAX = 700;

/**
 * Soft particle system for chimney smoke, sawmill steam and work dust. Particles rise along the
 * local up direction and drift with the wind; they grow and fade as they age.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(99);
  private readonly life = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly shade = new Float32Array(MAX);
  private readonly kind = new Uint8Array(MAX);
  private next = 0;
  private readonly acc = new Map<Emitter, number>();
  private readonly mat: THREE.ShaderMaterial;
  private seed = 7;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aShade", new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPixel: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; attribute float aShade;
        uniform float uPixel; varying float vAlpha; varying float vShade;
        void main() {
          vAlpha = aAlpha; vShade = aShade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixel * (120.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight; varying float vAlpha; varying float vShade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          vec3 col = vec3(vShade) * uLight;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, emitters: readonly Emitter[], wind: THREE.Vector3, light: THREE.Color, pixelRatio: number, amount: number): void {
    this.mat.uniforms.uPixel!.value = pixelRatio;
    (this.mat.uniforms.uLight!.value as THREE.Color).copy(light);
    for (const e of emitters) {
      let a = (this.acc.get(e) ?? this.rand()) + dt * e.rate * amount;
      while (a >= 1) {
        a -= 1;
        this.spawn(e);
      }
      this.acc.set(e, a);
    }
    if (this.acc.size > emitters.length * 2) this.acc.clear();
    const up = new THREE.Vector3();
    for (let i = 0; i < MAX; i++) {
      if (this.age[i]! >= this.life[i]!) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      up.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!).normalize();
      const k = this.kind[i]!;
      const rise = k === 2 ? 0.2 : k === 3 ? -0.4 : 0.55;
      for (let j = 0; j < 3; j++) {
        this.pos[i * 3 + j]! += (this.vel[i * 3 + j]! + up.getComponent(j) * rise + wind.getComponent(j) * t * 0.8) * dt;
        this.vel[i * 3 + j]! *= 0.98;
      }
      const base = k === 0 ? 0.5 : k === 1 ? 0.35 : k === 3 ? 1 : 0.45;
      this.size[i] = k === 3 ? 0.35 * (1 - t) : (k === 2 ? 0.6 : 0.5) + t * (k === 2 ? 1.4 : 2.2);
      this.alpha[i] = base * Math.sin(Math.min(1, t) * Math.PI) * (1 - t * 0.4);
    }
    const g = this.points.geometry;
    for (const key of ["position", "aSize", "aAlpha", "aShade"]) (g.getAttribute(key) as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawn(e: Emitter): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const j = () => (this.rand() - 0.5) * 0.12;
    this.pos[i * 3] = e.pos.x + j();
    this.pos[i * 3 + 1] = e.pos.y + j();
    this.pos[i * 3 + 2] = e.pos.z + j();
    const burst = e.kind === "spark" ? 12 : 1;
    this.vel[i * 3] = j() * burst;
    this.vel[i * 3 + 1] = j() * burst;
    this.vel[i * 3 + 2] = j() * burst;
    this.age[i] = 0;
    this.kind[i] = e.kind === "smoke" ? 0 : e.kind === "steam" ? 1 : e.kind === "dust" ? 2 : 3;
    this.life[i] = e.kind === "dust" ? 1.2 : e.kind === "spark" ? 0.45 : 3.5 + this.rand() * 2;
    this.shade[i] = e.kind === "smoke" ? 0.6 + this.rand() * 0.15 : e.kind === "steam" ? 0.95 : e.kind === "spark" ? 2.4 : 0.75;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Night glow for windows: vertex colours matching the window tone become emissive. */
export function patchWindows(mat: THREE.MeshStandardMaterial, night: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR
          float win = step(0.95, vColor.r) * step(0.55, vColor.g) * step(vColor.g, 0.8) * step(0.15, vColor.b) * step(vColor.b, 0.4);
          totalEmissiveRadiance += vec3(1.0, 0.68, 0.32) * win * (0.15 + uNight * 2.2);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => "windows";
}
