import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  cos,
  cross,
  float,
  max,
  mix,
  normalize,
  select,
  sin,
  step,
  transformNormalToView,
  uniform,
  varying,
  vec3,
  vec4,
  vertexColor,
} from "three/tsl";
import { assemble, box, cyl, type Part } from "./kit";
import { PainterlyMaterial } from "./painterly";

/**
 * Settlers as articulated figures: torso, head, arms and legs, a hat per trade and a tool in
 * the right hand. One draw call for all of them; the vertex shader swings each limb about its
 * joint (no skinning), so thousands of figures stay cheap. Front is +Z, up is +Y.
 */

export const enum Anim {
  Idle = 0,
  Walk = 1,
  Carry = 2,
  Chop = 3,
  Hammer = 4,
  Dig = 5,
  Duel = 6,
  Saw = 7,
  Sow = 8,
  Reap = 9,
  Fish = 10,
  Bake = 11,
  Wave = 12,
  Rest = 13,
}

export const enum Hat {
  Cap = 0,
  Straw = 1,
  Hood = 2,
  Pointed = 3,
  Helmet = 4,
}

export const enum Tool {
  None = 0,
  Axe = 1,
  Hammer = 2,
  Spade = 3,
  Sword = 4,
  Pick = 5,
  Saw = 6,
  Scythe = 7,
  Rod = 8,
  Peel = 9,
  Cleaver = 10,
  Crook = 11,
}

const enum P {
  Torso = 0,
  Head = 1,
  ArmL = 2,
  ArmR = 3,
  LegL = 4,
  LegR = 5,
}

const HIP = 0.2;
const SHOULDER = 0.39;
const SKIN = "#e2a47c";
const TROUSERS = "#4a3a30";
const BOOTS = "#2f2620";
const WOOD = "#7a5638";
const METAL = "#b8bec8";

interface Piece {
  parts: Part[];
  part: P;
  pivot: [number, number, number];
  /** 1 where the owner's tunic colour applies. */
  tint?: number;
  /** Hat (10+) or tool (20+) variant, or -1 for always shown. */
  sel?: number;
}

