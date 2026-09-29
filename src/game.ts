import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BUILD } from "./build";
import { crash } from "./core/crash";
import { log } from "./core/log";
import { describeLeak, MemoryMonitor, type MemSample } from "./core/memory";
import type { SettingsStore } from "./core/settings";
import { buildPreviewPlanet } from "./render/planetPreview";
import { GameRenderer } from "./render/renderer";
import { SkyDome } from "./render/sky";
import { formatDay, TICK_MS } from "./sim/clock";
import { hashString } from "./sim/rng";
import { normaliseSeed, randomSeedWord } from "./sim/seedwords";
import { World } from "./sim/world";
import { DebugPanel } from "./ui/debugPanel";
import { h } from "./ui/dom";
import { Hud } from "./ui/hud";
import { ReportPanel } from "./ui/reportPanel";
import { SettingsPanel } from "./ui/settingsPanel";

const RAD = 180 / Math.PI;

export function formatLatLon(p: THREE.Vector3): string {
  const n = p.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) * RAD;
  const lon = Math.atan2(-n.z, n.x) * RAD;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

/** Top-level runtime: owns the world, the view, the loop and the UI. */
export class Game {
  world: World;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly gfx: GameRenderer;
  readonly memory = new MemoryMonitor();
  private readonly sky: SkyDome;
  private planet: THREE.Group | null = null;
  private readonly sun = new THREE.DirectionalLight("#fff1dc", 3);
  private readonly hemi = new THREE.HemisphereLight("#9fc3ff", "#3a3024", 0.35);
  private readonly ambient = new THREE.AmbientLight("#1b2340", 0.5);
  private readonly hud: Hud;
  private readonly debug: DebugPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly report: ReportPanel;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(9, 9);
  private pointerDirty = false;
  private cursorCoord: string | null = null;
  private speed = 1;
  private acc = 0;
  private lastFrame = 0;
  private lastRender = 0;
  private readonly frameTimes: number[] = [];
  private fps = 0;
  private tickCounter = { ticks: 0, since: 0, rate: 0 };
  private readonly warnings: string[] = [];
  private leakTest: THREE.BufferGeometry[] = [];
  private leakTimer: number | null = null;
  private readonly clockStart = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly settings: SettingsStore,
    seed: string,
  ) {
    this.world = new World(seed);
    const canvas = h("canvas", { class: "view", "aria-label": "Game view" }) as HTMLCanvasElement;
    container.append(canvas);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 12000);
    this.camera.position.set(170, 110, 230);
    this.gfx = new GameRenderer(canvas, this.scene, this.camera, settings.get().graphics);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = this.world.planet.radius * 1.18;
    this.controls.maxDistance = this.world.planet.radius * 6;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;

    this.sky = new SkyDome(hashString(seed));
    this.scene.add(this.sky.group, this.sun, this.sun.target, this.hemi, this.ambient);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -130;
    sc.right = sc.top = 130;
    sc.near = 10;
    sc.far = 700;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;

    this.hud = new Hud({
      settings: () => this.settingsPanel.toggle(),
      debug: () => this.debug.toggle(),
      report: () => this.report.show(),
    });
    this.settingsPanel = new SettingsPanel(settings, {
      seed: () => this.world.seed,
      newWorld: (s) => this.newWorld(s),
    });
    this.report = new ReportPanel();
    this.debug = new DebugPanel({
      fps: () => this.fps,
      frameTimes: () => this.frameTimes,
      render: () => this.gfx.stats(),
      memory: () => this.memory.samples,
      sim: () => ({ tick: this.world.tick, ticksPerSec: this.tickCounter.rate, checksum: this.world.checksum(), speed: this.speed }),
      warnings: () => this.warnings,
      actions: {
        "Speed ×1": () => (this.speed = 1),
        "×8": () => (this.speed = 8),
        "×64": () => (this.speed = 64),
        "Pause": () => (this.speed = 0),
        "Test crash": () =>
          setTimeout(() => {
            throw new Error("Test crash triggered from the debug dialog");
          }),
        "Leak test": () => this.toggleLeakTest(),
        "Sample memory": () => this.sampleMemory(),
      },
    });
    container.append(this.hud.root, this.debug.root, this.settingsPanel.root, this.report.root);

    this.applyUi();
    settings.subscribe((s) => {
      this.gfx.apply(s.graphics);
      this.applyShadowSettings();
      this.applyUi();
    });
    this.applyShadowSettings();
    this.buildPlanet();
    this.bindInput(canvas);
    this.registerReportContext();
    crash.setMemorySource(() => this.memory.samples);
    window.setInterval(() => this.sampleMemory(), 5000);
    log.info(`World ${seed} ready`);
  }

  resize(): void {
    this.gfx.resize();
    const c = this.gfx.canvas;
    this.camera.aspect = Math.max(1, c.clientWidth) / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    this.resize();
    window.setTimeout(() => this.sampleMemory(), 1000);
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      try {
        this.frame(now);
      } catch (err) {
        crash.capture({ kind: "error", message: (err as Error).message, stack: (err as Error).stack });
      }
    };
    requestAnimationFrame(frame);
  }

  newWorld(seedInput?: string): void {
    const seed = seedInput && seedInput.trim() ? normaliseSeed(seedInput) : randomSeedWord(Math.floor(Math.random() * 2 ** 32));
    this.world = new World(seed);
    this.buildPlanet();
    try {
      history.replaceState(null, "", `#${seed}`);
    } catch {
      // Some sandboxes forbid history changes; the seed is still on the bug line.
    }
    log.info(`New world ${seed}`);
  }

  private buildPlanet(): void {
    if (this.planet) {
      this.scene.remove(this.planet);
      disposeTree(this.planet);
    }
    const detail = { low: 5, medium: 6, high: 7 }[this.settings.get().graphics.terrainDetail];
    this.planet = buildPreviewPlanet(hashString(this.world.seed), this.world.planet.radius, detail);
    this.scene.add(this.planet);
  }

  private applyShadowSettings(): void {
    const g = this.settings.get().graphics;
    this.sun.castShadow = g.shadows !== "off";
    if (this.sun.shadow.mapSize.x !== g.shadowMapSize) {
      this.sun.shadow.mapSize.set(g.shadowMapSize, g.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private applyUi(): void {
    document.documentElement.style.setProperty("--ui-scale", String(this.settings.get().ui.uiScale));
    this.controls.zoomSpeed = this.settings.get().ui.invertZoom ? -0.9 : 0.9;
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerDirty = true;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.set(9, 9);
      this.cursorCoord = null;
    });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "F3" || e.key === "`") {
        e.preventDefault();
        this.debug.toggle();
      } else if (e.key === "F8") {
        e.preventDefault();
        this.report.show();
      } else if (e.key === "Escape") {
        if (this.report.visible) this.report.hide();
        else this.settingsPanel.toggle();
      } else if (e.key === " ") {
        this.speed = this.speed === 0 ? 1 : 0;
      }
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      crash.capture({ kind: "context-lost", message: "WebGL context lost" });
    });
  }

  private registerReportContext(): void {
    crash.addContext("bugLine", () => this.hud.bugLineText());
    crash.addContext("seed", () => this.world.seed);
    crash.addContext("tick", () => this.world.tick);
    crash.addContext("checksum", () => this.world.checksum().toString(16));
    crash.addContext("camera", () => ({
      position: this.camera.position.toArray().map((v) => +v.toFixed(2)),
      target: this.controls.target.toArray().map((v) => +v.toFixed(2)),
    }));
    crash.addContext("settings", () => this.settings.get());
    crash.addContext("renderer", () => this.gfx.stats());
    crash.addContext("fps", () => +this.fps.toFixed(1));
    crash.addContext("environment", () => ({
      userAgent: navigator.userAgent,
      language: navigator.language,
      screen: `${screen.width}×${screen.height}@${window.devicePixelRatio}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      cores: navigator.hardwareConcurrency,
      url: location.href,
    }));
    crash.addContext("warnings", () => this.warnings.slice(-10));
  }

  private frame(now: number): void {
    const g = this.settings.get().graphics;
    if (g.maxFps > 0 && now - this.lastRender < 1000 / g.maxFps - 1.5) return;
    const dt = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.lastRender = now;

    // Fixed-step simulation.
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 200) {
      this.world.step();
      this.acc -= TICK_MS;
      steps++;
      this.tickCounter.ticks++;
    }
    if (steps >= 200) this.acc = 0;
    if (now - this.tickCounter.since > 1000) {
      this.tickCounter.rate = (this.tickCounter.ticks * 1000) / (now - this.tickCounter.since);
      this.tickCounter.ticks = 0;
      this.tickCounter.since = now;
    }

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.fps = this.fps * 0.92 + (1000 / dt) * 0.08;

    this.controls.update();
    this.updateSun(now);
    this.updateCursor();
    this.gfx.render();

    const day = this.world.day();
    this.hud.setBugLine([
      `seed ${this.world.seed}`,
      `build ${BUILD.id}`,
      this.cursorCoord ?? `view ${formatLatLon(this.camera.position)}`,
      `${formatDay(day)} (tick ${this.world.tick})`,
    ]);
    this.hud.setFps(this.settings.get().ui.showFps, this.fps);
    this.debug.update();
  }

  private readonly sunDir = new THREE.Vector3();

  private updateSun(now: number): void {
    const f = this.world.day().fraction;
    const theta = (f - 0.5) * Math.PI * 2;
    this.sunDir.set(Math.cos(theta), 0.18, -Math.sin(theta)).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(350);
    const focus = this.camera.position.clone().normalize();
    const elevation = focus.dot(this.sunDir);
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.25, 0.35);
    // From orbit the sky is space; the atmosphere only colours it near the ground.
    const r = this.world.planet.radius;
    const nearGround = 1 - THREE.MathUtils.smoothstep(this.camera.position.length(), r * 1.3, r * 2.4);
    this.sun.intensity = 0.4 + 2.8 * daylight;
    this.sun.color.setHSL(0.08, 0.6 - daylight * 0.35, 0.72 + daylight * 0.2);
    this.hemi.intensity = 0.12 + 0.35 * daylight;
    this.sky.update(this.sunDir, daylight * nearGround, (now - this.clockStart) / 1000, this.gfx.renderer.getPixelRatio());
    const atmo = this.planet?.getObjectByName("atmosphere") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
    if (atmo) (atmo.material.uniforms.uSunDir as THREE.IUniform<THREE.Vector3>).value.copy(this.sunDir);
  }

  private updateCursor(): void {
    if (!this.pointerDirty || !this.planet) return;
    this.pointerDirty = false;
    if (Math.abs(this.pointer.x) > 1) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const land = this.planet.getObjectByName("land");
    const hit = land ? this.raycaster.intersectObject(land, false)[0] : undefined;
    this.cursorCoord = hit ? formatLatLon(hit.point) : null;
  }

  private sampleMemory(): void {
    const stats = this.gfx.stats();
    let objects = 0;
    this.scene.traverse(() => objects++);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const s: MemSample = {
      t: Math.round(performance.now()),
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      geometries: stats.geometries,
      textures: stats.textures,
      programs: stats.programs,
      objects,
    };
    for (const w of this.memory.add(s)) {
      const text = describeLeak(w);
      this.warnings.push(text);
      log.warn(text);
      this.hud.warn(`⚠ ${w.metric} leak?`);
    }
  }

  /** Debug tool: deliberately leak geometries so the leak detector can be verified. */
  private toggleLeakTest(): void {
    if (this.leakTimer !== null) {
      window.clearInterval(this.leakTimer);
      this.leakTimer = null;
      for (const g of this.leakTest) g.dispose();
      this.leakTest = [];
      log.info("Leak test stopped");
      return;
    }
    log.info("Leak test started: allocating one geometry per second");
    this.leakTimer = window.setInterval(() => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const m = new THREE.Mesh(g);
      this.gfx.renderer.render(m, this.camera); // upload to GPU so it counts
      this.leakTest.push(g);
    }, 1000);
  }
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
