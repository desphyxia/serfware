import * as THREE from "three";
import { Ambience, type WorkSound } from "./audio/ambience";
import { BUILD } from "./build";
import { crash } from "./core/crash";
import { log } from "./core/log";
import { describeLeak, MemoryMonitor, type MemSample } from "./core/memory";
import type { SettingsStore } from "./core/settings";
import { PlanetCamera } from "./render/planetCamera";
import { GameRenderer, GRADE } from "./render/renderer";
import { PlatformServices } from "./platform/services";
import { GamepadInput, padActive, type PadAction, type PadState } from "./ui/gamepad";
import { RadialMenu } from "./ui/radialMenu";
import { desktop } from "./platform/bridge";
import { PAINT } from "./render/painterly";
import { FOG, makeFogNode } from "./render/fog";
import { SkyDome } from "./render/sky";
import { WorldView } from "./render/worldView";
import { formatDay, ticksPerDay } from "./sim/clock";
import { Biome, BIOME_NAMES } from "./sim/planet/terrain";
import { Feature } from "./sim/econ/landuse";
import { speciesAt } from "./render/natureView";
import { hashString } from "./sim/rng";
import { normaliseSeed, randomSeedWord } from "./sim/seedwords";
import { World } from "./sim/world";
import { MEMORIAL, type Command } from "./sim/econ/economy";
import type { HostLobby, JoinLobby } from "./net/lobby";
import { makeSave, replaySave, SoloSession, type SaveFile, type Session } from "./net/session";
import { GameMenu, saveMeta, type SaveMeta } from "./ui/gameMenu";
import { demoSettlement, starterChain } from "./sim/econ/planner";
import { Tools } from "./tools";
import { BuildBar, Toasts, type ToolId } from "./ui/buildBar";
import { DebugPanel } from "./ui/debugPanel";
import { EconomyPanel } from "./ui/economyPanel";
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
  session: Session;
  private readonly menu: GameMenu;
  /** Achievements, Steam rich presence, Steam Cloud saves and invites (no-ops on the web). */
  readonly platform: PlatformServices;
  private readonly pad = new GamepadInput();
  /** Radial build menu (controller X, or the mouse). */
  readonly radial: RadialMenu;
  /** Centre reticle shown while playing with a controller: actions apply to the tile under it. */
  private readonly reticle: HTMLElement;
  private padMode = false;
  private padHinted = false;
  private autosaveTimer = 120000;
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
  private readonly economyPanel: EconomyPanel;
  private readonly stock = new StockBar();
  readonly tools: Tools;
  readonly audio: Ambience;
  private audioTimer = 0;
  private waterNear = 0;
  private uiTimer = 0;
  private downAt: { x: number; y: number; button: number } | null = null;
  private readonly loading: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  /** AI rivals in new solo worlds. */
  private rivals = 1;
  private stakes: "wounded" | "mortal" = "wounded";
  /** Fog of war drawn (the debug dialog can lift it). */
  private fogOn = true;
  /** Person the camera follows, or -1. */
  private following = -1;
  private readonly pointer = new THREE.Vector2(9, 9);
  private pointerDirty = false;
  private hoverTile = -1;
  get speed(): number {
    return this.session.speed;
  }
  set speed(v: number) {
    this.session.setSpeed(v);
    if (this.session.info.mode === "solo") this.session.speed = v;
  }
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

    this.world = new World(seed, { rivals: this.rivals });
    this.session = new SoloSession(this.world);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);
    this.gfx = new GameRenderer(canvas, this.scene, this.camera, settings.get().graphics);
    this.sky = new SkyDome(hashString(seed));
    this.scene.add(this.sky.group, this.sun, this.sun.target, this.moon, this.moon.target, this.skyFill, this.skyFill.target, this.viewFill, this.viewFill.target, this.ambient);
    // Aerial perspective and valley mist (values driven from `this.fog` each frame).
    this.scene.fogNode = makeFogNode();
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;

    this.cam = this.makeCamera(canvas);
    this.audio = new Ambience(settings.get().audio);
    this.view = new WorldView(this.world, settings.get().graphics, hashString(seed));
    this.view.setViewer(this.session.player, this.fogOn);
    this.scene.add(this.view.group);
    this.focusStart();
    this.view.terrain.buildAll(this.cam.focus.clone().multiplyScalar(this.world.planet.params.radius * 4));

    this.hud = new Hud({
      settings: () => this.settingsPanel.toggle(),
      debug: () => this.debug.toggle(),
      report: () => this.report.show(),
      menu: () => this.menu.toggle(),
    });
    this.inspector = h("div", { class: "inspector", hidden: true, "aria-live": "polite" });
    this.settingsPanel = new SettingsPanel(settings, {
      seed: () => this.world.seed,
      newWorld: (s, rivals, stakes) => void this.newWorld(s, rivals, stakes),
      rivals: () => this.rivals,
      stakes: () => this.stakes,
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
        "Weather here": () => this.summonWeather(),
        "Skip 6 days": () => this.skipDays(6),
        "Fog of war": () => {
          this.fogOn = !this.fogOn;
          this.view.setViewer(this.session.player, this.fogOn);
        },
        "Visit hamlet": () => this.visitHamlet(),
        "Start a fire": () => this.toasts.show(this.startFire() >= 0 ? "Lightning strikes the woods nearby." : "No woods nearby to burn.", "warn"),
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
      geologist: (flagTile) => {
        if (this.command({ t: "geologist", flagTile })) this.toasts.show("A geologist is on the way.", "good");
      },
      follow: (person) => {
        this.following = person;
        this.info.refresh();
      },
      following: () => this.following,
      player: () => this.session.player,
      attack: (target, count) => {
        if (this.command({ t: "attack", target, count })) this.toasts.show(`${count} warden${count === 1 ? "" : "s"} set out.`, "good");
      },
    });
    this.economyPanel = new EconomyPanel(
      () => this.world.economy,
      () => this.session.player,
      (cmd) => void this.command(cmd),
      (id) => this.info.select({ kind: "person", id }),
    );
    this.tools = new Tools({
      world: () => this.world,
      player: () => this.session.player,
      overlays: () => this.view.overlays,
      command: (cmd) => this.command(cmd),
      notify: (text, kind) => this.toasts.show(text, kind),
      select: (sel: Selection) => this.info.select(sel),
      toolChanged: (id: ToolId) => this.buildBar.setActive(id),
    });
    this.buildBar = new BuildBar(
      (id) => this.tools.set(id),
      () => this.economyPanel.toggle(),
    );
    this.menu = new GameMenu({
      saveNow: (name) => this.saveNow(name),
      listSaves: () => this.listSaves(),
      load: (id) => void this.loadSave(id),
      remove: (id) => this.removeSave(id),
      exportCurrent: () => JSON.stringify(makeSave(this.session, this.world.seed, BUILD.id)),
      importText: (text) => void this.importSave(text),
      seed: () => this.world.seed,
      startSession: (lobby, mode) => this.startHosted(lobby, mode),
      joined: (lobby) => this.watchJoin(lobby),
      notify: (text, kind) => this.toasts.show(text, kind),
    });
    this.radial = new RadialMenu((id) => this.tools.set(id));
    this.reticle = document.createElement("div");
    this.reticle.className = "reticle";
    this.reticle.hidden = true;
    this.platform = new PlatformServices({
      world: () => this.world,
      player: () => this.session.player,
      toast: (text) => this.toasts.show(text, "good"),
      joinSteamLobby: (id) => {
        this.menu.show();
        void this.menu.openSteamJoin(id);
      },
    });
    void this.platform.cloud?.pull().then((n) => {
      if (n) this.toasts.show(`${n} save${n === 1 ? "" : "s"} brought in from Steam Cloud.`, "good");
    });
    this.buildBar.setActive("select");
    container.append(
      this.hud.root,
      this.inspector,
      this.stock.root,
      this.buildBar.root,
      this.toasts.root,
      this.info.root,
      this.economyPanel.root,
      this.menu.root,
      this.debug.root,
      this.settingsPanel.root,
      this.report.root,
      this.radial.root,
      this.reticle,
    );
    this.detectDeck();

    this.applyUi();
    settings.subscribe((s) => {
      this.audio.applySettings(s.audio);
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
        return this.view ? this.view.frames.groundAt(dir, t) : planet.surfaceRadius(t);
      },
      { invertZoom: () => this.settings.get().ui.invertZoom, edgeScroll: () => this.settings.get().ui.edgeScroll },
    );
    cam.attach(canvas);
    return cam;
  }

  /** Issue a player command; failures are explained with a toast. */
  command(cmd: Command): boolean {
    const r = this.session.submit(cmd);
    if (!r.ok && r.reason) this.toasts.show(r.reason, "warn");
    else if (r.ok) log.debug(`cmd ${JSON.stringify(cmd)}`);
    return r.ok;
  }

  /** Start looking at the Hearthship. */
  private focusStart(): void {
    const eco = this.world.economy;
    const keepId = eco.keeps[this.session.player] ?? eco.keep;
    if (keepId >= 0) {
      const keep = eco.buildings[keepId]!;
      this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(keep.tile)), 34);
      return;
    }
    this.focusCoast();
  }

  private forecastCache = { key: "", text: "" };

  /** Season, temperature and weather where the view is, with tomorrow's forecast as a tooltip. */
  private weatherChip(): { text: string; title: string } {
    const w = this.world;
    const f = this.cam.focus;
    const t = w.planet.grid.nearestTile([f.x, f.y, f.z], this.hoverTile >= 0 ? this.hoverTile : 0);
    const c = w.climate;
    const temp = c.temp[t] as number;
    const rain = c.rain[t] as number;
    const y = w.planet.grid.center[t * 3 + 1] as number;
    const season = c.season(w.tick, y);
    const sky = rain > 0.5 ? (temp < 0 ? "Heavy snow" : "Heavy rain") : rain > 0.15 ? (temp < 0 ? "Snow" : "Rain") : rain > 0.05 ? "Drizzle" : "Clear";
    const key = `${t}:${Math.floor(w.tick / 600)}`;
    if (key !== this.forecastCache.key) {
      const fc = c.forecast(w.tick, t, 24);
      this.forecastCache = {
        key,
        text: `Next 24 hours: ${fc.rain > 0.15 ? (fc.snow ? "snow likely" : "rain likely") : fc.rain > 0.05 ? "a shower or two" : "dry"}, ${Math.round(fc.low)} to ${Math.round(fc.high)} °C.`,
      };
    }
    const soil = w.land.soil[t] as number;
    return {
      text: `${season[0]!.toUpperCase()}${season.slice(1)} · ${Math.round(temp)} °C · ${sky}`,
      title: `${this.forecastCache.text}\nSoil here: ${soil > 0.7 ? "rich" : soil > 0.4 ? "fair" : "tired"}${w.land.isRiver(t) ? ", by a river" : ""}.${c.growing(t) ? "" : " Too cold for crops to grow."}`,
    };
  }

  private victoryText(): string | null {
    const eco = this.world.economy;
    if (eco.defeated[this.session.player] && eco.winner < 0) return "Your Hearthship has fallen. Your people carry on elsewhere.";
    if (eco.winner < 0) return null;
    if (eco.winner === this.session.player) return eco.winReason === "wells" ? "Victory: the Star Wells sing for you." : "Victory: the last rival Hearthship has fallen.";
    return "Another settlement has won this world.";
  }

  /** Look at a player's Hearthship (screenshots and tests). */
  focusPlayer(player: number, distance = 40): void {
    const keep = this.world.economy.buildings[this.world.economy.keeps[player] ?? -1];
    if (keep) this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(keep.tile)), distance);
  }

  /** Look at the first building of a type owned by the local player. */
  focusBuilding(type: string, distance = 20): boolean {
    const b = this.world.economy.buildings.find((x) => x.alive && x.def.id === type && x.owner === this.session.player);
    if (b) this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(b.tile)), distance);
    return !!b;
  }

  /** Look at a settler of a role, preferring one on the move and carrying (screenshots). */
  focusSettler(role = "carrier", distance = 5): boolean {
    const pl = this.session.player;
    const all = this.world.economy.settlers.filter((s) => s.alive && s.owner === pl && s.role === role && !["rest", "craft", "guard"].includes(s.state));
    const best = all.find((s) => s.carrying >= 0) ?? all[0];
    if (!best) return false;
    this.focusTile(best.path[best.pi] as number, distance);
    this.following = best.person;
    return true;
  }

  focusTile(tile: number, distance = 20): void {
    this.cam.lookAt(new THREE.Vector3(...this.world.planet.grid.centerOf(tile)), distance);
  }

  selectBuilding(id: number): void {
    this.info.select({ kind: "building", id });
  }

  /** Look at the biggest river near the player's Hearthship (screenshots). */
  focusRiver(distance = 18): boolean {
    const w = this.world;
    const keep = w.economy.buildings[w.economy.keeps[this.session.player] ?? -1];
    if (!keep) return false;
    let best = -1;
    let bestScore = -Infinity;
    for (const t of w.land.ring(keep.tile, 30)) {
      if (!w.land.isRiver(t)) continue;
      const score = (w.land.hydro.flow[t] as number) - w.land.ring(keep.tile, 30).indexOf(t) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best < 0) return false;
    this.focusTile(best, distance);
    return true;
  }

  /** Look at the snowiest land (screenshots). */
  focusSnow(distance = 30): boolean {
    const land = this.world.land;
    let best = -1;
    for (let t = 0; t < land.snowCover.length; t++) if (land.isLand(t) && (best < 0 || (land.snowCover[t] as number) > (land.snowCover[best] as number))) best = t;
    if (best < 0 || (land.snowCover[best] as number) < 0.2) return false;
    // Prefer somewhere on the edge of the snow, where it meets green land.
    const edge = land.ring(best, 8).find((t) => land.isLand(t) && (land.snowCover[t] as number) < 0.1);
    this.focusTile(edge ?? best, distance);
    return true;
  }

  /** Debug: look at the densest grove of one tree species (see natureView's Species). */
  focusSpecies(species: number, distance = 14): boolean {
    const land = this.world.land;
    const { temperature, moisture, biome } = land.planet.terrain;
    const is = (t: number) => land.feature[t] === Feature.Tree && speciesAt(temperature[t] as number, moisture[t] as number, biome[t] as Biome, land.variety[t] as number, land.variety[t] === MEMORIAL) === species;
    let best = -1;
    let bestN = 0;
    for (let t = 0; t < land.feature.length; t++) {
      if (!is(t)) continue;
      const n = land.ring(t, 3).filter(is).length;
      if (n > bestN) {
        bestN = n;
        best = t;
      }
    }
    if (best < 0) return false;
    this.focusTile(best, distance);
    return true;
  }

  /** Debug: bring a weather front over the view. */
  summonWeather(strength = 1): void {
    const f = this.cam.focus;
    const front = this.world.climate.fronts[0];
    if (!front) return;
    Object.assign(front, { x: f.x, y: f.y, z: f.z, radius: 0.35, strength, age: 20, life: 400 });
    this.world.climate.step(this.world.tick);
  }

  /** The art target scene: a grown demo settlement seen from the overview camera in fair weather. */
  visitHamlet(): void {
    const n = demoSettlement(this.world);
    for (let i = 0; i < 6000; i++) this.world.step();
    this.focusPlayer(0, 30);
    this.clearWeather();
    this.toasts.show(`Hamlet: ${n} buildings placed.`, "good");
  }

  /**
   * Debug: lightning in the driest woods near the camera focus (the land around is parched first),
   * then `ticks` of the fire's spread. Returns the tile struck, or -1. Solo games only: this
   * changes the simulation outside the command log.
   */
  startFire(ticks = 0, distance = 18): number {
    const w = this.world;
    const land = w.land;
    const eco = w.economy.ecology;
    const f = this.cam.focus;
    const centre = w.planet.grid.nearestTile([f.x, f.y, f.z], 0);
    let best = -1;
    let most = 0;
    const seen = w.economy.visible[this.session.player];
    for (const t of land.ring(centre, 12)) {
      if (land.feature[t] !== Feature.Tree || (seen && seen[t] !== 1)) continue;
      const n = land.ring(t, 2).filter((m) => land.feature[m] === Feature.Tree).length;
      if (n > most) {
        most = n;
        best = t;
      }
    }
    if (best < 0) return -1;
    for (const t of [best, ...land.ring(best, 7)]) {
      eco.dry[t] = 1;
      land.mud[t] = 0;
      land.snowCover[t] = 0;
    }
    eco.ignite(best);
    for (let i = 0; i < ticks; i++) w.step();
    this.focusTile(best, distance);
    return best;
  }

  /** Screenshot hook: a row of settlers in every work pose near the camera focus. */
  showPoses(distance = 6): void {
    const R = this.world.planet.params.radius;
    const f = this.cam.focus.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(f).normalize();
    const north = f.clone().cross(east).normalize();
    const c = f.clone().multiplyScalar(R).addScaledVector(north, 6);
    const start = c.clone().addScaledVector(east, -3.9);
    this.view.econ.showPoses(start, start.clone().add(east), this.session.player);
    this.cam.lookAt(c.clone().normalize().multiplyScalar(R), distance);
  }

  /** Screenshot hook: a row of building models near the camera focus (see EconView.showcase). */
  showcase(ids: string[], distance = 12, progress?: number[]): void {
    const R = this.world.planet.params.radius;
    const east = new THREE.Vector3(0, 1, 0).cross(this.cam.focus).normalize();
    const north = this.cam.focus.clone().normalize().cross(east).normalize();
    // A few tiles north of the focus, clear of the Hearthship.
    const f = this.cam.focus.clone().normalize().multiplyScalar(R).addScaledVector(north, 9).normalize();
    const spacing = 3.2;
    const start = f.clone().multiplyScalar(R).addScaledVector(east, (-(ids.length - 1) * spacing) / 2);
    this.view.econ.showcase(ids, start, start.clone().addScaledVector(east, 1), this.session.player, spacing, progress);
    this.cam.lookAt(f.clone().multiplyScalar(R), distance);
  }

  /** Screenshot hook: push every weather front to the far side of the planet. */
  clearWeather(): void {
    const f = this.cam.focus;
    for (const front of this.world.climate.fronts) Object.assign(front, { x: -f.x, y: -f.y, z: -f.z });
    this.world.climate.step(this.world.tick);
  }

  /** Debug: jump the calendar forward, letting the weather (and snow) play out on the way. */
  skipDays(days: number): void {
    const w = this.world;
    const perDay = Math.round(w.planet.params.dayLengthHours * 300);
    const steps = Math.round((days * perDay) / 20);
    for (let i = 0; i < steps; i++) {
      w.tick += 20;
      w.climate.step(w.tick);
    }
  }

  setFog(on: boolean): void {
    this.fogOn = on;
    this.view.setViewer(this.session.player, on);
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

  /** Test and screenshot hook: stop the animation loop (frames only via `renderFrames`). */
  hold = false;

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
  /** Open the card of a working person (the most skilled one by default) and optionally follow them. */
  showPerson(follow = true): number {
    const eco = this.world.economy;
    const pl = this.session.player;
    const best = eco
      .peopleOf(pl)
      .filter((p) => p.settler >= 0)
      .sort((a, b) => Math.max(0, ...Object.values(b.skills)) - Math.max(0, ...Object.values(a.skills)) || a.id - b.id)[0];
    if (!best) return -1;
    this.info.select({ kind: "person", id: best.id });
    if (follow) this.following = best.id;
    return best.id;
  }

  /** Open the economy panel on a tab (for screenshots and tests). */
  economyTab(name: string): void {
    this.economyPanel.openTab(name);
  }

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

  async start(): Promise<void> {
    await this.gfx.init();
    log.info(`Renderer: ${this.gfx.backend}`);
    this.resize();
    window.setTimeout(() => this.sampleMemory(), 1000);
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      if (this.hold) return;
      try {
        this.frame(now);
      } catch (err) {
        crash.capture({ kind: "error", message: (err as Error).message, stack: (err as Error).stack });
      }
    };
    requestAnimationFrame(frame);
  }

  async newWorld(seedInput?: string, rivals = this.rivals, stakes = this.stakes): Promise<void> {
    this.rivals = rivals;
    this.stakes = stakes;
    const seed = seedInput && seedInput.trim() ? normaliseSeed(seedInput) : randomSeedWord(Math.floor(Math.random() * 2 ** 32));
    this.loading.hidden = false;
    (this.loading.firstChild as HTMLElement).textContent = seed;
    await new Promise((r) => setTimeout(r, 40));
    const t0 = performance.now();
    this.useSession(new SoloSession(new World(seed, { rivals, stakes })));
    try {
      history.replaceState(null, "", `#${seed}`);
    } catch {
      // Some sandboxes forbid history changes; the seed is still on the bug line.
    }
    this.loading.hidden = true;
    log.info(`New world ${seed}: ${this.world.planet.grid.count} tiles in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Swap in a new world and session (new game, load, or multiplayer start). */
  useSession(session: Session): void {
    this.session.close();
    this.scene.remove(this.view.group);
    this.view.dispose();
    this.session = session;
    this.world = session.world;
    this.view = new WorldView(this.world, this.settings.get().graphics, hashString(this.world.seed));
    this.view.setViewer(session.player, this.fogOn);
    this.scene.add(this.view.group);
    this.cam = this.makeCamera(this.gfx.canvas);
    this.hoverTile = -1;
    this.info.select(null);
    this.following = -1;
    this.tools.set("select");
    this.focusStart();
    this.view.terrain.buildAll(this.cam.focus.clone().multiplyScalar(this.world.planet.params.radius * 4));
    session.onDesync = (detail) => {
      crash.capture({ kind: "desync", message: detail });
      this.toasts.show("The game went out of sync. A report has been prepared (F8).", "warn");
    };
  }

  /** Programmatic multiplayer entry points (used by the menu and the multiplayer test). */
  hostLobby(o: { name: string; server: string; room: string; ice?: RTCIceServer[] }, mode: "shared" | "neighbours"): Promise<HostLobby> {
    return this.menu.openHost(o, mode);
  }

  joinLobby(o: { name: string; server: string; room: string; ice?: RTCIceServer[] }): Promise<JoinLobby> {
    return this.menu.openJoin(o);
  }

  startLobby(lobby: HostLobby, mode: "shared" | "neighbours"): void {
    this.startHosted(lobby, mode);
  }

  private startHosted(lobby: HostLobby, mode: "shared" | "neighbours"): void {
    const seed = this.world.seed;
    this.useSession(lobby.start(seed, mode));
    this.menu.hide();
    this.toasts.show(`Game started with ${lobby.players.length} players.`, "good");
  }

  private watchJoin(lobby: JoinLobby): void {
    lobby.onStart = (session) => {
      this.useSession(session);
      this.menu.hide();
      this.toasts.show(`Joined "${session.world.seed}" as player ${session.localPlayer + 1}.`, "good");
    };
  }

  // ---------------------------------------------------------------- saves

  private readSaves(): SaveMeta[] {
    try {
      return JSON.parse(localStorage.getItem("seedfall.saves") ?? "[]") as SaveMeta[];
    } catch {
      return [];
    }
  }

  listSaves(): SaveMeta[] {
    return this.readSaves().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveNow(name: string, id = `s${Date.now().toString(36)}`): SaveMeta | null {
    const save = makeSave(this.session, name, BUILD.id);
    try {
      localStorage.setItem(`seedfall.save.${id}`, JSON.stringify(save));
      const list = this.readSaves().filter((m) => m.id !== id);
      const meta = saveMeta(id, save);
      list.push(meta);
      localStorage.setItem("seedfall.saves", JSON.stringify(list));
      log.info(`Saved ${id} at tick ${save.tick} (${save.commands.length} commands)`);
      void this.platform?.cloud?.push(id);
      return meta;
    } catch (e) {
      this.toasts.show(`Could not save here: ${(e as Error).message}. Use Copy save instead.`, "warn");
      return null;
    }
  }

  removeSave(id: string): void {
    try {
      localStorage.removeItem(`seedfall.save.${id}`);
      localStorage.setItem("seedfall.saves", JSON.stringify(this.readSaves().filter((m) => m.id !== id)));
      void this.platform.cloud?.remove(id);
    } catch {
      // Nothing to remove when storage is unavailable.
    }
  }

  async loadSave(id: string): Promise<void> {
    let text: string | null;
    try {
      text = localStorage.getItem(`seedfall.save.${id}`);
    } catch {
      text = null;
    }
    if (!text) {
      this.toasts.show("That save could not be read.", "warn");
      return;
    }
    await this.importSave(text);
  }

  async importSave(text: string): Promise<void> {
    let save: SaveFile;
    try {
      save = JSON.parse(text) as SaveFile;
    } catch {
      this.toasts.show("That doesn't look like a Seedfall save.", "warn");
      return;
    }
    this.loading.hidden = false;
    (this.loading.firstChild as HTMLElement).textContent = save.name || save.seed;
    await new Promise((r) => setTimeout(r, 40));
    try {
      const { world, matches, log: cmds } = replaySave(save);
      const session = new SoloSession(world);
      session.log.push(...cmds);
      this.useSession(session);
      this.menu.hide();
      this.toasts.show(matches ? `Loaded "${save.name}".` : `Loaded "${save.name}", but this build simulates differently, so it may not match exactly.`, matches ? "good" : "warn");
    } catch (e) {
      crash.capture({ kind: "error", message: `Load failed: ${(e as Error).message}`, stack: (e as Error).stack });
    } finally {
      this.loading.hidden = true;
    }
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
      // Back on the mouse: hide the controller reticle.
      if (this.padMode && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) {
        this.padMode = false;
        this.reticle.hidden = true;
      }
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
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
        // Dragging the view lets go of a followed settler.
        if (d.button === 0 && this.following >= 0) {
          this.following = -1;
          this.info.refresh();
        }
        return;
      }
      if (d.button === 0) {
        if (this.tools.tool === "select" && this.pickPerson()) return;
        this.tools.click(this.hoverTile);
      }
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
        this.escape();
      } else if (e.key === " ") {
        e.preventDefault();
        this.speed = this.speed === 0 ? 1 : 0;
      } else if (e.key.toLowerCase() === "m") {
        this.menu.toggle();
      } else if (e.key.toLowerCase() === "g") {
        this.view.setGrid(!this.view.grid);
      } else this.buildBar.key(e.key);
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      crash.capture({ kind: "context-lost", message: "WebGL context lost" });
    });
  }

  /** Escape (or B on a controller): close the innermost thing, else open the settings. */
  private escape(): void {
    if (this.radial.open) this.radial.back();
    else if (this.report.visible) this.report.hide();
    else if (this.buildBar.closePopover()) return;
    else if (this.tools.cancel()) return;
    else if (this.info.visible) this.info.hide();
    else if (this.menu.visible) this.menu.hide();
    else if (this.economyPanel.visible) this.economyPanel.hide();
    else this.settingsPanel.toggle();
  }

  /** Steam Deck (the desktop build reports it; SteamOS's browser says so too): its preset on first run. */
  private detectDeck(): void {
    const apply = () => {
      try {
        if (localStorage.getItem("seedfall.deckPreset")) return;
        localStorage.setItem("seedfall.deckPreset", "1");
      } catch {
        // No storage: apply every time, which is harmless.
      }
      this.settings.applyPreset("deck");
      this.toasts.show("Steam Deck detected: using the Deck preset (Settings to change).", "good");
    };
    if (new URLSearchParams(location.search).get("deck") === "1" || /Steam Deck|SteamOS/i.test(navigator.userAgent)) apply();
    else void desktop()?.steamUser().then((u) => u?.deck && apply());
  }

  /** Screenshot hook: show the controller reticle as if a pad were in use. */
  controllerPreview(on = true): void {
    this.padMode = on;
    this.reticle.hidden = !on;
    if (on) {
      this.pointer.set(0, 0);
      this.pointerDirty = true;
    }
  }

  /** Controller: camera on the sticks and triggers, actions on the tile under the reticle. */
  private pollPad(dt: number): void {
    const p = this.pad.poll();
    if (!p) return;
    const { state: s, actions } = p;
    if (padActive(s) && !this.padMode) {
      this.padMode = true;
      this.reticle.hidden = false;
      if (!this.padHinted) {
        this.padHinted = true;
        this.toasts.show("Controller: left stick moves, right stick turns, triggers zoom. A acts on the ring, X builds, B goes back, Y economy.", "info");
      }
    }
    if (!this.padMode) return;
    if (this.radial.open) {
      this.radial.aim(s.lx, s.ly);
      for (const a of actions) {
        if (a === "confirm") this.radial.confirm();
        else if (a === "back" || a === "radial") this.radial.back();
      }
      return;
    }
    this.padCamera(s, dt);
    this.pointer.set(0, 0);
    this.pointerDirty = true;
    for (const a of actions) this.padAction(a);
  }

  private padCamera(s: PadState, dt: number): void {
    const sec = dt / 1000;
    const speed = 900 * sec;
    if (s.lx || s.ly) {
      this.cam.pan(s.lx * speed, -s.ly * speed, 900);
      if (this.following >= 0) this.following = -1;
    }
    if (s.rx) this.cam.rotate(-s.rx * 1.8 * sec);
    if (s.ry) this.cam.tilt(-s.ry * 0.9 * sec);
    if (s.lt > 0.05 || s.rt > 0.05) this.cam.zoomBy(Math.exp((s.lt - s.rt) * 1.8 * sec));
  }

  private padAction(a: PadAction): void {
    switch (a) {
      case "confirm":
        if (this.tools.tool === "select" && this.pickPerson()) return;
        this.tools.click(this.hoverTile);
        return;
      case "back":
        this.escape();
        return;
      case "radial":
        this.radial.show();
        return;
      case "economy":
        this.economyPanel.toggle();
        return;
      case "menu":
        this.menu.toggle();
        return;
      case "settings":
        this.settingsPanel.toggle();
        return;
      case "road":
      case "flag":
        this.tools.set(a);
        return;
      case "pause":
        this.speed = this.speed === 0 ? 1 : 0;
        return;
      case "grid":
        this.view.setGrid(!this.view.grid);
        return;
      case "centre":
        this.focusStart();
        return;
    }
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

    const steps = this.session.advance(dt);
    this.platform.update(dt / 1000);
    this.pollPad(dt);
    this.tickCounter.ticks += steps;
    this.hud.setBanner(this.session.status() ?? this.victoryText());
    if (this.session.info.mode === "solo") {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = 120000;
        if (this.session.log.length > 0) this.saveNow(`Autosave · ${this.world.seed}`, "autosave");
      }
    }
    if (now - this.tickCounter.since > 1000) {
      this.tickCounter.rate = (this.tickCounter.ticks * 1000) / (now - this.tickCounter.since);
      this.tickCounter.ticks = 0;
      this.tickCounter.since = now;
    }
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.fps = this.fps * 0.92 + (1000 / dt) * 0.08;

    this.updateFollow();
    this.cam.update(dt / 1000);
    this.updateEnvironment(now, dt / 1000);
    this.updateHover();
    this.tools.hoverTile(this.hoverTile);
    const eco = this.world.economy;
    while (eco.notices.length) {
      const n = eco.notices.shift() as { owner: number; text: string };
      if (n.owner === this.session.player) this.toasts.show(n.text, "good");
    }
    this.audioTimer -= dt;
    if (this.audioTimer <= 0) {
      this.audioTimer = 100;
      this.updateAudio();
    }
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 400;
      this.stock.update(eco, this.session.player, this.weatherChip());
      this.info.refresh();
      this.economyPanel.refresh();
    }
    this.view.updateTerrain(this.camera.position);
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

  /** Colour grade and painterly light for the time of day, plus close-up depth of field. */
  private applyGrade(elevation: number): void {
    const day = this.daylight;
    const night = 1 - day;
    const dusk = Math.exp(-Math.pow(elevation * 4, 2)) * THREE.MathUtils.smoothstep(elevation, -0.25, 0.05) + Math.exp(-Math.pow(elevation * 4, 2)) * 0.4;
    const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // Seasons shift the grade: autumn warmer and richer, winter cooler and brighter.
    const f = this.cam.focus;
    const ft = this.world.planet.grid.nearestTile([f.x, f.y, f.z], 0);
    const season = this.view.seasonAt(ft);
    const autumn = season.autumn;
    const winter = Math.min(1, season.snow * 1.5);
    let hi = mix3([1.05, 1.02, 0.95], [1.14, 1.0, 0.82], Math.min(1, dusk));
    hi = mix3(hi, [1.12, 1.01, 0.86], autumn * 0.5);
    hi = mix3(hi, [1.0, 1.02, 1.06], winter * 0.6);
    hi = mix3(hi, [0.9, 0.96, 1.1], night);
    let lo = mix3([0.94, 0.96, 1.07], [0.92, 0.88, 1.16], Math.min(1, dusk));
    lo = mix3(lo, [0.9, 0.93, 1.16], winter * 0.6);
    lo = mix3(lo, [0.84, 0.93, 1.22], night);
    GRADE.highlightTint.value.setRGB(...hi);
    GRADE.shadowTint.value.setRGB(...lo);
    GRADE.exposure.value = 1.0 + night * 0.3 + winter * 0.06;
    GRADE.saturation.value = 1.08 + Math.min(1, dusk) * 0.1 - night * 0.3 + autumn * 0.08 - winter * 0.12;
    let rim = mix3([1.0, 0.86, 0.66], [1.0, 0.68, 0.42], Math.min(1, dusk));
    rim = mix3(rim, [0.7, 0.8, 1.0], night);
    PAINT.rimColor.value.setRGB(...rim);
    PAINT.coolFill.value.copy(this.sky.zenith).lerp(new THREE.Color(0.55, 0.62, 0.9), 0.5);
    PAINT.coolFillStrength.value = 0.22 + night * 0.15;
    const dofOn = this.settings.get().graphics.dof;
    GRADE.dofAmount.value = dofOn ? 1 - THREE.MathUtils.smoothstep(this.cam.distance, 10, 24) : 0;
    GRADE.dofFocus.value = this.cam.distance;
  }

  private updateEnvironment(now: number, dt: number): void {
    const p = this.world.planet.params;
    const f = this.world.day().fraction;
    // The subsolar point moves west as the planet turns east, so local noon is at lon = -theta.
    const theta = -(f - 0.5) * Math.PI * 2;
    // The sun climbs and sinks with the seasons (northern summer at year phase 0.375).
    const dec = p.axialTilt * Math.sin((this.world.climate.yearPhase(this.world.tick) - 0.125) * Math.PI * 2);
    this.sunDir.set(Math.cos(dec) * Math.cos(theta), Math.sin(dec), -Math.cos(dec) * Math.sin(theta)).normalize();

    const R = p.radius;
    const camPos = this.camera.position;
    const up = camPos.clone().normalize();
    const ground = this.cam.groundPoint();
    const local = ground.clone().normalize();
    const elevation = local.dot(this.sunDir);
    this.daylight = THREE.MathUtils.smoothstep(elevation, -0.2, 0.3);
    this.applyGrade(elevation);
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
    FOG.near.value = this.fog.near;
    FOG.far.value = this.fog.far;
    FOG.color.value.copy(this.fog.color);
    FOG.radius.value = R;
    // Valley mist around dawn (and a little after rain), fading as the sun climbs.
    {
      const w = this.world;
      const t = w.planet.grid.nearestTile([local.x, local.y, local.z], 0);
      const damp = Math.min(1, 0.45 + (w.land.soil[t] as number) * 0.3 + (w.climate.rain[t] as number) * 0.8);
      const morning = f < 0.5 ? 1 : 0.2;
      const dawn = THREE.MathUtils.smoothstep(elevation, -0.12, 0.02) * (1 - THREE.MathUtils.smoothstep(elevation, 0.12, 0.38));
      const target = dawn * morning * damp * air;
      FOG.valley.value += (target - FOG.valley.value) * Math.min(1, dt * 0.8);
      FOG.valleyColor.value.copy(this.sky.horizon).lerp(new THREE.Color(0.92, 0.9, 0.9), 0.55).multiplyScalar(0.4 + 0.6 * this.daylight);
      // Snow lying at the focus settles on roofs.
      const snow = w.land.snowCover[t] as number;
      PAINT.snow.value += (snow - PAINT.snow.value) * Math.min(1, dt * 0.5);
    }
    const gs = this.settings.get().graphics;
    this.view.update({ time, dt, vegetation: gs.vegetation, particles: gs.particles, focus: this.cam.focus, pixelRatio: this.gfx.renderer.getPixelRatio(), sunDir: this.sunDir, sky: this.sky.horizon, daylight: this.daylight, orbit: 1 - air, fog: air > 0.02 ? this.fog : null, closeness, ground: this.cam.groundPoint(), distance: this.cam.distance });
  }

  private updateAudio(): void {
    if (!this.audio.running) return;
    const R = this.world.planet.params.radius;
    const land = this.world.land;
    const focusTile = this.world.planet.grid.nearestTile([this.cam.focus.x, this.cam.focus.y, this.cam.focus.z], this.hoverTile >= 0 ? this.hoverTile : 0);
    const ring = land.ring(focusTile, 6);
    this.waterNear = ring.filter((t) => !land.isLand(t)).length / ring.length;
    const ground = this.cam.groundPoint();
    const work: WorkSound[] = [];
    const eco = this.world.economy;
    const v = new THREE.Vector3();
    for (const s of eco.settlers) {
      if (!s.alive) continue;
      const b = s.building >= 0 ? eco.buildings[s.building] : undefined;
      let kind: WorkSound["kind"] | null = null;
      if (s.role === "worker" && s.state === "work") kind = b?.def.job === "fell" ? "chop" : b?.def.job === "quarry" ? "clink" : null;
      else if (s.role === "builder" && s.state === "work" && b && b.delivered.reduce((a, x) => a + x, 0) > b.consumed) kind = "hammer";
      else if (s.role === "worker" && s.state === "craft" && b?.def.id === "sawmill") kind = "saw";
      if (!kind) continue;
      this.view.frames.pos(s.path[s.pi] as number, 0, v);
      const distance = v.distanceTo(ground) + this.cam.distance * 0.35;
      const pan = v.clone().project(this.camera).x;
      work.push({ kind, distance, pan, id: s.id });
    }
    this.audio.update(
      {
        daylight: this.daylight,
        closeness: this.cam.closeness(),
        water: this.waterNear,
        altitude: THREE.MathUtils.smoothstep(this.camera.position.length(), R * 1.1, R * 2.5),
        wind: 0.35 + (this.world.climate.rain[focusTile] as number) * 0.4,
        rain: (this.world.climate.temp[focusTile] as number) > 0.5 ? (this.world.climate.rain[focusTile] as number) : 0,
      },
      work,
    );
  }

  /** Select the settler under the pointer, if any. */
  private pickPerson(): boolean {
    if (Math.abs(this.pointer.x) > 1) return false;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const id = this.view.econ.pickSettler(this.raycaster, Math.max(0.35, this.cam.distance * 0.012));
    const s = id >= 0 ? this.world.economy.settlers[id] : undefined;
    if (!s || s.person < 0 || s.owner !== this.session.player) return false;
    this.info.select({ kind: "person", id: s.person });
    return true;
  }

  /** Keep the camera on the followed person: their walker outside, their home inside. */
  private updateFollow(): void {
    if (this.following < 0) return;
    const eco = this.world.economy;
    const p = eco.people[this.following];
    if (!p || !p.alive) {
      this.following = -1;
      return;
    }
    const pos = p.settler >= 0 ? this.view.econ.settlerPosition(p.settler) : null;
    if (pos) this.cam.follow(pos);
    else {
      const home = eco.buildings[p.house >= 0 ? p.house : (eco.keeps[p.owner] ?? -1)];
      if (home) this.cam.follow(new THREE.Vector3(...this.world.planet.grid.centerOf(home.tile)));
    }
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
      this.gfx.renderOnce(new THREE.Mesh(g));
      this.leakTest.push(g);
    }, 1000);
  }
}
