import * as THREE from "three/webgpu";
import { abs, attribute, cos, cross, float, max, normalize, sin, transformNormalToView, uniform, varying, vec3, vec4, vertexColor } from "three/tsl";
import { assemble, box, cyl, jitter, Rng, type Part } from "./kit";
import { PainterlyMaterial } from "./painterly";

/**
 * Animals as articulated figures, like the settlers: body, head and neck, four legs and a tail,
 * each swung about its joint in the vertex shader. One draw call per species. Front is +Z.
 */

export type Species = "deer" | "sheep" | "cow" | "dog";

export const enum Pose {
  Idle = 0,
  Walk = 1,
  Graze = 2,
  Run = 3,
}

const enum A {
  Body = 0,
  Head = 1,
  LegFL = 2,
  LegFR = 3,
  LegBL = 4,
  LegBR = 5,
  Tail = 6,
}

interface Piece {
  part: A;
  pivot: [number, number, number];
  parts: Part[];
}

function legs(x: number, zf: number, zb: number, top: number, r: number, colour: string, hoof: string): Piece[] {
  const out: Piece[] = [];
  for (const [part, lx, lz] of [
    [A.LegFL, -x, zf],
    [A.LegFR, x, zf],
    [A.LegBL, -x, zb],
    [A.LegBR, x, zb],
  ] as const) {
    out.push({ part, pivot: [lx, top, lz], parts: [[cyl(r * 0.8, r, top - 0.03, 5, lx, 0.03, lz), colour], [cyl(r * 0.9, r * 0.9, 0.035, 5, lx, 0, lz), hoof]] });
  }
  return out;
}

