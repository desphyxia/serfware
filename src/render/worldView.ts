import * as THREE from "three/webgpu";
import { ChunkedTerrain } from "./terrain/chunks";
import { TerrainField, type Pad } from "./terrain/field";
import { makeGroundMaterial } from "./terrain/material";
import { TileData } from "./terrain/tileData";
import type { GraphicsSettings } from "../core/settings";
import type { World } from "../sim/world";
import { AtmosphereShell, CloudLayer } from "./atmosphere";
import { EconView } from "./econView";
import { Fauna } from "./fauna";
import { GrassPatch } from "./grass";
import { Undergrowth } from "./undergrowth";
import { AmbientFx } from "./ambientFx";
import { FireView } from "./fireView";
import { FrontierView } from "./frontierView";
import { SkyView } from "./skyView";
import { VoyageView } from "./voyageView";
import { AdversityView } from "./adversityView";
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
import { buildSurface } from "./terrainMesh";
import { TileHighlight } from "./tileHighlight";
import { makeWaterMaterial } from "./water";
import { makeWaterUniforms, type WaterUniforms } from "./waterShade";
import { tideLevel } from "../sim/biomes/tides";
import { Region } from "../sim/biomes/regions";

/** Everything drawn for one planet. Created per world and disposed when the world changes. */
export class WorldView {
  readonly group = new THREE.Group();
  /** The detailed ground: a height field and the chunked mesh built on it. */
  readonly field: TerrainField;
  readonly terrain: ChunkedTerrain;
  readonly tileData: TileData;
  private readonly groundMat: ReturnType<typeof makeGroundMaterial>;
  private padKey = -1;
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
  readonly undergrowth: Undergrowth;
  readonly fauna: Fauna;
  readonly particles = new Particles();
  readonly rivers: RiverView;
  /** Uniforms shared by the sea, lakes and rivers. */
  readonly waterU: WaterUniforms;
  readonly weather = new WeatherFx();
  readonly ambient = new AmbientFx();
  readonly fire: FireView;
  readonly frontier: FrontierView;
  readonly sky: SkyView;
  readonly voyages: VoyageView;
  readonly adversity: AdversityView;
  private climateVersion = -1;
  private climateTimer = 0;
  private ashVersion = 0;
  private sandVersion = -1;
  private lifeVersion = -1;
  private glowVersion = -1;
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
    // The sea keeps a coarse surface mesh; the ground is the chunked terrain field.
    const surface = buildSurface(planet, 0, seed, world.land.tidal);
    surface.land.dispose();
    this.field = new TerrainField(planet, world.land, seed);
    this.tileData = new TileData(planet.grid.count);
    // Shore: land tiles next to the sea or a lake get beaches (fading over a second ring).
    {
      const { grid } = planet;
      const land = world.land;
      const wet = (t: number) => !land.isLand(t) || land.hydro.lake[t] === 1;
      const ring = new Float32Array(grid.count);
      for (let t = 0; t < grid.count; t++) if (!wet(t)) for (const n of grid.neighborsOf(t)) if (wet(n)) ring[t] = 1;
      for (let t = 0; t < grid.count; t++) {
        let v = ring[t] as number;
        if (!v && !wet(t)) for (const n of grid.neighborsOf(t)) if (ring[n]) v = 0.35;
        this.tileData.set(t, "shore", wet(t) ? 1 : v);
      }
      this.tileData.commit("b");
    }
    this.groundMat = makeGroundMaterial(this.tileData, R);
    this.terrain = new ChunkedTerrain(planet, this.field, this.groundMat, graphics.terrainDetail);

