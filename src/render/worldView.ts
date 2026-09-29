import * as THREE from "three/webgpu";
import type { PainterlyMaterial } from "./painterly";
import type { GraphicsSettings } from "../core/settings";
import type { World } from "../sim/world";
import { AtmosphereShell, CloudLayer } from "./atmosphere";
import { EconView } from "./econView";
import { Fauna } from "./fauna";
import { GrassPatch } from "./grass";
import { Particles } from "./smoke";
import { WIND } from "./wind";
import { SurfaceFrames } from "./frames";
import { NatureView } from "./natureView";
import { Overlays } from "./overlays";
import { RiverView } from "./rivers";
import { WeatherFx } from "./weatherFx";
import type { FogMask } from "./fogMask";
import { playerColor } from "./players";
import { StarWellMarkers } from "./starWells";
import { buildSurface, makeTerrainMaterial } from "./terrainMesh";
import { TileHighlight } from "./tileHighlight";
import { makeWaterMaterial } from "./water";

/** Everything drawn for one planet. Created per world and disposed when the world changes. */
export class WorldView {
  readonly group = new THREE.Group();
  readonly land: THREE.Mesh<THREE.BufferGeometry, PainterlyMaterial>;
  readonly water: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof makeWaterMaterial>>;
  readonly atmosphere: AtmosphereShell;
  readonly clouds: CloudLayer;
  readonly wells: StarWellMarkers;
  readonly highlight = new TileHighlight();
  readonly frames: SurfaceFrames;
  readonly nature: NatureView;
  readonly econ: EconView;
  readonly overlays: Overlays;
  readonly grass: GrassPatch;
  readonly fauna: Fauna;
  readonly particles = new Particles();
  readonly rivers: RiverView;
  readonly weather = new WeatherFx();
  private climateVersion = -1;
  private climateTimer = 0;
  private wearVersion = -1;
  /** Fog of war for the viewing player. */
  readonly mask: FogMask = { explored: undefined, visible: undefined, version: 0 };
  private viewer = 0;
  private fogOn = true;
  private fogKey = "";
  private wearTimer = 0;
  private gridOn = false;

  constructor(
    readonly world: World,
    graphics: GraphicsSettings,
    seed: number,
  ) {
    const planet = world.planet;
    const R = planet.params.radius;
    const baseSub = { low: 0, medium: 1, high: 2 }[graphics.terrainDetail];
    const sub = Math.max(0, baseSub - (planet.grid.count > 20000 ? 1 : 0));
    const surface = buildSurface(planet, sub, seed);

    this.land = new THREE.Mesh(surface.land, makeTerrainMaterial());
    this.land.castShadow = true;
    this.land.receiveShadow = true;
    this.land.name = "land";

    this.water = new THREE.Mesh(surface.water, makeWaterMaterial());
    this.water.renderOrder = 1;
    this.water.name = "water";

    this.atmosphere = new AtmosphereShell(R);
    this.clouds = new CloudLayer(R, seed);
    this.wells = new StarWellMarkers(planet);
    this.frames = new SurfaceFrames(planet);
    this.nature = new NatureView(world.land, this.frames, planet.grid.count, this.mask, (t) => this.seasonAt(t));
    this.rivers = new RiverView(world.land, this.frames);
    this.econ = new EconView(world.economy, this.frames);
    this.overlays = new Overlays(world.land, this.frames);
    this.grass = new GrassPatch(world.land, this.frames, this.mask);
    this.fauna = new Fauna(world.land, world.economy, this.frames);
    this.group.add(
      this.land,
      this.water,
      this.rivers.group,
      this.weather.group,
      this.nature.group,
      this.econ.group,
      this.overlays.group,
      this.grass.group,
      this.fauna.group,
      this.particles.points,
      this.wells.group,
      this.clouds.mesh,
      this.atmosphere.mesh,
      this.highlight.line,
    );
  }

  /** Whose eyes the view uses, and whether fog of war is drawn. */
  setViewer(player: number, fog: boolean): void {
    this.viewer = player;
    this.fogOn = fog;
    this.econ.viewer = player;
    this.econ.fog = fog;
  }

  /** Autumn colour, bare branches and snow per tile, for trees. */
  private seasonAt(t: number): { autumn: number; bare: number; snow: number } {
    const w = this.world;
    const y = w.planet.grid.center[t * 3 + 1] as number;
    let ph = w.climate.yearPhase(w.tick);
    if (y < 0) ph = (ph + 0.5) % 1;
    const lat = THREE.MathUtils.smoothstep(Math.abs(y), 0.12, 0.4);
    const autumn = Math.min(1, Math.max(0, 1.3 - Math.abs(ph - 0.63) / 0.14)) * lat;
    const bare = Math.max(0, 1 - Math.abs(ph - 0.88) / 0.12) * lat * 0.8;
    return { autumn, bare, snow: w.land.snowCover[t] as number };
  }