function speciesPieces(species: Species): Piece[] {
  const rng = new Rng(species.length * 13);
  switch (species) {
    case "deer": {
      const coat = "#9a6a44";
      const top = 0.34;
      const body: Part[] = [
        [new THREE.SphereGeometry(0.13, 10, 7).scale(0.85, 0.85, 2.0).translate(0, 0.44, 0), coat],
        [new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.8, 1).translate(0, 0.4, -0.2), "#e8dcc4"],
      ];
      const head: Part[] = [
        [cyl(0.045, 0.06, 0.26, 6, 0, 0, 0).rotateX(0.55).translate(0, 0.46, 0.2), coat],
        [new THREE.SphereGeometry(0.065, 8, 6).scale(0.8, 0.85, 1.4).translate(0, 0.68, 0.36), coat],
        [box(0.02, 0.06, 0.03, -0.05, 0.72, 0.32).rotateZ(0.5), coat],
        [box(0.02, 0.06, 0.03, 0.05, 0.72, 0.32).rotateZ(-0.5), coat],
        [box(0.012, 0.16, 0.012, -0.03, 0.73, 0.31).rotateZ(0.35), "#d8c8a8"],
        [box(0.012, 0.16, 0.012, 0.03, 0.73, 0.31).rotateZ(-0.35), "#d8c8a8"],
        [new THREE.SphereGeometry(0.018, 5, 4).translate(0, 0.66, 0.45), "#2a2622"],
      ];
      return [
        { part: A.Body, pivot: [0, 0, 0], parts: body },
        { part: A.Head, pivot: [0, 0.48, 0.2], parts: head },
        ...legs(0.07, 0.17, -0.18, top, 0.025, coat, "#2a2622"),
        { part: A.Tail, pivot: [0, 0.48, -0.25], parts: [[box(0.04, 0.08, 0.03, 0, 0.42, -0.26), "#f0e8d8"]] },
      ];
    }
    case "sheep": {
      const wool = "#ece6d8";
      const top = 0.18;
      const body: Part[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        body.push([new THREE.IcosahedronGeometry(0.1 + rng.range(0, 0.03), 1).translate(Math.cos(a) * 0.07, 0.3 + Math.sin(a) * 0.04, (i / 7 - 0.5) * 0.26), jitter(wool, rng, 0.6)]);
      }
      body.push([new THREE.SphereGeometry(0.13, 9, 7).scale(1, 0.9, 1.4).translate(0, 0.3, 0), wool]);
      const head: Part[] = [
        [new THREE.SphereGeometry(0.06, 8, 6).scale(0.8, 0.9, 1.3).translate(0, 0.37, 0.24), "#2e2a28"],
        [box(0.08, 0.02, 0.03, 0, 0.39, 0.21), "#2e2a28"],
        [new THREE.IcosahedronGeometry(0.055, 1).translate(0, 0.42, 0.2), wool],
      ];
      return [
        { part: A.Body, pivot: [0, 0, 0], parts: body },
        { part: A.Head, pivot: [0, 0.33, 0.16], parts: head },
        ...legs(0.06, 0.1, -0.11, top, 0.018, "#2e2a28", "#1e1a18"),
        { part: A.Tail, pivot: [0, 0.32, -0.2], parts: [[new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.3, -0.22), wool]] },
      ];
    }
    case "dog": {
      // A thick-coated sled dog: grey back, pale belly and mask, curled tail, a red harness.
      const coat = "#6e6a66";
      const pale = "#e6e0d6";
      const top = 0.16;
      const body: Part[] = [
        [new THREE.SphereGeometry(0.075, 9, 6).scale(1, 0.95, 2.1).translate(0, 0.25, 0), coat],
        [new THREE.SphereGeometry(0.06, 8, 5).scale(1, 0.8, 1.7).translate(0, 0.22, 0.01), pale],
        [new THREE.IcosahedronGeometry(0.075, 1).scale(1.1, 1.1, 0.9).translate(0, 0.28, 0.1), coat],
        [box(0.16, 0.025, 0.03, 0, 0.27, 0.07), "#b8443a"],
        [box(0.02, 0.1, 0.02, 0, 0.27, 0.07), "#b8443a"],
      ];
      const head: Part[] = [
        [new THREE.SphereGeometry(0.055, 8, 6).scale(0.95, 0.9, 1.05).translate(0, 0.35, 0.18), coat],
        [new THREE.SphereGeometry(0.035, 7, 5).scale(0.8, 0.7, 1.3).translate(0, 0.33, 0.235), pale],
        [new THREE.SphereGeometry(0.012, 5, 4).translate(0, 0.335, 0.28), "#1e1a18"],
        [new THREE.ConeGeometry(0.022, 0.06, 4).translate(-0.03, 0.41, 0.17), coat],
        [new THREE.ConeGeometry(0.022, 0.06, 4).translate(0.03, 0.41, 0.17), coat],
      ];
      return [
        { part: A.Body, pivot: [0, 0, 0], parts: body },
        { part: A.Head, pivot: [0, 0.3, 0.13], parts: head },
        ...legs(0.04, 0.09, -0.1, top, 0.016, coat, pale),
        { part: A.Tail, pivot: [0, 0.3, -0.15], parts: [[new THREE.TorusGeometry(0.045, 0.02, 5, 8, Math.PI * 1.4).rotateY(Math.PI / 2).translate(0, 0.33, -0.16), coat]] },
      ];
    }
    case "cow": {
      const hide = "#e8e0d0";
      const patch = "#3a302a";
      const top = 0.28;
      const body: Part[] = [
        [box(0.26, 0.24, 0.55, 0, 0.28, 0), hide],
        [box(0.265, 0.12, 0.2, 0, 0.36, 0.08), patch],
        [box(0.265, 0.1, 0.14, 0, 0.3, -0.16), patch],
        [new THREE.SphereGeometry(0.06, 6, 4).translate(0, 0.25, -0.12), "#e8a8a0"],
      ];
      const head: Part[] = [
        [box(0.12, 0.13, 0.18, 0, 0.42, 0.34), hide],
        [box(0.1, 0.07, 0.06, 0, 0.38, 0.44), "#d8a898"],
        [box(0.05, 0.03, 0.03, -0.09, 0.47, 0.32), hide],
        [box(0.05, 0.03, 0.03, 0.09, 0.47, 0.32), hide],
        [box(0.015, 0.05, 0.015, -0.05, 0.5, 0.33), "#d8d0b8"],
        [box(0.015, 0.05, 0.015, 0.05, 0.5, 0.33), "#d8d0b8"],
      ];
      return [
        { part: A.Body, pivot: [0, 0, 0], parts: body },
        { part: A.Head, pivot: [0, 0.4, 0.26], parts: head },
        ...legs(0.09, 0.18, -0.19, top, 0.028, hide, "#2a2622"),
        { part: A.Tail, pivot: [0, 0.38, -0.28], parts: [[box(0.02, 0.22, 0.02, 0, 0.18, -0.29), hide], [box(0.035, 0.05, 0.035, 0, 0.16, -0.29), patch]] },
      ];
    }
  }
}