    this.waterU = makeWaterUniforms();
    this.water = new THREE.Mesh(surface.water, makeWaterMaterial(this.waterU));
    {
      // Where the tide reaches: the flats and the sea just off them, fading over a few tiles.
      const { grid } = planet;
      const reach = new Float32Array(grid.count);
      let front: number[] = [];
      for (let t = 0; t < grid.count; t++) if (world.land.tidal[t]) {
        reach[t] = 1;
        front.push(t);
      }
      for (let d = 1; d <= 4 && front.length; d++) {
        const next: number[] = [];
        for (const t of front) for (const n of grid.neighborsOf(t)) if (reach[n] === 0 && (!world.land.isLand(n) || world.land.region[n] === Region.TidewaterReach)) {
          reach[n] = 1 - d / 5;
          next.push(n);
        }
        front = next;
      }
      const owner = surface.water.userData.owner as Int32Array;
      const arr = new Float32Array(owner.length);
      for (let i = 0; i < owner.length; i++) arr[i] = reach[owner[i] as number] as number;
      surface.water.setAttribute("aTide", new THREE.BufferAttribute(arr, 1));
    }
    this.water.renderOrder = 1;
    this.water.name = "water";

    this.atmosphere = new AtmosphereShell(R);
    this.clouds = new CloudLayer(R, seed);
    this.wells = new StarWellMarkers(planet);
    this.frames = new SurfaceFrames(planet, this.field);
    this.nature = new NatureView(world.land, this.frames, planet.grid.count, this.mask, (t) => this.seasonAt(t));
    this.rivers = new RiverView(world.land, this.frames, this.waterU);
    this.econ = new EconView(world.economy, this.frames);
    this.overlays = new Overlays(world.land, this.frames);
    this.grass = new GrassPatch(world.land, this.frames, this.mask, (t) => this.seasonAt(t).autumn);
    this.undergrowth = new Undergrowth(world.land, this.frames, this.mask);
    this.fauna = new Fauna(world.land, world.economy, this.frames);
    this.fire = new FireView(world.economy, this.frames, this.mask);
    this.frontier = new FrontierView(world.economy, this.frames, this.rivers, this.mask);
    this.sky = new SkyView(world.economy, this.frames, this.mask);
    this.voyages = new VoyageView(world.economy, this.frames);
    this.adversity = new AdversityView(world.economy, this.frames);
    this.nature.ecology = world.economy.ecology;
    this.nature.blight = world.economy.adversity;
    this.grass.cover = world.economy.ecology;
    this.undergrowth.cover = world.economy.ecology;
    this.group.add(
      this.terrain.group,
      this.water,
      this.rivers.group,
      this.frontier.group,
      this.sky.group,
      this.voyages.group,
      this.adversity.group,
      this.weather.group,
      this.ambient.group,
      this.fire.flames.mesh,
      this.fire.light,
      this.nature.group,
      this.econ.group,
      this.overlays.group,
      this.grass.group,
      this.undergrowth.group,
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
  /** Autumn colour, bare branches and snow at a tile (also drives the seasonal grade). */
  seasonAt(t: number): { autumn: number; bare: number; snow: number } {
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
    // Rain or snow where the view is, when close enough to the ground to see it.
    if (p.ground && p.closeness > 0.25) {
      const t = w.planet.grid.nearestTile([p.focus.x, p.focus.y, p.focus.z], 0);
      const amount = (w.climate.rain[t] as number) * THREE.MathUtils.smoothstep(p.closeness, 0.25, 0.6);
      const wind = p.focus.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.4);
      const snowing = (w.climate.temp[t] as number) < 0.5;
      this.weather.update(p.dt, p.ground, amount, snowing, Math.max(8, (p.distance ?? 20) * 0.9), wind);
      // Raindrops ring the water.
      this.waterU.rain.value += ((snowing ? 0 : Math.min(1, amount * 1.5)) - this.waterU.rain.value) * Math.min(1, p.dt * 2);
    } else {
      this.weather.update(p.dt, p.focus, 0, false, 1, p.focus);
      this.waterU.rain.value *= 0.95;
    }
    this.climateTimer -= p.dt;
    const key = w.climate.version * 1000 + w.land.ashVersion;
    if (w.land.ashVersion === this.ashVersion && (this.climateTimer > 0 || key === this.climateVersion)) return;
    this.ashVersion = w.land.ashVersion;
    this.climateTimer = 1;
    this.climateVersion = key;
    const td = this.tileData;
    for (let t = 0; t < w.planet.grid.count; t++) {
      td.set(t, "snow", w.land.snowCover[t] as number);
      td.set(t, "autumn", this.seasonAt(t).autumn);
      td.set(t, "mud", w.land.mud[t] as number);
      td.set(t, "soil", w.land.soil[t] as number);
      // Blurred with the neighbours, so burnt ground has soft, ragged edges rather than hexagons.
      const sc = w.economy.ecology.scorch;
      let sum = (sc[t] as number) * 2;
      let k = 2;
      for (const m of w.planet.grid.neighborsOf(t)) {
        sum += sc[m] as number;
        k++;
      }
      // Volcanic ash shares the channel as a negative value (ash falls where fire has not).
      const ash = w.land.ash[t] as number;
      td.set(t, "scorch", ash > 0.02 ? -ash : sum / k / 255);
    }
    td.commit();
    // Orchards blossom in spring (at the view).
    {
      const f = this.world.planet.grid.nearestTile([p.focus.x, p.focus.y, p.focus.z], 0);
      this.nature.blossom = w.climate.season(w.tick, w.planet.grid.center[f * 3 + 1] as number) === "spring" ? 1 : 0;
    }
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
    for (let t = 0; t < this.world.planet.grid.count; t++) this.tileData.set(t, "fog", !exp ? 0 : exp[t] !== 1 ? 1 : vis && vis[t] === 1 ? 0 : 0.5);
    this.tileData.commit("a");
    for (const g of [this.water.geometry]) {
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
    this.undergrowth.update(p.focus, p.closeness, p.vegetation);
    this.fauna.update(p.time, p.dt, p.focus, p.closeness, p.daylight, p.pixelRatio, p.particles);
    const light = new THREE.Color().setScalar(0.25 + 0.75 * p.daylight);
    const wind = p.focus.clone().cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.35);
    this.voyages.update(p.time, p.dt, p.focus);
    const fires = [...this.fire.update(p.time, p.focus), ...this.frontier.update(p.dt, p.focus, p.closeness, p.time, this.waterU.tideLift.value), ...this.sky.update(p.time, p.dt, p.focus), ...this.adversity.update(p.time, this.world.tick)];
    this.particles.update(p.dt, p.closeness > 0.2 ? [...this.econ.emitters(), ...fires] : fires, wind, light, p.pixelRatio, p.particles);
    {
      // Motes in warm, dry daylight, most of all when the sun is low.
      const t = this.world.planet.grid.nearestTile([p.focus.x, p.focus.y, p.focus.z], 0);
      const c = this.world.climate;
      const sunUp = p.focus.clone().normalize().dot(p.sunDir);
      const low = 1 - THREE.MathUtils.smoothstep(sunUp, 0.25, 0.8) * 0.6;
      const warmth = p.daylight * THREE.MathUtils.smoothstep(c.temp[t] as number, 8, 20) * (1 - Math.min(1, (c.rain[t] as number) * 3)) * low;
      const sun = new THREE.Color(1, 0.85, 0.55).multiplyScalar(0.6 + 0.4 * p.daylight);
      const span = p.distance ?? 60;
      this.ambient.update(p.dt, p.time, p.ground ?? p.focus, span, this.nature.crowns, wind, p.closeness > 0.3 ? warmth : 0, sun, p.closeness > 0.3 ? p.particles : 0);
    }
    this.wearTimer -= p.dt;
    if (this.wearTimer <= 0 && this.world.land.wearVersion !== this.wearVersion) {
      this.wearTimer = 1;
      this.wearVersion = this.world.land.wearVersion;
      this.updateWear();
    }
    this.updateFog();
    this.updateClimate(p);
    const land = this.world.land;
    if (land.sandVersion !== this.sandVersion || land.glowVersion !== this.glowVersion || land.lifeVersion !== this.lifeVersion) {
      this.sandVersion = land.sandVersion;
      this.glowVersion = land.glowVersion;
      this.lifeVersion = land.lifeVersion;
      for (let t = 0; t < land.sand.length; t++) {
        this.tileData.set(t, "sand", land.sand[t] as number);
        this.tileData.set(t, "glow", land.glow[t] as number);
        // Sea tiles count as living, so shores do not turn to dust.
        this.tileData.set(t, "life", land.isLand(t) ? (land.life[t] as number) / 4 : 1);
        this.tileData.set(t, "native", land.native[t] as number);
      }
      this.tileData.commit("c");
    }
    this.overlays.update(p.time, 1 - p.daylight, this.mask.explored, this.mask.version, playerColor);
    const w = this.water.material.userData.u;
    // The tide, eased between climate steps.
    const lift = Math.max(0, tideLevel(this.world.climate.tide));
    w.tideLift.value += (lift - w.tideLift.value) * Math.min(1, p.dt * 2);
    w.seaRise.value += (this.world.climate.seaRise - w.seaRise.value) * Math.min(1, p.dt);
    w.sunDir.value.copy(p.sunDir);
    w.sky.value.copy(p.sky);
    w.day.value = p.daylight;
    this.atmosphere.update(p.sunDir, p.orbit);
    this.clouds.update(p.time, p.sunDir, THREE.MathUtils.clamp(1.25 - p.closeness * 1.9, 0, 1));
    this.wells.update(p.time, 1 - p.daylight, p.closeness);
    const grid = this.groundMat.userData.uniforms.uGrid;
    const target = this.gridOn ? 1 : 0;
    grid.value += (target - grid.value) * 0.2;
  }

