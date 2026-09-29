import * as THREE from "three";
import { BUILD } from "./build";
import { crash } from "./core/crash";
import { log } from "./core/log";
import { describeLeak, MemoryMonitor, type MemSample } from "./core/memory";
import type { SettingsStore } from "./core/settings";
import { PlanetCamera } from "./render/planetCamera";
import { GameRenderer } from "./render/renderer";
import { SkyDome } from "./render/sky";
import { WorldView } from "./render/worldView";
import { formatDay, TICK_MS, ticksPerDay } from "./sim/clock";
import { BIOME_NAMES } from "./sim/planet/terrain";
import { hashString } from "./sim/rng";
import { normaliseSeed, randomSeedWord } from "./sim/seedwords";
import { World } from "./sim/world";
import type { Command } from "./sim/econ/economy";
import { starterChain } from "./sim/econ/planner";
import { Tools } from "./tools";
import { BuildBar, Toasts, type ToolId } from "./ui/buildBar";
import { DebugPanel } from "./ui/debugPanel";
import { InfoPanel, StockBar, type Selection } from "./ui/infoPanel";
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
  view: WorldView;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  cam: PlanetCamera;
  readonly gfx: GameRenderer;
  readonly memory = new MemoryMonitor();
  private readonly sky: SkyDome;
  private readonly sun = new THREE.DirectionalLight("#fff1dc", 3);
  private readonly moon = new THREE.DirectionalLight("#8aa2e0", 0.6);
  private readonly ambient = new THREE.AmbientLight("#8a9cc4", 0.3);
  /** Local sky light from straight above the view, acting like a hemisphere light on a sphere. */
  private readonly skyFill = new THREE.DirectionalLight("#b9cbe8", 0.6);
  /** Soft light from the viewer so shaded sides of buildings stay readable. */
  private readonly viewFill = new THREE.DirectionalLight("#ffe8d0", 0.35);
  private readonly fog = new THREE.Fog("#000000", 1e6, 2e6);
  private readonly hud: Hud;
  private readonly debug: DebugPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly report: ReportPanel;
  private readonly inspector: HTMLElement;
  private readonly buildBar: BuildBar;
  private readonly toasts = new Toasts();
  private readonly info: InfoPanel;
  private readonly stock = new StockBar();
  readonly tools: Tools;
  private uiTimer = 0;
  private downAt: { x: number; y: number; button: number } | null = null;
  private readonly loading: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(9, 9);
  private pointerDirty = false;
  private hoverTile = -1;
  speed = 1;
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
  private readonly sunDir = new THREE.Vector3(1, 0, 0);
  private daylight = 1;

  constructor(
    private readonly container: HTMLElement,
    private readonly settings: SettingsStore,
    seed: string,
  ) {
    const canvas = h("canvas", { class: "view", "aria-label": "Game view" }) as HTMLCanvasElement;
    container.append(canvas);
    this.loading = h("div", { class: "loading", hidden: true }, h("div", { class: "loading-seed" }), h("div", { class: "loading-msg" }, "Shaping the planet…"));
    container.append(this.loading);

    this.world = new World(seed);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);
    this.gfx = new GameRenderer(canvas, this.scene, this.camera, settings.get().graphics);
    this.sky = new SkyDome(hashString(seed));
    this.scene.add(this.sky.group, this.sun, this.sun.target, this.moon, this.moon.target, this.skyFill, this.skyFill.target, this.viewFill, this.viewFill.target, this.ambient);
    this.scene.fog = this.fog;
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;

    this.cam = this.makeCamera(canvas);
    this.view = new WorldView(this.world, settings.get().graphics, hashString(seed));
    this.scene.add(this.view.group);
    this.focusStart();

    this.hud = new Hud({
      settings: () => this.settingsPanel.toggle(),
      debug: () => this.debug.toggle(),
      report: () => this.report.show(),
    });
    this.inspector = h("div", { class: "inspector", hidden: true, "aria-live": "polite" });
    this.settingsPanel = new SettingsPanel(settings, {
      seed: () => this.world.seed,
      newWorld: (s) => void this.newWorld(s),
    });
    this.report = new ReportPanel();
    this.debug = new DebugPanel({
      fps: () => this.fps,
      frameTimes: () => this.frameTimes,
      render: () => this.gfx.stats(),
      memory: () => this.memory.samples,
      sim: () => ({ tick: this.world.tick, ticksPerSec: this.tickCounter.rate, checksum: this.world.checksum(), speed: this.speed }),
      extra: () => this.planetInfo(),
      warnings: () => this.warnings,
      actions: {
        "Speed ×1": () => (this.speed = 1),
        "×8": () => (this.speed = 8),
        "×64": () => (this.speed = 64),
        "Pause": () => (this.speed = 0),
        "Grid (G)": () => this.view.setGrid(!this.view.grid),
        "Starter chain": () => this.toasts.show(`Placed ${starterChain(this.world)} buildings with roads.`, "good"),
        "Test crash": () =>
          setTimeout(() => {
            throw new Error("Test crash triggered from the debug dialog");
          }),
        "Leak test": () => this.toggleLeakTest(),
        "Sample memory": () => this.sampleMemory(),
      },
    });
    this.info = new InfoPanel(() => this.world.economy, {
      demolishTile: (tile) => {
        this.command({ t: "demolish", tile });
        this.info.select(null);
      },
    });
    this.tools = new Tools({
      world: () => this.world,
      overlays: () => this.view.overlays,
      command: (cmd) => this.command(cmd),
      notify: (text, kind) => this.toasts.show(text, kind),
      select: (sel: Selection) => this.info.select(sel),
      toolChanged: (id: ToolId) => this.buildBar.setActive(id),
    });
    this.buildBar = new BuildBar((id) => this.tools.set(id));
    this.buildBar.setActive("select");
    container.append(
      this.hud.root,
      this.inspector,
      this.stock.root,
      this.buildBar.root,
      this.toasts.root,
      this.info.root,
      this.debug.root,
      this.settingsPanel.root,
      this.report.root,
    );

    this.applyUi();
    settings.subscribe((s) => {
      this.gfx.apply(s.graphics);
      this.applyShadowSettings();
      this.applyUi();
    });
    this.applyShadowSettings();
    this.bindInput(canvas);
    this.registerReportContext();
    crash.setMemorySource(() => this.memory.samples);
    window.setInterval(() => this.sampleMemory(), 5000);
    log.info(`World ${seed} ready: ${this.world.planet.grid.count} tiles, wells "${this.world.planet.grid.wellStyle}"`);
  }

  private makeCamera(canvas: HTMLCanvasElement): PlanetCamera {
    const planet = this.world.planet;
    const cam = new PlanetCamera(
      this.camera,
      planet.params.radius,
      (dir) => {
        const t = planet.grid.nearestTile([dir.x, dir.y, dir.z], this.hoverTile >= 0 ? this.hoverTile : 0);
        return planet.surfaceRadius(t);
      },
      { invertZoom: () => this.settings.get().ui.invertZoom, edgeScroll: () => this.settings.get().ui.edgeScroll },
    );
    cam.attach(canvas);
    return cam;
  }

  /** Issue a player command; failures are explained with a toast. */
  command(cmd: Command): boolean {
    const r = this.world.command(cmd);
    if (!r.ok && r.reason) this.toasts.show(r.reason, "warn");
    else if (r.ok) log.debug(`cmd ${JSON.stringify(cmd)}`);
    return r.ok;
  }

  /** Start looking at the Hearthship. */
  private focusStart(): void {
    const eco = this.world.economy;
    if (eco.keep >= 0) {
      const keep = eco.buildings[eco.keep]!;
      this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(keep.tile)), 34);
      return;
    }
    this.focusCoast();
  }

  /** Fallback: a pleasant coast, the land tile with some water nearby. */
  private focusCoast(): void {
    const { grid, terrain } = this.world.planet;
    let best = 0;
    let bestScore = -1;
    for (let t = 0; t < grid.count; t += 7) {
      const e = terrain.elevation[t] as number;
      if (e <= 0.2 || e > terrain.params.mountainHeight * 0.4) continue;
      let water = 0;
      for (const n of grid.neighborsOf(t)) for (const m of grid.neighborsOf(n)) if ((terrain.elevation[m] as number) < 0) water++;
      const lat = Math.abs(grid.center[t * 3 + 1] as number);
      const score = (water > 0 && water < 8 ? 10 : 0) + (1 - lat) * 5 + (terrain.moisture[t] as number) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    this.cam.lookAt(new THREE.Vector3(...grid.centerOf(best)), this.world.planet.params.radius * 2.4);
  }

  /** Test and screenshot hook: jump the clock to an hour of the current day. */
  setHour(hour: number): void {
    const perHour = ticksPerDay(this.world.planet.params.dayLengthHours) / 24;
    const d = this.world.localDay(this.focusLon());
    const current = d.hour + d.minute / 60;
    if (hour < current) hour += 24;
    this.world.tick = Math.max(0, this.world.tick + Math.round((hour - current) * perHour));
  }

  /** Test and screenshot hook: run frames synchronously (software renderers are very slow). */
  renderFrames(n: number): void {
    let t = performance.now();
    for (let i = 0; i < n; i++) {
      t += 16.7;
      this.lastRender = 0;
      this.frame(t);
    }
  }

  /** Test and screenshot hook: set camera distance, heading and tilt instantly. */
  setView(distance: number, heading = 0, pitchOffset = 0): void {
    this.cam.snap(distance, heading, pitchOffset);
  }

  /** Longitude of the camera focus as a fraction of a full turn, east positive. */
  focusLon(): number {
    const f = this.cam.focus;
    return Math.atan2(-f.z, f.x) / (Math.PI * 2);
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

  async newWorld(seedInput?: string): Promise<void> {
    const seed = seedInput && seedInput.trim() ? normaliseSeed(seedInput) : randomSeedWord(Math.floor(Math.random() * 2 ** 32));
    this.loading.hidden = false;
    (this.loading.firstChild as HTMLElement).textContent = seed;
    await new Promise((r) => setTimeout(r, 40));
    const t0 = performance.now();
    this.scene.remove(this.view.group);
    this.view.dispose();
    this.world = new World(seed);
    this.view = new WorldView(this.world, this.settings.get().graphics, hashString(seed));
    this.scene.add(this.view.group);
    this.cam = this.makeCamera(this.gfx.canvas);
    this.hoverTile = -1;
    this.info.select(null);
    this.tools.set("select");
    this.focusStart();
    try {
      history.replaceState(null, "", `#${seed}`);
    } catch {
      // Some sandboxes forbid history changes; the seed is still on the bug line.
    }
    this.loading.hidden = true;
    log.info(`New world ${seed}: ${this.world.planet.grid.count} tiles in ${(performance.now() - t0).toFixed(0)} ms`);
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
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerDirty = true;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.set(9, 9);
      this.setHover(-1);
    });
    canvas.addEventListener("pointerdown", (e) => {
      this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
    });
    canvas.addEventListener("pointerup", (e) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (d.button === 0) this.tools.click(this.hoverTile);
      else if (d.button === 2) this.tools.cancel();
    });
    canvas.addEventListener("dblclick", () => {
      if (this.hoverTile >= 0) this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(this.hoverTile)));
    });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
      if (e.key === "F3" || e.key === "`") {
        e.preventDefault();
        this.debug.toggle();
      } else if (e.key === "F8") {
        e.preventDefault();
        this.report.show();
      } else if (e.key === "Escape") {
        if (this.report.visible) this.report.hide();
        else if (this.tools.cancel()) return;
        else if (this.info.visible) this.info.hide();
        else this.settingsPanel.toggle();
      } else if (e.key === " ") {
        e.preventDefault();
        this.speed = this.speed === 0 ? 1 : 0;
      } else if (e.key.toLowerCase() === "g") {
        this.view.setGrid(!this.view.grid);
      } else {
        const tool = this.buildBar.toolForKey(e.key);
        if (tool) this.tools.set(tool);
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
    crash.addContext("planet", () => this.planetInfo());
    crash.addContext("camera", () => ({
      focus: this.cam.focus.toArray().map((v) => +v.toFixed(4)),
      distance: +this.cam.distance.toFixed(2),
      heading: +this.cam.heading.toFixed(3),
      position: this.camera.position.toArray().map((v) => +v.toFixed(2)),
    }));
    crash.addContext("hoverTile", () => this.hoverTile);
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

  private planetInfo(): Record<string, string> {
    const p = this.world.planet;
    const land = p.terrain.elevation.reduce((n, e) => n + (e > 0 ? 1 : 0), 0) / p.grid.count;
    return {
      Tiles: `${p.grid.count.toLocaleString("en")} (${p.params.size})`,
      "Star Wells": p.grid.wellStyle,
      Radius: p.params.radius.toFixed(1),
      Day: `${p.params.dayLengthHours} h`,
      Tilt: `${(p.params.axialTilt * RAD).toFixed(1)}°`,
      Gravity: `${p.params.gravity} g`,
      Land: `${Math.round(land * 100)} %`,
    };
  }

  private frame(now: number): void {
    const g = this.settings.get().graphics;
    if (g.maxFps > 0 && now - this.lastRender < 1000 / g.maxFps - 1.5) return;
    const dt = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.lastRender = now;

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

    this.cam.update(dt / 1000);
    this.updateEnvironment(now, dt / 1000);
    this.updateHover();
    this.tools.hoverTile(this.hoverTile);
    const eco = this.world.economy;
    while (eco.notices.length) this.toasts.show(eco.notices.shift() as string, "good");
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 400;
      this.stock.update(eco);
      this.info.refresh();
    }
    this.gfx.render();

    const day = this.world.localDay(this.focusLon());
    const where =
      this.hoverTile >= 0
        ? `tile ${this.hoverTile} ${formatLatLon(new THREE.Vector3(...this.world.planet.grid.centerOf(this.hoverTile)))}`
        : `view ${formatLatLon(this.cam.focus)}`;
    this.hud.setBugLine([`seed ${this.world.seed}`, `build ${BUILD.id}`, where, `${formatDay(day)} local (tick ${this.world.tick})`]);
    this.hud.setFps(this.settings.get().ui.showFps, this.fps);
    this.debug.update();
  }

  private updateEnvironment(now: number, dt: number): void {
    const p = this.world.planet.params;
    const f = this.world.day().fraction;
    // The subsolar point moves west as the planet turns east, so local noon is at lon = -theta.
    const theta = -(f - 0.5) * Math.PI * 2;
    // Fixed mid-season declination until seasons arrive in batch 10.
    const dec = p.axialTilt * 0.5;
    this.sunDir.set(Math.cos(dec) * Math.cos(theta), Math.sin(dec), -Math.cos(dec) * Math.sin(theta)).normalize();

    const R = p.radius;
    const camPos = this.camera.position;
    const up = camPos.clone().normalize();
    const ground = this.cam.groundPoint();
    const local = ground.clone().normalize();
    const elevation = local.dot(this.sunDir);
    this.daylight = THREE.MathUtils.smoothstep(elevation, -0.2, 0.3);
    const air = 1 - THREE.MathUtils.smoothstep(camPos.length(), R * 1.25, R * 2.1);
    const closeness = this.cam.closeness();
    const time = (now - this.clockStart) / 1000;

    const shadowSpan = THREE.MathUtils.clamp(this.cam.distance * 1.1, 18, R * 1.3);
    this.sun.position.copy(ground).addScaledVector(this.sunDir, R * 2.5);
    this.sun.target.position.copy(ground);
    const sc = this.sun.shadow.camera;
    if (sc.right !== shadowSpan) {
      sc.left = sc.bottom = -shadowSpan;
      sc.right = sc.top = shadowSpan;
      sc.near = 1;
      sc.far = R * 5;
      sc.updateProjectionMatrix();
    }
    const sunUp = THREE.MathUtils.smoothstep(elevation, -0.12, 0.12);
    this.sun.intensity = 3.1 * sunUp + 0.05;
    const warm = 1 - THREE.MathUtils.smoothstep(elevation, 0.0, 0.35);
    this.sun.color.setRGB(1, 0.93 - warm * 0.3, 0.84 - warm * 0.45);
    this.moon.position.copy(ground).addScaledVector(this.sunDir, -R * 2.5);
    this.moon.target.position.copy(ground);
    this.moon.intensity = 0.75 * (1 - this.daylight) + 0.05;
    this.ambient.intensity = 0.22 + 0.18 * this.daylight;
    this.skyFill.position.copy(ground).addScaledVector(local, R);
    this.skyFill.target.position.copy(ground);
    this.skyFill.intensity = 0.25 + 0.75 * this.daylight;
    this.viewFill.position.copy(camPos);
    this.viewFill.target.position.copy(ground);
    this.viewFill.intensity = (0.12 + 0.3 * this.daylight) * closeness;
    this.skyFill.color.copy(this.sky.zenith).lerp(new THREE.Color("#c8d6ee"), 0.6);

    this.sky.update(this.camera, this.sunDir, up, air, time, this.gfx.renderer.getPixelRatio(), this.settings.get().graphics.atmosphere === "scattering" ? 1 : 0.4);
    if (air > 0.02) {
      this.fog.color.copy(this.sky.horizon);
      this.fog.near = this.cam.distance * 1.6;
      this.fog.far = this.cam.distance * 1.6 + R * (3.2 - air * 1.2);
    } else {
      this.fog.near = 1e6;
      this.fog.far = 2e6;
    }
    this.view.update({ time, dt, vegetation: this.settings.get().graphics.vegetation, sunDir: this.sunDir, sky: this.sky.horizon, daylight: this.daylight, orbit: 1 - air, fog: air > 0.02 ? this.fog : null, closeness });
  }

  private updateHover(): void {
    if (!this.pointerDirty) return;
    this.pointerDirty = false;
    if (Math.abs(this.pointer.x) > 1) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.setHover(this.view.pick(this.raycaster.ray, this.hoverTile >= 0 ? this.hoverTile : 0));
  }

  private setHover(tile: number): void {
    this.hoverTile = tile;
    this.view.highlight.set(this.world.planet, tile);
    if (tile < 0) {
      this.inspector.hidden = true;
      return;
    }
    const { terrain, grid } = this.world.planet;
    const e = terrain.elevation[tile] as number;
    const rows: [string, string][] = [
      ["Tile", `${tile}${grid.degree(tile) === 5 ? " · Star Well" : ""}`],
      ["Ground", BIOME_NAMES[terrain.biome[tile] as number] ?? "?"],
      [e >= 0 ? "Height" : "Depth", `${Math.round(Math.abs(e) * 90)} m`],
      ["Temperature", `${(terrain.temperature[tile] as number).toFixed(0)} °C`],
      ["Moisture", `${Math.round((terrain.moisture[tile] as number) * 100)} %`],
    ];
    this.inspector.replaceChildren(h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    this.inspector.hidden = false;
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
      this.gfx.renderer.render(new THREE.Mesh(g), this.camera);
      this.leakTest.push(g);
    }, 1000);
  }
}