function speciesGeometry(species: Species): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const pc of speciesPieces(species)) {
    const g = assemble(pc.parts, true);
    const n = g.getAttribute("position").count;
    const pivot = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pivot.set(pc.pivot, i * 3);
    g.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(n).fill(pc.part), 1));
    g.setAttribute("aPivot", new THREE.BufferAttribute(pivot, 3));
    geos.push(g);
  }
  const total = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["color", 3],
    ["aPart", 1],
    ["aPivot", 3],
  ] as const) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

type V3 = THREE.Node<"vec3">;
type F = THREE.Node<"float">;

function rotX(v: V3, a: F): V3 {
  const c = cos(a);
  const s = sin(a);
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
}

function rotQ(v: V3, q: THREE.Node<"vec4">): V3 {
  const t = cross(q.xyz, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}

/** One species' herd in a single instanced draw: `set` each animal, then `flush(n)`. */
export class AnimalBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, PainterlyMaterial>;
  private readonly pos: Float32Array;
  private readonly quat: Float32Array;
  private readonly anim: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  readonly uTime = uniform(0);

  constructor(
    species: Species,
    readonly capacity: number,
  ) {
    const base = speciesGeometry(species);
    const g = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    this.pos = new Float32Array(capacity * 3);
    this.quat = new Float32Array(capacity * 4);
    this.anim = new Float32Array(capacity * 4);
    const mk = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [mk(this.pos, 3), mk(this.quat, 4), mk(this.anim, 4)];
    g.setAttribute("iPos", this.attrs[0]!);
    g.setAttribute("iQuat", this.attrs[1]!);
    g.setAttribute("iAnim", this.attrs[2]!);
    g.instanceCount = 0;

    const mat = new PainterlyMaterial({ vertexColors: true, brush: 0.4, flatShading: species === "cow" });
    const part = attribute("aPart", "float");
    const pivot = attribute("aPivot", "vec3");
    const iAnim = attribute("iAnim", "vec4");
    const kind = iAnim.x;
    const t = this.uTime.add(iAnim.y);
    const scale = iAnim.z;
    const is = (k: number) => float(1).sub(abs(kind.sub(k)).min(1));
    const isPart = (k: number) => float(1).sub(abs(part.sub(k)).min(1));
    const moving = is(Pose.Walk).add(is(Pose.Run));
    const rate = float(7).add(is(Pose.Run).mul(7));
    const stride = sin(t.mul(rate));
    const amp = float(0.45).add(is(Pose.Run).mul(0.25)).mul(moving);
    // Diagonal pairs move together (a trot); negative swings forward.
    const legA = stride.mul(amp);
    const legB = stride.mul(amp).negate();
    const nibble = sin(t.mul(5)).mul(0.08);
    const look = sin(t.mul(0.7)).mul(0.12);
    const head = is(Pose.Graze).mul(float(-1.0).add(nibble)).add(is(Pose.Idle).mul(look)).add(moving.mul(stride.mul(0.06)));
    const tail = sin(t.mul(3.1)).mul(0.35).add(is(Pose.Run).mul(-0.6));
    const limb = isPart(A.LegFL)
      .mul(legA)
      .add(isPart(A.LegBR).mul(legA))
      .add(isPart(A.LegFR).mul(legB))
      .add(isPart(A.LegBL).mul(legB))
      .add(isPart(A.Head).mul(head.negate()))
      .add(isPart(A.Tail).mul(tail));
    const bounce = abs(stride).mul(0.03).mul(moving);
    const posed = rotX(attribute("position", "vec3").sub(pivot), limb.negate()).add(pivot).add(vec3(0, bounce, 0)).mul(max(scale, 0.01));
    const n0 = rotX(attribute("normal", "vec3"), limb.negate());
    const iQuat = attribute("iQuat", "vec4");
    mat.positionNode = rotQ(posed, iQuat).add(attribute("iPos", "vec3"));
    mat.normalNode = normalize(varying(transformNormalToView(rotQ(n0, iQuat))));
    mat.colorNode = vec4(vec3(vertexColor()), 1);
    mat.vertexColors = false;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  set(i: number, p: THREE.Vector3, q: THREE.Quaternion, pose: Pose, phase: number, scale = 1): void {
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.quat.set([q.x, q.y, q.z, q.w], i * 4);
    this.anim.set([pose, phase, scale, 0], i * 4);
  }

  flush(n: number, time: number): void {
    this.uTime.value = time;
    this.mesh.geometry.instanceCount = Math.min(n, this.capacity);
    for (const a of this.attrs) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
