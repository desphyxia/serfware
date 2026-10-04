import * as THREE from "three/webgpu";

export interface CameraInputOptions {
  invertZoom: () => boolean;
  edgeScroll: () => boolean;
  /** The key (lower case) bound to a camera action: left, right, up, down, turnLeft, turnRight, resetView, tiltUp, tiltDown, zoomIn, zoomOut. */
  key: (action: string) => string;
  /** Offered each wheel notch (+1 / -1); return true to use it instead of zooming. */
  wheel?: (step: number) => boolean;
}

/**
 * Camera for small planets. It orbits a focus point on the surface: far away it looks straight
 * down at the globe; close in it tilts toward the horizon like a town-builder camera.
 * Drag to move over the planet, right-drag (or Q/E, R/F) to turn and tilt, wheel to zoom.
 */
export class PlanetCamera {
  readonly focus = new THREE.Vector3(0.3, 0.45, 0.85).normalize();
  heading = 0;
  distance: number;
  pitchOffset = 0;

  private readonly tFocus = this.focus.clone();
  private tHeading = 0;
  private tDistance: number;
  private tPitchOffset = 0;

  readonly minDistance = 5;
  readonly maxDistance: number;

  /**
   * What "north" means for the heading. It is carried along as the focus moves (parallel
   * transport) instead of being the planet's pole direction, so panning across a pole does not
   * spin the view; Home (resetView) realigns it with true north.
   */
  private readonly refNorth = new THREE.Vector3(0, 1, 0);
  private readonly moved = new THREE.Quaternion();
  private groundR = -1;
  private readonly up = new THREE.Vector3();
  private readonly north = new THREE.Vector3();
  private readonly east = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly ground = new THREE.Vector3();
  private readonly forward2 = new THREE.Vector3();
  private readonly right2 = new THREE.Vector3();
  private readonly up2 = new THREE.Vector3();
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragButton = -1;
  private edge = new THREE.Vector2();
  private pinch: { dist: number; angle: number; midY: number } | null = null;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly radius: number,
    private readonly surfaceRadius: (dir: THREE.Vector3) => number,
    private readonly opts: CameraInputOptions,
  ) {
    this.maxDistance = radius * 4.2;
    this.distance = this.tDistance = radius * 2.6;
  }

  /** 0 when looking at the whole globe, 1 when close to the ground. */
  closeness(): number {
    return THREE.MathUtils.smoothstep(this.maxDistance * 0.55 - this.distance, 0, this.maxDistance * 0.55 - this.minDistance);
  }

  /**
   * Angle of view from straight down. The Serf City overview looks down at 55° (0.61 rad from
   * vertical) across the whole settlement range; close in it tilts toward 35° for a miniature
   * feel; far out it straightens up to look at the globe.
   */
  pitch(): number {
    const R = this.radius;
    const d = this.distance;
    const overview = 0.61 * (1 - THREE.MathUtils.smoothstep(d, 0.9 * R, 1.8 * R));
    const close = 0.35 * (1 - THREE.MathUtils.smoothstep(d, this.minDistance, 14));
    return THREE.MathUtils.clamp(overview + close + this.pitchOffset, 0, 1.35);
  }

  /** Field of view: a narrow, map-like 28° over the settlement, wider from orbit. */
  fov(): number {
    return 28 + 14 * THREE.MathUtils.smoothstep(this.distance, 0.9 * this.radius, 1.8 * this.radius);
  }

  /** Back to north-up and the default tilt. */
  resetView(): void {
    // Fold the drift between the carried north and true north into the heading, so the view
    // does not jump, then turn smoothly to north-up.
    this.basis(this.focus);
    const trueNorth = this.truthNorth(this.focus);
    const east = new THREE.Vector3().crossVectors(trueNorth, this.up);
    const a = Math.atan2(this.refNorth.dot(east), this.refNorth.dot(trueNorth));
    this.heading += a;
    this.tHeading += a;
    this.refNorth.copy(trueNorth);
    this.tHeading = Math.round(this.tHeading / (Math.PI * 2)) * Math.PI * 2;
    this.tPitchOffset = 0;
  }

  lookAt(dir: THREE.Vector3, distance?: number): void {
    this.tFocus.copy(dir).normalize();
    this.focus.copy(this.tFocus);
    this.refNorth.copy(this.truthNorth(this.focus));
    if (distance !== undefined) this.distance = this.tDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
  }

  /** Glide the zoom to a distance (arriving at a planet). */
  zoomTo(distance: number): void {
    this.tDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
  }

  /** Glide the focus toward a direction without snapping (for following a settler). */
  follow(dir: THREE.Vector3): void {
    this.tFocus.copy(dir).normalize();
  }

  snap(distance: number, heading: number, pitchOffset: number): void {
    this.distance = this.tDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    this.heading = this.tHeading = heading;
    this.pitchOffset = this.tPitchOffset = pitchOffset;
  }

  attach(el: HTMLElement): void {
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragButton = e.button;
      if (this.pointers.size === 2) this.pinch = this.pinchState();
    });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const ex = (e.clientX - r.left) / r.width;
      const ey = (e.clientY - r.top) / r.height;
      this.edge.set(ex < 0.02 ? -1 : ex > 0.98 ? 1 : 0, ey < 0.02 ? -1 : ey > 0.98 ? 1 : 0);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (this.pointers.size >= 2) {
        const now = this.pinchState();
        if (this.pinch && now) {
          this.tDistance = THREE.MathUtils.clamp(this.tDistance * (this.pinch.dist / now.dist), this.minDistance, this.maxDistance);
          // Wrap the angle change to (-PI, PI] so the atan2 seam does not spin the view, and skip
          // the twist while the fingers are too close together for a stable angle.
          if (Math.min(now.dist, this.pinch.dist) > 30) {
            const d = Math.atan2(Math.sin(now.angle - this.pinch.angle), Math.cos(now.angle - this.pinch.angle));
            this.tHeading -= d;
          }
          // Two fingers sliding up or down together tilt the view.
          this.tPitchOffset = THREE.MathUtils.clamp(this.tPitchOffset - (now.midY - this.pinch.midY) * 0.005, -0.6, 0.5);
        }
        this.pinch = now;
        return;
      }
      if (this.dragButton === 2 || this.dragButton === 1 || e.shiftKey) {
        this.tHeading -= dx * 0.005;
        this.tPitchOffset = THREE.MathUtils.clamp(this.tPitchOffset - dy * 0.004, -0.6, 0.5);
      } else {
        this.pan(-dx, dy, r.height);
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => this.edge.set(0, 0));
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.opts.wheel?.(Math.sign(e.deltaY))) return;
        const dir = this.opts.invertZoom() ? -1 : 1;
        this.tDistance = THREE.MathUtils.clamp(this.tDistance * Math.exp(e.deltaY * 0.0012 * dir), this.minDistance, this.maxDistance);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private pinchState(): { dist: number; angle: number; midY: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midY: (a.y + b.y) / 2 };
  }

  /** Controller: turn the view (radians), tilt it, and zoom by a factor (<1 is closer). */
  rotate(d: number): void {
    this.tHeading += d;
  }

  tilt(d: number): void {
    this.tPitchOffset = THREE.MathUtils.clamp(this.tPitchOffset + d, -0.6, 0.5);
  }

  zoomBy(f: number): void {
    this.tDistance = THREE.MathUtils.clamp(this.tDistance * f, this.minDistance, this.maxDistance);
  }

  /** Move the focus by a screen-space delta in pixels. */
  pan(dx: number, dy: number, screenH: number): void {
    const worldPerPixel = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / screenH;
    const angle = (worldPerPixel / this.radius) * 1.0;
    this.basis(this.tFocus);
    this.tFocus.addScaledVector(this.right, dx * angle).addScaledVector(this.forward, dy * angle).normalize();
  }

  update(dt: number): void {
    // Keyboard and edge scrolling.
    const k = this.keys;
    const speed = 900 * dt;
    let kx = 0;
    let ky = 0;
    if (k.has(this.opts.key("left")) || k.has("arrowleft")) kx -= 1;
    if (k.has(this.opts.key("right")) || k.has("arrowright")) kx += 1;
    if (k.has(this.opts.key("up")) || k.has("arrowup")) ky += 1;
    if (k.has(this.opts.key("down")) || k.has("arrowdown")) ky -= 1;
    if (this.opts.edgeScroll()) {
      kx += this.edge.x;
      ky -= this.edge.y;
    }
    if (kx || ky) this.pan(kx * speed, ky * speed, 900);
    if (k.has(this.opts.key("turnLeft"))) this.tHeading += 1.6 * dt;
    if (k.has(this.opts.key("turnRight"))) this.tHeading -= 1.6 * dt;
    if (k.has(this.opts.key("resetView"))) this.resetView();
    if (k.has(this.opts.key("tiltUp"))) this.tPitchOffset = Math.min(0.5, this.tPitchOffset + dt);
    if (k.has(this.opts.key("tiltDown"))) this.tPitchOffset = Math.max(-0.6, this.tPitchOffset - dt);
    if (k.has(this.opts.key("zoomIn")) || (this.opts.key("zoomIn") === "+" && k.has("="))) this.tDistance = Math.max(this.minDistance, this.tDistance * (1 - dt * 1.5));
    if (k.has(this.opts.key("zoomOut"))) this.tDistance = Math.min(this.maxDistance, this.tDistance * (1 + dt * 1.5));

    // Smooth toward targets.
    const s = 1 - Math.exp(-dt * 9);
    this.moved.setFromUnitVectors(this.focus, this.tFocus.clone().lerp(this.focus, 1 - s).normalize());
    this.focus.lerp(this.tFocus, s).normalize();
    this.refNorth.applyQuaternion(this.moved).normalize();
    this.heading += (this.tHeading - this.heading) * s;
    this.distance += (this.tDistance - this.distance) * s;
    this.pitchOffset += (this.tPitchOffset - this.pitchOffset) * s;

    this.basis(this.focus);
    // The ground height under the focus is smoothed, so panning over hills and valleys does not
    // bob the camera up and down.
    const grNow = Math.max(this.radius, this.surfaceRadius(this.focus));
    this.groundR = this.groundR < 0 ? grNow : this.groundR + (grNow - this.groundR) * (1 - Math.exp(-dt * 3));
    this.ground.copy(this.focus).multiplyScalar(this.groundR);
    const p = this.pitch();
    const cam = this.camera;
    cam.position
      .copy(this.ground)
      .addScaledVector(this.up, this.distance * Math.cos(p))
      .addScaledVector(this.forward, -this.distance * Math.sin(p));
    // Never dip below the terrain.
    const camDir = cam.position.clone().normalize();
    const minR = this.surfaceRadius(camDir) + 1.2;
    if (cam.position.length() < minR) cam.position.copy(camDir.multiplyScalar(minR));
    cam.up.copy(this.up).multiplyScalar(Math.sin(p)).addScaledVector(this.forward, Math.cos(p)).normalize();
    cam.lookAt(this.ground);
    cam.fov = this.fov();
    cam.near = Math.max(0.05, this.distance * 0.02);
    cam.far = Math.max(this.radius * 60, 9000);
    cam.updateProjectionMatrix();
  }

  /**
   * Ray through a point of the screen (x, y in -1..1), built from the camera's own pose rather
   * than the renderer's matrices, so picking never depends on the graphics backend's depth
   * convention or on matrices the renderer has not refreshed yet. False if the pose is unusable.
   */
  rayAt(x: number, y: number, out: THREE.Ray): boolean {
    const aspect = this.camera.aspect;
    this.forward2.copy(this.ground).sub(this.camera.position).normalize();
    this.right2.crossVectors(this.forward2, this.camera.up).normalize();
    this.up2.crossVectors(this.right2, this.forward2);
    const k = Math.tan((this.camera.fov * Math.PI) / 360);
    out.origin.copy(this.camera.position);
    out.direction.copy(this.forward2).addScaledVector(this.right2, x * k * aspect).addScaledVector(this.up2, y * k).normalize();
    return Number.isFinite(out.direction.x + out.direction.y + out.direction.z + out.origin.x + out.origin.y + out.origin.z);
  }

  groundPoint(): THREE.Vector3 {
    return this.ground;
  }

  /** The planet's north (towards the pole) at a point on the surface. */
  private truthNorth(dir: THREE.Vector3): THREE.Vector3 {
    const up = dir.clone().normalize();
    const n = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0).addScaledVector(up, -up.x);
    return n.normalize();
  }

  private basis(dir: THREE.Vector3): void {
    this.up.copy(dir).normalize();
    this.north.copy(this.refNorth).addScaledVector(this.up, -this.refNorth.dot(this.up));
    if (this.north.lengthSq() < 1e-6) this.north.copy(this.truthNorth(this.up));
    this.north.normalize();
    this.east.crossVectors(this.north, this.up);
    this.forward.copy(this.north).multiplyScalar(Math.cos(this.heading)).addScaledVector(this.east, Math.sin(this.heading));
    this.right.crossVectors(this.forward, this.up);
  }
}
