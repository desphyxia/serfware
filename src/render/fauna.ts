import * as THREE from "three/webgpu";
import type { Economy } from "../sim/econ/economy";
import { Feature, type LandUse } from "../sim/econ/landuse";
import { Biome } from "../sim/planet/terrain";
import { SurfaceFrames } from "./frames";
import { PainterlyMaterial } from "./painterly";
import { SpriteBatch } from "./sprites";
import { AnimalBatch, Pose } from "./animals";

/**
 * Ambient wildlife around the camera: bird flocks, grazing deer, butterflies by day and
 * fireflies at dusk. Purely visual for now; the ecology simulation arrives in batch 11.
 */

function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Bird {
  flock: number;
  phase: number;
  radius: number;
  height: number;
  speed: number;
}

interface Flock {
  center: THREE.Vector3; // unit direction
  drift: THREE.Vector3;
  sea: boolean;
}

interface Grazer {
  species: "sheep" | "cow";
  pen: THREE.Vector3; // pasture centre (world)
  pos: THREE.Vector3;
  target: THREE.Vector3;
  heading: THREE.Vector3;
  timer: number;
  phase: number;
  scale: number;
}

interface Jumper {
  at: THREE.Vector3; // unit direction over water
  dir: THREE.Vector3;
  clock: number;
  period: number;
}

function fishGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.05, 7, 5).scale(0.55, 0.7, 2.2);
  const tail = new THREE.ConeGeometry(0.045, 0.07, 4).rotateX(-Math.PI / 2).scale(0.3, 1, 1).translate(0, 0, -0.13);
  const merged = new THREE.BufferGeometry();
  const a = g.toNonIndexed();
  const b = tail.toNonIndexed();
  const pos = new Float32Array([...(a.getAttribute("position").array as Float32Array), ...(b.getAttribute("position").array as Float32Array)]);
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}

interface Deer {
  tile: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  heading: THREE.Vector3;
  graze: number;
  timer: number;
  scale: number;
}

function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Body plus two wings; wings are flapped by scaling the instance on Y in JS.
  const p = [0, 0, 0.12, -0.03, 0, -0.1, 0.03, 0, -0.1, 0, 0, 0.02, -0.34, 0.04, -0.06, 0, 0, -0.08, 0, 0, 0.02, 0, 0, -0.08, 0.34, 0.04, -0.06];
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}


/** Small glowing or coloured motes (butterflies, fireflies) drawn as camera-facing sprites. */
class SpriteCloud {
  private readonly batch: SpriteBatch;
  readonly points: THREE.Mesh;
  readonly pos: Float32Array;
  readonly color: Float32Array;
  readonly alpha: Float32Array;
  /** Sizes in the old point units; converted to world units on flush. */
  readonly size: Float32Array;

  constructor(
    readonly count: number,
    additive: boolean,
  ) {
    this.batch = new SpriteBatch(count, { additive, glow: additive ? 2 : 0 });
    this.points = this.batch.mesh;
    this.pos = this.batch.pos;
    this.color = this.batch.color;
    this.alpha = this.batch.alpha;
    this.size = new Float32Array(count);
  }

  flush(): void {
    for (let i = 0; i < this.count; i++) this.batch.size[i] = (this.size[i] as number) * 0.05;
    this.batch.flush(this.count);
  }

  dispose(): void {
    this.batch.dispose();
  }
}

export class Fauna {
  readonly group = new THREE.Group();
  private readonly birds: THREE.InstancedMesh;
  private readonly birdData: Bird[] = [];
  private readonly flocks: Flock[] = [];
  private readonly deerBatch = new AnimalBatch("deer", 16);
  private readonly deer: Deer[] = [];
  private readonly sheepBatch = new AnimalBatch("sheep", 48);
  private readonly cowBatch = new AnimalBatch("cow", 24);
  private readonly grazers: Grazer[] = [];
  private readonly fish: THREE.InstancedMesh;
  private readonly jumpers: Jumper[] = [];
  private readonly butterflies = new SpriteCloud(70, false);
  private readonly fireflies = new SpriteCloud(160, true);
  private readonly bfState: { home: THREE.Vector3; phase: number; color: THREE.Color }[] = [];
  private readonly ffState: { home: THREE.Vector3; phase: number }[] = [];
  private homeTile = -1;
  private structureKey = -1;
  private readonly r = rnd(1234);

