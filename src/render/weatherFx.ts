import * as THREE from "three";

const DROPS = 1400;

/**
 * Rain streaks and snowflakes falling in a column around the view. They follow the ground under
 * the camera, so the planet's curve never shows; intensity and kind come from the climate.
 */
export class WeatherFx {
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  /** Drop offsets in a local frame: x, z across, y height (0..1). */
  private readonly local = new Float32Array(DROPS * 3);
  private seed = 11;

  constructor() {
    for (let i = 0; i < DROPS; i++) {
      this.local[i * 3] = this.rand() * 2 - 1;
      this.local[i * 3 + 1] = this.rand();
      this.local[i * 3 + 2] = this.rand() * 2 - 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: "#c8d6e8", transparent: true, opacity: 0.35, depthWrite: false }));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: "#ffffff", size: 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      o.renderOrder = 8;
      o.visible = false;
    }
    this.group.add(this.rain, this.snow);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * @param ground point on the surface under the view
   * @param amount 0..1 precipitation there; `snowing` when it is below freezing
   * @param span half-width of the column in world units
   */
  update(dt: number, ground: THREE.Vector3, amount: number, snowing: boolean, span: number, wind: THREE.Vector3): void {
    const on = amount > 0.04;
    this.rain.visible = on && !snowing;
    this.snow.visible = on && snowing;
    if (!on) return;
    const up = ground.clone().normalize();
    const a = new THREE.Vector3(0, 1, 0).cross(up);
    if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
    a.normalize();
    const b = up.clone().cross(a);
    const height = span * 0.9;
    const count = Math.floor(DROPS * Math.min(1, amount * 1.3));
    const fall = snowing ? 0.12 : 0.9;
    const L = this.local;
    const pos = (snowing ? this.snow : this.rain).geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const p = new THREE.Vector3();
    const streak = up.clone().multiplyScalar(-0.5).addScaledVector(wind, 0.4);
    for (let i = 0; i < DROPS; i++) {
      let y = (L[i * 3 + 1] as number) - dt * fall * (0.8 + (i % 7) * 0.05);
      if (y < 0) y += 1;
      L[i * 3 + 1] = y;
      const sway = snowing ? Math.sin(y * 20 + i) * 0.03 : 0;
      p.copy(ground)
        .addScaledVector(a, ((L[i * 3] as number) + sway) * span)
        .addScaledVector(b, (L[i * 3 + 2] as number) * span)
        .addScaledVector(up, y * height)
        .addScaledVector(wind, (1 - y) * span * 0.15);
      if (i >= count) p.set(0, 0, 0);
      if (snowing) arr.set([p.x, p.y, p.z], i * 3);
      else arr.set([p.x, p.y, p.z, p.x + streak.x, p.y + streak.y, p.z + streak.z], i * 6);
    }
    pos.needsUpdate = true;
    this.rain.material.opacity = 0.18 + amount * 0.3;
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.snow.geometry.dispose();
    this.rain.material.dispose();
    this.snow.material.dispose();
  }
}
