import * as THREE from "three";
import type { Economy } from "../sim/econ/economy";
import { Feature, type LandUse } from "../sim/econ/landuse";
import { Biome } from "../sim/planet/terrain";
import { SurfaceFrames } from "./frames";

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

function deerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(0.22, 0.2, 0.52).translate(0, 0.42, 0);
  const neck = new THREE.BoxGeometry(0.09, 0.26, 0.09).rotateX(-0.5).translate(0, 0.6, 0.27);
  const head = new THREE.BoxGeometry(0.1, 0.1, 0.18).translate(0, 0.72, 0.38);
  const tail = new THREE.BoxGeometry(0.06, 0.08, 0.05).translate(0, 0.48, -0.27);
  parts.push(body, neck, head, tail);
  for (const [x, z] of [
    [0.08, 0.2],
    [-0.08, 0.2],
    [0.08, -0.2],
    [-0.08, -0.2],
  ] as const) parts.push(new THREE.BoxGeometry(0.05, 0.34, 0.05).translate(x, 0.17, z));
  const ear1 = new THREE.BoxGeometry(0.03, 0.08, 0.02).translate(0.05, 0.8, 0.33);
  const ear2 = new THREE.BoxGeometry(0.03, 0.08, 0.02).translate(-0.05, 0.8, 0.33);
  parts.push(ear1, ear2);
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const p of parts) {
    const ni = p.toNonIndexed();
    pos.push(...(ni.getAttribute("position").array as Float32Array));
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}

const SPRITE_VERT = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; attribute float aAlpha;
  uniform float uPixel; varying vec3 vColor; varying float vAlpha;
  void main() {
    vColor = aColor; vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixel * (60.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const SPRITE_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }`;

class SpriteCloud {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly mat: THREE.ShaderMaterial;

  constructor(
    readonly count: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(count * 3);
    this.color = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPixel: { value: 1 } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  flush(): void {
    const g = this.points.geometry;
    for (const k of ["position", "aColor", "aSize", "aAlpha"]) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

export class Fauna {
  readonly group = new THREE.Group();
  private readonly birds: THREE.InstancedMesh;
  private readonly birdData: Bird[] = [];
  private readonly flocks: Flock[] = [];
  private readonly deerMesh: THREE.InstancedMesh;
  private readonly deer: Deer[] = [];
  private readonly butterflies = new SpriteCloud(70, false);
  private readonly fireflies = new SpriteCloud(160, true);
  private readonly bfState: { home: THREE.Vector3; phase: number; color: THREE.Color }[] = [];
  private readonly ffState: { home: THREE.Vector3; phase: number }[] = [];
  private homeTile = -1;
  private readonly r = rnd(1234);

  constructor(
    private readonly land: LandUse,
    private readonly eco: Economy,
    private readonly frames: SurfaceFrames,
  ) {
    const birdMat = new THREE.MeshStandardMaterial({ color: "#3b3a44", side: THREE.DoubleSide, roughness: 1 });
    this.birds = new THREE.InstancedMesh(birdGeometry(), birdMat, 60);
    this.birds.frustumCulled = false;
    this.birds.count = 0;
    this.deerMesh = new THREE.InstancedMesh(deerGeometry(), new THREE.MeshStandardMaterial({ color: "#9a6a44", roughness: 0.9, flatShading: true }), 12);
    this.deerMesh.frustumCulled = false;
    this.deerMesh.castShadow = true;
    this.deerMesh.count = 0;
    this.group.add(this.birds, this.deerMesh, this.butterflies.points, this.fireflies.points);
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
    // Deer on grassy tiles near forests.
    this.deer.length = 0;
    const grazing = landTiles.filter((t) => {
      const b = terrain.biome[t] as Biome;
      if (b !== Biome.Meadow && b !== Biome.Forest && b !== Biome.Steppe) return false;
      return land.feature[t] === Feature.None && land.planet.grid.neighborsOf(t).some((n) => land.feature[n] === Feature.Tree);
    });
    const herdSize = Math.min(grazing.length, 3 + Math.floor(r() * 5));
    for (let i = 0; i < herdSize; i++) {
      const t = grazing[Math.floor(r() * grazing.length)] as number;
      const p = this.frames.pos(t);
      this.deer.push({ tile: t, pos: p.clone(), target: p.clone(), heading: new THREE.Vector3(1, 0, 0), graze: r(), timer: r() * 5, scale: 0.85 + r() * 0.4 });
    }
    // Butterflies over flowery meadows, fireflies around woods.
    this.bfState.length = 0;
    const meadows = landTiles.filter((t) => terrain.biome[t] === Biome.Meadow || terrain.biome[t] === Biome.Steppe);
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
    if (this.homeTile < 0 || this.frames.dir(t).dot(this.frames.dir(this.homeTile)) < Math.cos(this.land.spacing * 8)) {
      this.homeTile = t;
      this.repopulate(t);
    }
    this.updateBirds(time, daylight, amount);
    this.updateDeer(time, dt, amount);
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
    (this.birds.material as THREE.MeshStandardMaterial).color.set(this.flocks[2]?.sea ? "#e8e6e0" : "#3b3a44");
  }

  private updateDeer(time: number, dt: number, amount: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
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
      const bob = grazing ? 0 : Math.abs(Math.sin(time * (scared ? 16 : 7) + i)) * 0.05;
      const p = d.pos.clone().addScaledVector(d.pos.clone().normalize(), bob);
      this.frames.orient(p, p.clone().add(d.heading), q);
      if (grazing) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25 + Math.sin(time + i) * 0.05));
      s.setScalar(d.scale);
      m.compose(p, q, s);
      this.deerMesh.setMatrixAt(n++, m);
    }
    this.deerMesh.count = n;
    this.deerMesh.instanceMatrix.needsUpdate = true;
  }

  private updateSprites(time: number, daylight: number, pixelRatio: number, amount: number): void {
    const bf = this.butterflies;
    bf.mat.uniforms.uPixel!.value = pixelRatio;
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
    ff.mat.uniforms.uPixel!.value = pixelRatio;
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
    this.deerMesh.geometry.dispose();
    (this.deerMesh.material as THREE.Material).dispose();
    this.deerMesh.dispose();
    this.butterflies.dispose();
    this.fireflies.dispose();
  }
}