  constructor(
    private readonly land: LandUse,
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
  ) {
    const birdMat = new PainterlyMaterial({ color: "#3b3a44", side: THREE.DoubleSide, brush: 0 });
    this.birds = new THREE.InstancedMesh(birdGeometry(), birdMat, 60);
    this.birds.frustumCulled = false;
    this.birds.count = 0;
    this.fish = new THREE.InstancedMesh(fishGeometry(), new PainterlyMaterial({ color: "#b8c8d0", brush: 0 }), 12);
    this.fish.frustumCulled = false;
    this.fish.count = 0;
    this.group.add(this.birds, this.deerBatch.mesh, this.sheepBatch.mesh, this.cowBatch.mesh, this.fish, this.butterflies.points, this.fireflies.points);
  }

  private repopulate(center: number): void {
    const land = this.land;
    const { terrain } = land.planet;
    const r = this.r;
    const around = land.ring(center, 12);
    const landTiles = around.filter((t) => land.isLand(t));
    const coast = around.filter((t) => !land.isLand(t));
    // Flocks.
    this.flocks.length = 0;
    this.birdData.length = 0;
    const nFlocks = 3;
    for (let f = 0; f < nFlocks; f++) {
      const sea = f === 2 && coast.length > 10;
      const pool = sea ? coast : landTiles.length ? landTiles : around;
      const t = pool[Math.floor(r() * pool.length)] as number;
      this.flocks.push({ center: this.frames.dir(t), drift: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.002), sea });
      const n = 6 + Math.floor(r() * 8);
      for (let i = 0; i < n; i++)
        this.birdData.push({ flock: f, phase: r() * 6.28, radius: 2 + r() * 5, height: 7 + r() * 5, speed: (0.35 + r() * 0.2) * (r() < 0.5 ? 1 : -1) });
    }
    // Deer on grassy tiles near forests; as many as the ecology's herds here allow.
    this.deer.length = 0;
    const game = this.eco.ecology.game;
    const grazing = landTiles.filter((t) => {
      const b = terrain.biome[t] as Biome;
      if (b !== Biome.Meadow && b !== Biome.Forest && b !== Biome.Steppe && b !== Biome.DeepForest) return false;
      return (game[t] as number) > 25 && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.planet.grid.neighborsOf(t).some((n) => land.feature[n] === Feature.Tree);
    });
    const density = landTiles.reduce((sum, t) => sum + (game[t] as number), 0) / Math.max(1, landTiles.length);
    const herdSize = Math.min(grazing.length, 14, Math.round((density / 60) * (3 + r() * 5)));
    for (let i = 0; i < herdSize; i++) {
      const t = grazing[Math.floor(r() * grazing.length)] as number;
      const p = this.frames.pos(t);
      this.deer.push({ tile: t, pos: p.clone(), target: p.clone(), heading: new THREE.Vector3(1, 0, 0), graze: r(), timer: r() * 5, scale: 0.85 + r() * 0.4 });
    }
    // Sheep and cows in the pastures nearby.
    this.grazers.length = 0;
    const near = new Set(around);
    near.add(center);
    for (const b of this.eco.buildings) {
      if (!b.alive || !b.built || b.def.id !== "pasture" || !near.has(b.tile)) continue;
      const pen = this.frames.pos(b.tile);
      const cows = b.id % 3 === 0;
      const n = cows ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const p = this.penPoint(pen);
        this.grazers.push({ species: cows ? "cow" : "sheep", pen, pos: p.clone(), target: p.clone(), heading: new THREE.Vector3(1, 0, 0), timer: r() * 4, phase: r() * 10, scale: 0.9 + r() * 0.2 });
      }
    }
    // Fish leaping from the water near the shore.
    this.jumpers.length = 0;
    const water = coast.filter((t) => land.planet.grid.neighborsOf(t).some((n) => land.isLand(n)));
    for (let i = 0; i < Math.min(8, water.length); i++) {
      const t = water[Math.floor(r() * water.length)] as number;
      const d = this.frames.dir(t);
      const tA = new THREE.Vector3(0, 1, 0).cross(d).normalize();
      const a = r() * Math.PI * 2;
      this.jumpers.push({ at: d.clone().addScaledVector(tA, (r() - 0.5) * 0.01).normalize(), dir: tA.applyAxisAngle(d, a), clock: r() * 6, period: 4 + r() * 6 });
    }
    // Butterflies over flowery meadows, fireflies around woods.
    this.bfState.length = 0;
    // Where the pollinators are: wild, flowering ground.
    const bees = this.eco.ecology.bees;
    const meadows = landTiles.filter((t) => (terrain.biome[t] === Biome.Meadow || terrain.biome[t] === Biome.Steppe || (bees[t] as number) > 120) && (bees[t] as number) > 40);
    const colors = ["#f4d35e", "#ffffff", "#ee964b", "#9ad0ec"].map((c) => new THREE.Color(c));
    for (let i = 0; i < this.butterflies.count; i++) {
      const t = (meadows.length ? meadows : landTiles)[Math.floor(r() * Math.max(1, (meadows.length ? meadows : landTiles).length))];
      this.bfState.push({ home: t !== undefined ? this.frames.pos(t, 0.4) : new THREE.Vector3(), phase: r() * 100, color: colors[i % colors.length] as THREE.Color });
    }
    this.ffState.length = 0;
    const woods = landTiles.filter((t) => land.feature[t] === Feature.Tree || terrain.biome[t] === Biome.Marsh);
    for (let i = 0; i < this.fireflies.count; i++) {
      const pool = woods.length ? woods : landTiles;
      const t = pool[Math.floor(r() * Math.max(1, pool.length))];
      this.ffState.push({ home: t !== undefined ? this.frames.pos(t, 0.5) : new THREE.Vector3(), phase: r() * 100 });
    }
  }

  update(time: number, dt: number, focus: THREE.Vector3, closeness: number, daylight: number, pixelRatio: number, amount: number): void {
    const visible = closeness > 0.25;
    this.group.visible = visible;
    if (!visible) return;
    const grid = this.land.planet.grid;
    const t = grid.nearestTile([focus.x, focus.y, focus.z], this.homeTile >= 0 ? this.homeTile : 0);
    // Re-place wildlife when the view moves on, and herds when pastures are built or removed.
    if (this.homeTile < 0 || this.eco.structureVersion !== this.structureKey || this.frames.dir(t).dot(this.frames.dir(this.homeTile)) < Math.cos(this.land.spacing * 8)) {
      this.homeTile = t;
      this.structureKey = this.eco.structureVersion;
      this.repopulate(t);
    }
    this.updateBirds(time, daylight, amount);
    this.updateDeer(time, dt, amount);
    this.updateGrazers(time, dt, amount);
    this.updateFish(dt, daylight, amount);
    this.updateSprites(time, daylight, pixelRatio, amount);
  }

  private updateBirds(time: number, daylight: number, amount: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let n = 0;
    const R = this.land.planet.params.radius;
    const count = daylight > 0.2 ? Math.floor(this.birdData.length * amount) : 0;
    for (const f of this.flocks) f.center.add(f.drift).normalize();
    for (let i = 0; i < count && n < 60; i++) {
      const b = this.birdData[i] as Bird;
      const f = this.flocks[b.flock] as Flock;
      const up = f.center;
      const tA = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const tB = up.clone().cross(tA);
      const a = b.phase + time * b.speed;
      const wob = Math.sin(time * 0.7 + b.phase) * 0.8;
      const pos = up
        .clone()
        .multiplyScalar(R + b.height + wob)
        .addScaledVector(tA, Math.cos(a) * b.radius)
        .addScaledVector(tB, Math.sin(a) * b.radius);
      const vel = tA.clone().multiplyScalar(-Math.sin(a)).addScaledVector(tB, Math.cos(a)).multiplyScalar(Math.sign(b.speed));
      this.frames.orient(pos, pos.clone().add(vel), q);
      const flap = Math.sin(time * 9 + b.phase * 3);
      s.set(1, 0.4 + flap * 1.6, 1);
      m.compose(pos, q, s);
      this.birds.setMatrixAt(n++, m);
    }
    this.birds.count = n;
    this.birds.instanceMatrix.needsUpdate = true;
    (this.birds.material as PainterlyMaterial).color.set(this.flocks[2]?.sea ? "#e8e6e0" : "#3b3a44");
  }

  private updateDeer(time: number, dt: number, amount: number): void {
    const q = new THREE.Quaternion();
    const land = this.land;
    let n = 0;
    const settlers = this.eco.settlers.filter((x) => x.alive).map((x) => x.path[x.pi] as number);
    const shown = Math.ceil(this.deer.length * amount);
    for (let i = 0; i < shown; i++) {
      const d = this.deer[i] as Deer;
      d.timer -= dt;
      const scared = settlers.some((st) => st === d.tile || land.planet.grid.neighborsOf(d.tile).includes(st));
      if (d.timer <= 0 || scared) {
        d.timer = scared ? 1.5 : 4 + this.r() * 8;
        const options = land.planet.grid.neighborsOf(d.tile).filter((x) => land.isLand(x) && land.walkable(x));
        if (options.length) {
          d.tile = options[Math.floor(this.r() * options.length)] as number;
          d.target = this.frames.pos(d.tile);
        }
      }
      const to = d.target.clone().sub(d.pos);
      const dist = to.length();
      const speed = scared ? 3.2 : 0.6;
      if (dist > 0.05) {
        d.heading.copy(to).normalize();
        d.pos.addScaledVector(d.heading, Math.min(dist, speed * dt));
      }
      const grazing = dist < 0.1;
      const p = this.onGround(d.pos, d.tile);
      this.frames.orient(p, p.clone().add(d.heading), q);
      const pose = grazing ? (d.graze > 0.35 ? Pose.Graze : Pose.Idle) : scared ? Pose.Run : Pose.Walk;
      this.deerBatch.set(n++, p, q, pose, i * 1.7, d.scale);
    }
    this.deerBatch.flush(n, time);
  }

  /** A point on the ground (the detailed field) under a world position. */
  private onGround(p: THREE.Vector3, hint: number): THREE.Vector3 {
    const d = p.clone().normalize();
    return d.multiplyScalar(this.frames.groundAt(d, hint));
  }

  /** A random point inside a pasture's fence. */
  private penPoint(pen: THREE.Vector3): THREE.Vector3 {
    const up = pen.clone().normalize();
    const tA = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const tB = up.clone().cross(tA);
    const a = this.r() * Math.PI * 2;
    const rr = Math.sqrt(this.r()) * 0.8;
    return pen.clone().addScaledVector(tA, Math.cos(a) * rr).addScaledVector(tB, Math.sin(a) * rr * 0.8);
  }

  private updateGrazers(time: number, dt: number, amount: number): void {
    const q = new THREE.Quaternion();
    let ns = 0;
    let nc = 0;
    const shown = Math.ceil(this.grazers.length * amount);
    for (let i = 0; i < shown; i++) {
      const g = this.grazers[i] as Grazer;
      g.timer -= dt;
      if (g.timer <= 0) {
        g.timer = 3 + this.r() * 7;
        if (this.r() < 0.5) g.target = this.penPoint(g.pen);
      }
      const to = g.target.clone().sub(g.pos);
      const dist = to.length();
      const moving = dist > 0.04;
      if (moving) {
        g.heading.copy(to).normalize();
        g.pos.addScaledVector(g.heading, Math.min(dist, (g.species === "cow" ? 0.25 : 0.35) * dt));
      }
      const p = this.onGround(g.pos, 0);
      this.frames.orient(p, p.clone().add(g.heading), q);
      const pose = moving ? Pose.Walk : Math.sin(time * 0.2 + g.phase) > -0.3 ? Pose.Graze : Pose.Idle;
      if (g.species === "cow") this.cowBatch.set(nc++, p, q, pose, g.phase, g.scale);
      else this.sheepBatch.set(ns++, p, q, pose, g.phase, g.scale);
    }
    this.sheepBatch.flush(ns, time);
    this.cowBatch.flush(nc, time);
  }

  /** Fish leap out of the water now and then in a short arc. */
  private updateFish(dt: number, daylight: number, amount: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const R = this.frames.field.R;
    let n = 0;
    const shown = daylight > 0.15 ? Math.ceil(this.jumpers.length * amount) : 0;
    for (let i = 0; i < shown; i++) {
      const j = this.jumpers[i] as Jumper;
      j.clock += dt;
      const t = (j.clock % j.period) / 0.7;
      if (t > 1) continue;
      const up = j.at.clone();
      const p = up.clone().multiplyScalar(R + 0.02 + Math.sin(t * Math.PI) * 0.35).addScaledVector(j.dir, (t - 0.5) * 0.5);
      const fwd = j.dir.clone().multiplyScalar(0.5).addScaledVector(up, Math.cos(t * Math.PI) * 0.6);
      this.frames.orient(p, p.clone().add(j.dir), q);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(fwd.dot(up), 0.5)));
      m.compose(p, q, one);
      this.fish.setMatrixAt(n++, m);
    }
    this.fish.count = n;
    this.fish.instanceMatrix.needsUpdate = true;
  }

  private updateSprites(time: number, daylight: number, pixelRatio: number, amount: number): void {
    const bf = this.butterflies;
    this.bfState.forEach((b, i) => {
      const t = time * 0.6 + b.phase;
      const up = b.home.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const tB = up.clone().cross(tA);
      const p = b.home
        .clone()
        .addScaledVector(tA, Math.sin(t * 0.9) * 1.2 + Math.sin(t * 2.3) * 0.3)
        .addScaledVector(tB, Math.cos(t * 0.7) * 1.2)
        .addScaledVector(up, Math.abs(Math.sin(t * 5)) * 0.25);
      bf.pos.set([p.x, p.y, p.z], i * 3);
      const flutter = 0.6 + 0.4 * Math.abs(Math.sin(time * 18 + b.phase));
      bf.color.set([b.color.r * flutter, b.color.g * flutter, b.color.b * flutter], i * 3);
      bf.size[i] = 2.2;
      bf.alpha[i] = i < bf.count * amount ? Math.max(0, daylight * 1.3 - 0.3) : 0;
    });
    bf.flush();
    const ff = this.fireflies;
    const night = Math.max(0, 1 - daylight * 1.6);
    this.ffState.forEach((f, i) => {
      const t = time * 0.3 + f.phase;
      const up = f.home.clone().normalize();
      const tA = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const tB = up.clone().cross(tA);
      const p = f.home
        .clone()
        .addScaledVector(tA, Math.sin(t * 1.1) * 1.4)
        .addScaledVector(tB, Math.sin(t * 0.8 + 1) * 1.4)
        .addScaledVector(up, Math.sin(t * 1.7) * 0.4 + 0.3);
      ff.pos.set([p.x, p.y, p.z], i * 3);
      ff.color.set([1, 0.85, 0.45], i * 3);
      ff.size[i] = 1.6;
      const blink = Math.max(0, Math.sin(time * 1.3 + f.phase * 7)) ** 3;
      ff.alpha[i] = i < ff.count * amount ? night * blink : 0;
    });
    ff.flush();
  }

  dispose(): void {
    this.birds.geometry.dispose();
    (this.birds.material as THREE.Material).dispose();
    this.birds.dispose();
    this.deerBatch.dispose();
    this.sheepBatch.dispose();
    this.cowBatch.dispose();
    this.fish.geometry.dispose();
    (this.fish.material as THREE.Material).dispose();
    this.fish.dispose();
    this.butterflies.dispose();
    this.fireflies.dispose();
  }
}