  private updateClimate(p: { dt: number; time: number; daylight: number; sky: THREE.Color; closeness: number; ground?: THREE.Vector3; distance?: number; focus: THREE.Vector3 }): void {
    const w = this.world;
    this.clouds.setFronts(w.climate.fronts);
    this.rivers.update(p.time, p.daylight, p.sky);
    // Rain or snow where the view is, when close enough to the ground to see it.
    if (p.ground && p.closeness > 0.25) {
      const t = w.planet.grid.nearestTile([p.focus.x, p.focus.y, p.focus.z], 0);
      const amount = (w.climate.rain[t] as number) * THREE.MathUtils.smoothstep(p.closeness, 0.25, 0.6);
      const wind = p.focus.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.4);
      this.weather.update(p.dt, p.ground, amount, (w.climate.temp[t] as number) < 0.5, Math.max(8, (p.distance ?? 20) * 0.9), wind);
    } else this.weather.update(p.dt, p.focus, 0, false, 1, p.focus);
    this.climateTimer -= p.dt;
    if (this.climateTimer > 0 || w.climate.version === this.climateVersion) return;
    this.climateTimer = 1;
    this.climateVersion = w.climate.version;
    const g = this.land.geometry;
    const owner = g.userData.owner as Int32Array;
    const attr = g.getAttribute("aClimate") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const perTile = new Map<number, { autumn: number }>();
    for (let i = 0; i < owner.length; i++) {
      const t = owner[i] as number;
      let s = perTile.get(t);
      if (!s) {
        s = this.seasonAt(t);
        perTile.set(t, s);
      }
      arr[i * 3] = w.land.snowCover[t] as number;
      arr[i * 3 + 1] = s.autumn;
      arr[i * 3 + 2] = w.land.mud[t] as number;
    }
    attr.needsUpdate = true;
    // Trees follow a few times a day.
    this.nature.seasonKey = Math.floor(w.climate.version / 40);
  }

  private updateFog(): void {
    const eco = this.world.economy;
    const key = `${this.viewer}:${this.fogOn}:${eco.visionVersion}`;
    if (key === this.fogKey) return;
    this.fogKey = key;
    this.mask.explored = this.fogOn ? eco.explored[this.viewer] : undefined;
    this.mask.visible = this.fogOn ? eco.visible[this.viewer] : undefined;
    this.mask.version++;
    const exp = this.mask.explored;
    const vis = this.mask.visible;
    this.rivers.setFog((t) => (!exp ? 0 : exp[t] !== 1 ? 1 : vis && vis[t] === 1 ? 0 : 0.5));
    for (const g of [this.land.geometry, this.water.geometry]) {
      const owner = g.userData.owner as Int32Array;
      const attr = g.getAttribute("aFog") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const exp = this.mask.explored;
      const vis = this.mask.visible;
      for (let i = 0; i < owner.length; i++) {
        const t = owner[i] as number;
        arr[i] = !exp ? 0 : exp[t] !== 1 ? 1 : vis && vis[t] === 1 ? 0 : 0.5;
      }
      attr.needsUpdate = true;
    }
  }

  setGrid(on: boolean): void {
    this.gridOn = on;
  }

  get grid(): boolean {
    return this.gridOn;
  }

  update(p: {
    time: number;
    dt: number;
    vegetation: number;
    particles: number;
    focus: THREE.Vector3;
    pixelRatio: number;
    sunDir: THREE.Vector3;
    sky: THREE.Color;
    daylight: number;
    orbit: number;
    fog: THREE.Fog | null;
    closeness: number;
    /** Surface point under the view and camera distance, for rain and snow. */
    ground?: THREE.Vector3;
    distance?: number;
  }): void {
    WIND.uTime.value = p.time;
    this.nature.update(p.vegetation);
    this.econ.night.value = 1 - p.daylight;
    this.econ.update(p.time, p.dt);
    this.grass.update(p.focus, p.closeness, p.vegetation);
    this.fauna.update(p.time, p.dt, p.focus, p.closeness, p.daylight, p.pixelRatio, p.particles);
    const light = new THREE.Color().setScalar(0.25 + 0.75 * p.daylight);
    const wind = p.focus.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.35);
    this.particles.update(p.dt, p.closeness > 0.2 ? this.econ.emitters() : [], wind, light, p.pixelRatio, p.particles);
    this.wearTimer -= p.dt;
    if (this.wearTimer <= 0 && this.world.land.wearVersion !== this.wearVersion) {
      this.wearTimer = 1;
      this.wearVersion = this.world.land.wearVersion;
      this.updateWear();
    }
    this.updateFog();
    this.updateClimate(p);
    this.overlays.update(p.time, 1 - p.daylight, this.mask.explored, this.mask.version, playerColor);
    const w = this.water.material.userData.u;
    w.sunDir.value.copy(p.sunDir);
    w.sky.value.copy(p.sky);
    w.day.value = p.daylight;
    this.atmosphere.update(p.sunDir, p.orbit);
    this.clouds.update(p.time, p.sunDir, THREE.MathUtils.clamp(1.25 - p.closeness * 1.9, 0, 1));
    this.wells.update(p.time, 1 - p.daylight, p.closeness);
    const grid = (this.land.material.userData.uniforms as { uGrid: { value: number } }).uGrid;
    const target = this.gridOn ? 1 : 0;
    grid.value += (target - grid.value) * 0.2;
  }

  private updateWear(): void {
    const g = this.land.geometry;
    const owner = g.userData.owner as Int32Array;
    const attr = g.getAttribute("aWear") as THREE.BufferAttribute;
    const wear = this.world.land.wear;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < owner.length; i++) arr[i] = Math.min(1, (wear[owner[i] as number] as number) / 900);
    attr.needsUpdate = true;
  }

  /** Tile under a ray: intersect the sea-level sphere, then refine against tile heights. */
  pick(ray: THREE.Ray, hint = 0): number {
    const planet = this.world.planet;
    let r = planet.params.radius;
    let tile = -1;
    const sphere = new THREE.Sphere(new THREE.Vector3(), r);
    const hit = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      sphere.radius = r;
      if (!ray.intersectSphere(sphere, hit)) return tile;
      const d = hit.clone().normalize();
      tile = planet.grid.nearestTile([d.x, d.y, d.z], tile >= 0 ? tile : hint);
      r = planet.surfaceRadius(tile);
    }
    return tile;
  }

  dispose(): void {
    this.nature.dispose();
    this.grass.dispose();
    this.fauna.dispose();
    this.particles.dispose();
    this.econ.dispose();
    this.overlays.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
