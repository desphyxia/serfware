import * as THREE from "three";
import type { GraphicsSettings } from "../core/settings";
import type { World } from "../sim/world";
import { AtmosphereShell, CloudLayer } from "./atmosphere";
import { StarWellMarkers } from "./starWells";
import { buildSurface, makeTerrainMaterial } from "./terrainMesh";
import { TileHighlight } from "./tileHighlight";
import { makeWaterMaterial } from "./water";

/** Everything drawn for one planet. Created per world and disposed when the world changes. */
export class WorldView {
  readonly group = new THREE.Group();
  readonly land: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly atmosphere: AtmosphereShell;
  readonly clouds: CloudLayer;
  readonly wells: StarWellMarkers;
  readonly highlight = new TileHighlight();
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
    this.group.add(this.land, this.water, this.wells.group, this.clouds.mesh, this.atmosphere.mesh, this.highlight.line);
  }

  setGrid(on: boolean): void {
    this.gridOn = on;
  }

  get grid(): boolean {
    return this.gridOn;
  }

  update(p: {
    time: number;
    sunDir: THREE.Vector3;
    sky: THREE.Color;
    daylight: number;
    orbit: number;
    fog: THREE.Fog | null;
    closeness: number;
  }): void {
    const w = this.water.material.uniforms;
    w.uTime!.value = p.time;
    w.uSunDir!.value.copy(p.sunDir);
    w.uSky!.value.copy(p.sky);
    w.uDay!.value = p.daylight;
    if (p.fog) {
      w.uFogColor!.value.copy(p.fog.color);
      w.uFogNear!.value = p.fog.near;
      w.uFogFar!.value = p.fog.far;
    } else {
      w.uFogNear!.value = 1e7;
      w.uFogFar!.value = 2e7;
    }
    this.atmosphere.update(p.sunDir, p.orbit);
    this.clouds.update(p.time, p.sunDir, THREE.MathUtils.clamp(1.25 - p.closeness * 1.9, 0, 1));
    this.wells.update(p.time, 1 - p.daylight, p.closeness);
    const grid = (this.land.material.userData.uniforms as { uGrid: { value: number } }).uGrid;
    const target = this.gridOn ? 1 : 0;
    grid.value += (target - grid.value) * 0.2;
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
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