  private updateWear(): void {
    const wear = this.world.land.wear;
    for (let t = 0; t < wear.length; t++) this.tileData.set(t, "wear", Math.min(1, (wear[t] as number) / 900));
    this.tileData.commit("a");
  }

  /** Level the ground under buildings, flags and roads; rebuild the chunks where it changed. */
  private updatePads(): void {
    const eco = this.world.economy;
    if (eco.structureVersion === this.padKey) return;
    this.padKey = eco.structureVersion;
    const pads: Pad[] = [];
    for (const b of eco.buildings) if (b.alive) pads.push({ tile: b.tile, radius: b.def.large ? 0.55 : 0.42 });
    for (const f of eco.flags) if (f.alive) pads.push({ tile: f.tile, radius: 0.2 });
    const edges: [number, number][] = [];
    for (const r of eco.roads) if (r.alive) for (let i = 0; i < r.tiles.length - 1; i++) edges.push([r.tiles[i] as number, r.tiles[i + 1] as number]);
    // Roads are part of the ground: a levelled bed, painted by the ground material.
    const changed = [...this.field.setPads(pads), ...this.field.setRoads(edges)];
    if (changed.length) {
      this.terrain.invalidate(changed);
      this.frames.invalidate();
    }
  }

  /** Refine terrain chunks around the camera (call every frame; bounded work). */
  updateTerrain(camPos: THREE.Vector3, budgetMs = 5): void {
    this.updatePads();
    this.terrain.update(camPos, budgetMs);
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
      r = this.field.tileRadius(tile);
    }
    return tile;
  }

  dispose(): void {
    this.terrain.dispose();
    this.nature.dispose();
    this.grass.dispose();
    this.undergrowth.dispose();
    this.fauna.dispose();
    this.particles.dispose();
    this.fire.dispose();
    this.frontier.dispose();
    this.sky.dispose();
    this.voyages.dispose();
    this.adversity.dispose();
    this.ambient.dispose();
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