function figureGeometry(): THREE.BufferGeometry {
  const pieces: Piece[] = [];
  // Legs (pivot at the hip) and boots.
  for (const [p, x] of [
    [P.LegL, -0.045],
    [P.LegR, 0.045],
  ] as const) {
    pieces.push({ part: p, pivot: [x, HIP, 0], parts: [[box(0.055, HIP - 0.03, 0.06, x, 0.03), TROUSERS], [box(0.06, 0.04, 0.09, x, 0, 0.012), BOOTS]] });
  }
  // Torso: a tapered tunic with a belt.
  pieces.push({ part: P.Torso, pivot: [0, HIP, 0], tint: 1, parts: [[cyl(0.075, 0.095, 0.24, 8, 0, HIP - 0.03), "#ffffff"]] });
  pieces.push({ part: P.Torso, pivot: [0, HIP, 0], parts: [[cyl(0.097, 0.097, 0.03, 8, 0, HIP), "#5a4030"]] });
  // Head: slightly large, with a nose so facing reads.
  pieces.push({
    part: P.Head,
    pivot: [0, 0.44, 0],
    parts: [
      [new THREE.SphereGeometry(0.075, 10, 7).translate(0, 0.5, 0), SKIN],
      [box(0.02, 0.025, 0.03, 0, 0.49, 0.075), "#d9a888"],
      [new THREE.SphereGeometry(0.078, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2.2).rotateX(-0.35).translate(0, 0.51, -0.01), "#5a4030"],
    ],
  });
  // Arms hang from the shoulders, sleeves in the tunic colour, bare hands.
  for (const [p, x] of [
    [P.ArmL, -0.105],
    [P.ArmR, 0.105],
  ] as const) {
    pieces.push({ part: p, pivot: [x, SHOULDER, 0], tint: 1, parts: [[box(0.045, 0.15, 0.05, x, SHOULDER - 0.15), "#ffffff"]] });
    pieces.push({ part: p, pivot: [x, SHOULDER, 0], parts: [[new THREE.SphereGeometry(0.028, 6, 4).translate(x, SHOULDER - 0.18, 0), SKIN]] });
  }
  // Hats.
  const hy = 0.56;
  pieces.push({ part: P.Head, pivot: [0, 0.44, 0], sel: 10 + Hat.Cap, parts: [[cyl(0.078, 0.082, 0.04, 10, 0, hy - 0.02), "#8a5a3a"], [box(0.1, 0.012, 0.06, 0, hy - 0.02, 0.07), "#6a4428"]] });
  pieces.push({ part: P.Head, pivot: [0, 0.44, 0], sel: 10 + Hat.Straw, parts: [[cyl(0.15, 0.15, 0.012, 12, 0, hy - 0.02), "#e2c46e"], [cyl(0.05, 0.075, 0.07, 10, 0, hy - 0.02), "#d8b85e"]] });
  pieces.push({ part: P.Head, pivot: [0, 0.44, 0], sel: 10 + Hat.Hood, parts: [[new THREE.SphereGeometry(0.088, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.7).translate(0, 0.5, -0.012), "#5f7a45"]] });
  pieces.push({ part: P.Head, pivot: [0, 0.44, 0], sel: 10 + Hat.Pointed, parts: [[new THREE.ConeGeometry(0.085, 0.2, 10).translate(0, hy + 0.08, 0), "#6a4a8a"], [cyl(0.12, 0.12, 0.012, 12, 0, hy - 0.02), "#6a4a8a"]] });
  pieces.push({ part: P.Head, pivot: [0, 0.44, 0], sel: 10 + Hat.Helmet, parts: [[new THREE.SphereGeometry(0.086, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.51, 0), METAL], [cyl(0.1, 0.1, 0.014, 10, 0, 0.51), "#8a909a"], [box(0.014, 0.06, 0.012, 0, 0.46, 0.085), "#8a909a"]] });
  // Tools, held in the right hand and pointing forward (they turn with the arm).
  const hx = 0.105;
  const hand = SHOULDER - 0.18;
  const handle = (len: number) => box(0.022, 0.022, len, hx, hand - 0.011, len / 2 - 0.04);
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Axe, parts: [[handle(0.3), WOOD], [box(0.012, 0.08, 0.06, hx, hand - 0.04, 0.23), METAL]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Hammer, parts: [[handle(0.2), WOOD], [box(0.05, 0.04, 0.07, hx, hand - 0.03, 0.15), "#6a6e76"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Spade, parts: [[handle(0.34), WOOD], [box(0.07, 0.012, 0.09, hx, hand - 0.017, 0.33), METAL]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Sword, parts: [[box(0.02, 0.012, 0.3, hx, hand - 0.006, 0.18), "#dde3ea"], [box(0.08, 0.018, 0.018, hx, hand - 0.01, 0.03), "#c9a24a"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Pick, parts: [[handle(0.28), WOOD], [box(0.012, 0.16, 0.025, hx, hand - 0.08, 0.23), "#6a6e76"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Saw, parts: [[box(0.03, 0.05, 0.08, hx, hand - 0.03, 0.02), WOOD], [box(0.006, 0.07, 0.3, hx, hand - 0.05, 0.2), "#c9cdd4"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Scythe, parts: [[handle(0.42), WOOD], [box(0.2, 0.01, 0.035, hx - 0.09, hand - 0.012, 0.36), "#c9cdd4"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Rod, parts: [[box(0.012, 0.012, 0.6, hx, hand - 0.006, 0.27).rotateX(-0.5).translate(0, 0.16, 0), WOOD], [box(0.003, 0.3, 0.003, hx, hand - 0.12, 0.57), "#e8e0d0"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Peel, parts: [[handle(0.4), WOOD], [box(0.12, 0.01, 0.14, hx, hand - 0.012, 0.42), "#b08a5c"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Cleaver, parts: [[handle(0.1), WOOD], [box(0.01, 0.08, 0.09, hx, hand - 0.05, 0.1), "#b8bec8"]] });
  pieces.push({ part: P.ArmR, pivot: [hx, SHOULDER, 0], sel: 20 + Tool.Crook, parts: [[box(0.018, 0.5, 0.018, hx, hand - 0.2, 0.05), WOOD], [new THREE.TorusGeometry(0.04, 0.009, 4, 8, Math.PI * 1.3).translate(hx, hand + 0.33, 0.09), WOOD]] });

  const geos: THREE.BufferGeometry[] = [];
  for (const pc of pieces) {
    const g = assemble(pc.parts, false);
    const n = g.getAttribute("position").count;
    const part = new Float32Array(n).fill(pc.part);
    const pivot = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pivot.set(pc.pivot, i * 3);
    g.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
    g.setAttribute("aPivot", new THREE.BufferAttribute(pivot, 3));
    g.setAttribute("aTint", new THREE.BufferAttribute(new Float32Array(n).fill(pc.tint ?? 0), 1));
    g.setAttribute("aSel", new THREE.BufferAttribute(new Float32Array(n).fill(pc.sel ?? -1), 1));
    geos.push(g);
  }
  // Merge by hand: all pieces share the same attribute set. The figure's own attributes (part,
  // pivot, tint, hat or tool) share one interleaved buffer: WebGPU allows only 8 vertex buffers
  // per draw on many GPUs, and the instanced data below needs its own.
  const total = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["color", 3],
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
  const extra = new Float32Array(total * EXTRA_STRIDE);
  let v = 0;
  for (const g of geos) {
    const n = g.getAttribute("position").count;
    const [part, pivot, tint, sel] = (["aPart", "aPivot", "aTint", "aSel"] as const).map((k) => g.getAttribute(k).array as Float32Array);
    for (let i = 0; i < n; i++, v++) extra.set([part![i]!, pivot![i * 3]!, pivot![i * 3 + 1]!, pivot![i * 3 + 2]!, tint![i]!, sel![i]!], v * EXTRA_STRIDE);
  }
  const ib = new THREE.InterleavedBuffer(extra, EXTRA_STRIDE);
  out.setAttribute("aPart", new THREE.InterleavedBufferAttribute(ib, 1, 0));
  out.setAttribute("aPivot", new THREE.InterleavedBufferAttribute(ib, 3, 1));
  out.setAttribute("aTint", new THREE.InterleavedBufferAttribute(ib, 1, 4));
  out.setAttribute("aSel", new THREE.InterleavedBufferAttribute(ib, 1, 5));
  return out;
}

/** Per-vertex figure data: part, pivot (3), tint, hat or tool. */
const EXTRA_STRIDE = 6;
/** Per-figure data: position (3), rotation (4), colour (3), animation (4). */
const INSTANCE_STRIDE = 14;

type V3 = THREE.Node<"vec3">;
type F = THREE.Node<"float">;

/** Rotate about the X axis (pitch: positive swings +Y toward +Z). */
function rotX(v: V3, a: F): V3 {
  const c = cos(a);
  const s = sin(a);
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
}

function rotQ(v: V3, q: THREE.Node<"vec4">): V3 {
  const t = cross(q.xyz, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}

/**
 * All settler figures in one instanced draw. Write per-figure data with `set`, then `flush(n)`.
 * Positions and rotations are in the parent group's frame.
 */
export class FigureBatch {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, PainterlyMaterial>;
  /** Every figure's data in one interleaved instance buffer (see INSTANCE_STRIDE). */
  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  readonly uTime = uniform(0);

  constructor(readonly capacity: number) {
    const base = figureGeometry();
    const g = new THREE.InstancedBufferGeometry();
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    this.data = new Float32Array(capacity * INSTANCE_STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, INSTANCE_STRIDE).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iPos", new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute("iQuat", new THREE.InterleavedBufferAttribute(this.buffer, 4, 3));
    g.setAttribute("iColor", new THREE.InterleavedBufferAttribute(this.buffer, 3, 7));
    g.setAttribute("iAnim", new THREE.InterleavedBufferAttribute(this.buffer, 4, 10));
    g.instanceCount = 0;

    const mat = new PainterlyMaterial({ vertexColors: true, brush: 0.3 });
    const part = attribute("aPart", "float");
    const pivot = attribute("aPivot", "vec3");
    const sel = attribute("aSel", "float");
    const iAnim = attribute("iAnim", "vec4");
    const iQuat = attribute("iQuat", "vec4");
    const kind = iAnim.x;
    const t = this.uTime.add(iAnim.y);
    const is = (k: number) => float(1).sub(abs(kind.sub(k)).min(1));
    const isPart = (k: number) => float(1).sub(abs(part.sub(k)).min(1));

    // Walk cycle (walk and carry), and the work motions.
    const w = sin(t.mul(11));
    const walking = is(Anim.Walk).add(is(Anim.Carry));
    const chop = sin(t.mul(5.5));
    const strike = max(sin(t.mul(7)), 0).pow(3);
    const dig = sin(t.mul(3.2));
    const duel = sin(t.mul(9));
    const idle = sin(t.mul(1.3)).mul(0.05);
    const saw = sin(t.mul(6.5));
    const cast = sin(t.mul(2.6));
    const reap = sin(t.mul(3.4));
    const bob = sin(t.mul(0.9));
    const push = sin(t.mul(2.2));
    const wave = sin(t.mul(8));
    const sowing = is(Anim.Sow).mul(0.5);
    // Angles per limb (negative swings forward).
    const legL = w.mul(0.55).mul(walking.add(sowing)).add(is(Anim.Duel).mul(-0.3)).add(is(Anim.Rest).mul(-1.45)).add(is(Anim.Reap).mul(-0.25));
    const legR = w.mul(-0.55).mul(walking.add(sowing)).add(is(Anim.Duel).mul(0.25)).add(is(Anim.Rest).mul(-1.5)).add(is(Anim.Reap).mul(0.2));
    const armSwing = w.mul(0.5).mul(is(Anim.Walk));
    const armL = armSwing
      .negate()
      .add(is(Anim.Carry).mul(w.mul(-0.4)))
      .add(is(Anim.Chop).mul(float(-1.5).sub(chop.mul(0.9))))
      .add(is(Anim.Hammer).mul(-0.6))
      .add(is(Anim.Dig).mul(float(-0.9).add(dig.mul(0.35))))
      .add(is(Anim.Duel).mul(-0.5))
      .add(is(Anim.Saw).mul(float(-1.1).add(saw.mul(0.2))))
      .add(is(Anim.Sow).mul(-0.55))
      .add(is(Anim.Reap).mul(float(-1.0).add(reap.mul(0.45))))
      .add(is(Anim.Fish).mul(-0.9))
      .add(is(Anim.Bake).mul(float(-1.1).add(push.mul(0.25))))
      .add(is(Anim.Rest).mul(-0.4))
      .add(is(Anim.Idle).mul(idle));
    const armR = armSwing
      .add(is(Anim.Carry).mul(-3.2))
      .add(is(Anim.Chop).mul(float(-1.5).sub(chop.mul(0.9))))
      .add(is(Anim.Hammer).mul(float(-2.1).add(strike.mul(1.3))))
      .add(is(Anim.Dig).mul(float(-0.7).add(dig.mul(0.35))))
      .add(is(Anim.Duel).mul(float(-1.4).add(duel.mul(0.9))))
      .add(is(Anim.Saw).mul(float(-1.3).add(saw.mul(0.35))))
      .add(is(Anim.Sow).mul(float(-0.9).add(cast.mul(0.8))))
      .add(is(Anim.Reap).mul(float(-1.1).add(reap.mul(0.55))))
      .add(is(Anim.Fish).mul(float(-1.2).add(bob.mul(0.08))))
      .add(is(Anim.Bake).mul(float(-1.2).add(push.mul(0.3))))
      .add(is(Anim.Wave).mul(float(-2.9).add(wave.mul(0.25))))
      .add(is(Anim.Rest).mul(-0.3))
      .add(is(Anim.Idle).mul(idle.negate()));
    const lean = is(Anim.Chop)
      .mul(chop.mul(0.18).add(0.1))
      .add(is(Anim.Dig).mul(dig.mul(0.18).add(0.3)))
      .add(is(Anim.Hammer).mul(strike.mul(0.12).add(0.05)))
      .add(is(Anim.Carry).mul(0.08))
      .add(is(Anim.Saw).mul(saw.mul(0.06).add(0.18)))
      .add(is(Anim.Reap).mul(reap.mul(0.12).add(0.28)))
      .add(is(Anim.Bake).mul(push.mul(0.08).add(0.12)))
      .add(is(Anim.Sow).mul(0.06))
      .add(is(Anim.Rest).mul(-0.12));
    const limb = isPart(P.LegL)
      .mul(legL)
      .add(isPart(P.LegR).mul(legR))
      .add(isPart(P.ArmL).mul(armL))
      .add(isPart(P.ArmR).mul(armR))
      .add(isPart(P.Head).mul(idle.mul(0.5)));
    const upper = float(1).sub(isPart(P.LegL)).sub(isPart(P.LegR));

    // Hide hats and tools this figure doesn't use.
    const isHat = step(10, sel).mul(float(1).sub(step(20, sel)));
    const hatOn = select(isHat.greaterThan(0.5), float(1).sub(abs(sel.sub(10).sub(iAnim.z)).min(1)), float(1));
    const toolOn = select(sel.lessThan(20), float(1), float(1).sub(abs(sel.sub(20).sub(iAnim.w)).min(1)));
    const show = hatOn.mul(toolOn);

    const hip = vec3(0, HIP, 0);
    const pose = (v: V3, around: V3): V3 => {
      const local = rotX(v.sub(around), limb.negate()).add(around);
      const bent = rotX(local.sub(hip), lean.mul(upper)).add(hip);
      return bent;
    };
    const p0 = pose(attribute("position", "vec3").mul(show), pivot);
    const n0 = rotX(rotX(attribute("normal", "vec3"), limb.negate()), lean.mul(upper));
    // Resting settlers sit on the ground.
    const seated = p0.add(vec3(0, is(Anim.Rest).mul(-0.15), 0));
    mat.positionNode = rotQ(seated, iQuat).add(attribute("iPos", "vec3"));
    const nView = varying(transformNormalToView(rotQ(n0, iQuat)));
    mat.normalNode = normalize(nView);
    const tint = attribute("aTint", "float");
    mat.colorNode = vec4(mix(vec3(vertexColor()), attribute("iColor", "vec3"), tint), 1);
    // The node already includes the vertex colour; don't let the material multiply it again.
    mat.vertexColors = false;

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  set(i: number, p: THREE.Vector3, q: THREE.Quaternion, c: THREE.Color, anim: Anim, phase: number, hat: Hat, tool: Tool): void {
    this.data.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, c.r, c.g, c.b, anim, phase, hat, tool], i * INSTANCE_STRIDE);
  }

  flush(n: number, time: number): void {
    this.uTime.value = time;
    this.mesh.geometry.instanceCount = Math.min(n, this.capacity);
    this.buffer.needsUpdate = true;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, Math.min(n, this.capacity) * INSTANCE_STRIDE);
  }
}
