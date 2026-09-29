import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * The procedural building kit: stone plinths, timber-framed walls, shingle roofs, framed
 * windows with shutters, doors, chimneys and props. Parts carry a flat colour; `assemble`
 * merges them into one geometry and bakes ambient occlusion into the vertex colours (darker
 * near the ground and on faces turned down, like under eaves). Front is +Z, up is +Y.
 */

export type Colour = string | THREE.Color;
export type Part = [THREE.BufferGeometry, Colour];

/** Small seeded generator for variation between buildings of the same kind. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed * 0x9e3779b1) >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length) % xs.length] as T;
  }
}

/** A colour shifted slightly in hue, saturation and value. */
export function jitter(c: Colour, rng: Rng, amount = 1): THREE.Color {
  const out = new THREE.Color(c);
  out.offsetHSL(rng.range(-0.012, 0.012) * amount, rng.range(-0.04, 0.04) * amount, rng.range(-0.05, 0.05) * amount);
  return out;
}

export const C = {
  stone: "#9a948a",
  stoneDark: "#7c766d",
  plaster: "#e3d3b2",
  timber: "#5f412c",
  timberLight: "#8a6444",
  window: "#ffd58a",
  glassFrame: "#3f2c1e",
  roofRed: "#a8513c",
  roofSlate: "#56657a",
  roofThatch: "#b8995a",
  roofMoss: "#6b7d4a",
  shutterGreen: "#4f7a5a",
  shutterBlue: "#4f6a8a",
  shutterRed: "#9a4a3a",
  log: "#7a5638",
  logEnd: "#c9a36e",
  plank: "#d9b27a",
  rope: "#c9bfa8",
} as const;

export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  return g.translate(x, y + h / 2, z);
};

export const cyl = (rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);

/** A log lying along X. */
export function log(len: number, r: number, x: number, y: number, z: number, ry = 0): Part[] {
  const bark = new THREE.CylinderGeometry(r, r, len, 7).rotateZ(Math.PI / 2);
  const ends = new THREE.CylinderGeometry(r * 0.82, r * 0.82, len + 0.012, 7).rotateZ(Math.PI / 2);
  if (ry) {
    bark.rotateY(ry);
    ends.rotateY(ry);
  }
  return [
    [bark.translate(x, y + r, z), C.log],
    [ends.translate(x, y + r, z), C.logEnd],
  ];
}

/** A pyramid of logs. */
export function logStack(x: number, z: number, rows: number, len: number, rng: Rng, ry = 0): Part[] {
  const parts: Part[] = [];
  const r = 0.07;
  for (let row = 0; row < rows; row++) {
    const n = rows - row + 1;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * r * 2.02;
      const ox = Math.sin(ry) * off;
      const oz = Math.cos(ry) * off;
      parts.push(...log(len * rng.range(0.9, 1.05), r, x + ox + rng.range(-0.02, 0.02), row * r * 1.7, z + oz, ry));
    }
  }
  return parts;
}

/** A stack of sawn planks. */
export function plankStack(x: number, z: number, layers: number, rng: Rng, ry = 0): Part[] {
  const parts: Part[] = [];
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < 3; i++) {
      const g = box(0.7, 0.035, 0.1, 0, l * 0.04, (i - 1) * 0.105).rotateY(ry + rng.range(-0.04, 0.04));
      parts.push([g.translate(x, 0, z), jitter(C.plank, rng, 1.5)]);
    }
  }
  return parts;
}

export function barrel(x: number, z: number, rng: Rng, h = 0.26): Part[] {
  return [
    [new THREE.CylinderGeometry(0.1, 0.1, h, 9).translate(x, h / 2, z), jitter(C.timberLight, rng)],
    [new THREE.CylinderGeometry(0.108, 0.108, 0.025, 9).translate(x, h * 0.2, z), "#3a3a3e"],
    [new THREE.CylinderGeometry(0.108, 0.108, 0.025, 9).translate(x, h * 0.8, z), "#3a3a3e"],
  ];
}

export function crate(x: number, z: number, rng: Rng, s = 0.2, y = 0): Part[] {
  const c = jitter(C.plank, rng, 2);
  return [
    [box(s, s, s, x, y, z, rng.range(-0.3, 0.3)), c],
    [box(s * 1.02, s * 0.12, s * 1.02, x, y + s * 0.44, z), new THREE.Color(c).multiplyScalar(0.8)],
  ];
}

/** A bevelled stone plinth built from courses of individual stones. */
export function plinth(w: number, d: number, h: number, rng: Rng): Part[] {
  const parts: Part[] = [[box(w + 0.02, h * 0.6, d + 0.02), C.stoneDark]];
  const course = (len: number, along: "x" | "z", sign: number) => {
    let s = -len / 2;
    while (s < len / 2 - 0.02) {
      const l = Math.min(len / 2 - s, rng.range(0.16, 0.3));
      const c = s + l / 2;
      const sh = h * rng.range(0.85, 1.05);
      const depth = 0.07;
      const g =
        along === "x"
          ? box(l - 0.015, sh, depth, c, 0, sign * (d / 2 + 0.01))
          : box(depth, sh, l - 0.015, sign * (w / 2 + 0.01), 0, c);
      parts.push([g, jitter(C.stone, rng, 2)]);
      s += l;
    }
  };
  course(w, "x", 1);
  course(w, "x", -1);
  course(d, "z", 1);
  course(d, "z", -1);
  // Capstone ledge.
  parts.push([box(w + 0.1, 0.04, d + 0.1, 0, h - 0.02), jitter(C.stone, rng)]);
  return parts;
}

/** Plastered walls with a timber frame: corner posts, sill and head beams, and braces. */
export function timberWalls(w: number, d: number, h: number, y: number, rng: Rng, plaster: Colour = C.plaster): Part[] {
  const t = 0.055;
  const o = 0.012;
  const wood = jitter(C.timber, rng, 0.6);
  const parts: Part[] = [[box(w, h, d, 0, y), jitter(plaster, rng, 0.8)]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([box(t * 1.3, h, t * 1.3, (sx * w) / 2, y, (sz * d) / 2), wood]);
  for (const yy of [y, y + h - t]) {
    parts.push([box(w + o * 2, t, t, 0, yy, d / 2 + o), wood], [box(w + o * 2, t, t, 0, yy, -d / 2 - o), wood]);
    parts.push([box(t, t, d + o * 2, w / 2 + o, yy, 0), wood], [box(t, t, d + o * 2, -w / 2 - o, yy, 0), wood]);
  }
  // Mid rail on the long walls and diagonal braces in the end panels.
  parts.push([box(w, t * 0.8, t, 0, y + h * 0.5, d / 2 + o), wood], [box(w, t * 0.8, t, 0, y + h * 0.5, -d / 2 - o), wood]);
  const brace = (x0: number, x1: number, zf: number) => {
    const dx = x1 - x0;
    const dy = h * 0.5 - t;
    const len = Math.hypot(dx, dy);
    const g = new THREE.BoxGeometry(len, t * 0.8, t).rotateZ(Math.atan2(dy, dx));
    parts.push([g.translate((x0 + x1) / 2, y + t + dy / 2, zf), wood]);
  };
  const bw = Math.min(0.28, w * 0.2);
  for (const zf of [d / 2 + o, -d / 2 - o]) {
    brace(-w / 2 + t, -w / 2 + t + bw, zf);
    brace(w / 2 - t, w / 2 - t - bw, zf);
  }
  // Side walls: a post in the middle.
  for (const sx of [-1, 1]) parts.push([box(t, h, t, (sx * w) / 2 + sx * o, y, 0), wood]);
  return parts;
}

/** Log walls: horizontal logs with crossed corners. */
export function logWalls(w: number, d: number, h: number, y: number, rng: Rng): Part[] {
  const parts: Part[] = [[box(w - 0.04, h, d - 0.04, 0, y), "#6a4a30"]];
  const r = 0.055;
  const rows = Math.max(3, Math.round(h / (r * 1.9)));
  for (let i = 0; i < rows; i++) {
    const yy = y + i * (h / rows);
    const c = jitter(C.log, rng, 1.2);
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(r, r, w + 0.16, 6).rotateZ(Math.PI / 2).translate(0, yy + r, (sz * d) / 2);
      parts.push([g, c]);
    }
    for (const sx of [-1, 1]) {
      const g = new THREE.CylinderGeometry(r, r, d + 0.16, 6).rotateX(Math.PI / 2).translate((sx * w) / 2, yy + r, 0);
      parts.push([g, c]);
    }
  }
  return parts;
}

/**
 * Gabled roof along Z of rows of shingles (or thatch bundles) with a ridge cap and gable
 * infill. `y` is the eave height.
 */
export function shingleRoof(w: number, d: number, h: number, y: number, colour: Colour, rng: Rng, opts: { overhang?: number; gable?: Colour; thatch?: boolean } = {}): Part[] {
  const over = opts.overhang ?? 0.14;
  const parts: Part[] = [];
  // Gable infill (the wall triangle under the roof).
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h * 0.97)]);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false }).translate(0, y, -d / 2);
  parts.push([gable, opts.gable ?? C.plaster]);
  // Underside board (reads as the dark eave).
  const hw = w / 2 + over;
  const hd = d / 2 + over;
  const angle = Math.atan2(h, w / 2);
  const run = hw / Math.cos(angle);
  const base = new THREE.Color(colour);
  for (const side of [-1, 1]) {
    const board = new THREE.BoxGeometry(run, 0.03, hd * 2).rotateZ(side * -angle);
    const cx = (side * hw) / 2;
    const cy = y + h - (hw / 2) * Math.tan(angle) - 0.035;
    parts.push([board.translate(cx, cy, 0), C.timber]);
    // Rows from the eave up to the ridge; each row tilted a little more than the slope so the
    // bottom edges step out like real shingles.
    const rows = Math.max(4, Math.round(run / (opts.thatch ? 0.16 : 0.12)));
    const rowLen = (run / rows) * 1.35;
    const thick = opts.thatch ? 0.06 : 0.028;
    const tile = opts.thatch ? hd * 2 : 0.15;
    for (let r = 0; r < rows; r++) {
      const f = (r + 0.5) / rows;
      const along = run * (1 - f);
      const px = side * Math.cos(angle) * along;
      const py = y + h - Math.sin(angle) * along;
      const tiles = Math.max(1, Math.round((hd * 2) / tile));
      const tw = (hd * 2) / tiles;
      const off = r % 2 ? tw / 2 : 0;
      for (let i = 0; i < tiles + (off ? 1 : 0); i++) {
        const z0 = Math.max(-hd, -hd + i * tw - off);
        const z1 = Math.min(hd, -hd + (i + 1) * tw - off);
        if (z1 - z0 < 0.02) continue;
        const g = new THREE.BoxGeometry(rowLen, thick, z1 - z0 - (opts.thatch ? 0 : 0.008));
        g.rotateZ(side * -(angle + 0.09));
        const c = base.clone();
        const k = rng.range(-1, 1);
        c.offsetHSL(k * 0.01, rng.range(-0.05, 0.05), k * 0.06 + (f - 0.5) * 0.04);
        parts.push([g.translate(px, py + thick / 2, (z0 + z1) / 2), c]);
      }
    }
  }
  // Ridge cap.
  const ridge = new THREE.BoxGeometry(0.1, 0.1, hd * 2 + 0.04).rotateZ(Math.PI / 4).translate(0, y + h + 0.03, 0);
  parts.push([ridge, base.clone().multiplyScalar(opts.thatch ? 0.8 : 0.7)]);
  return parts;
}

/** A window with frame, cross mullion, sill and a pair of open shutters, on a wall facing +Z. */
export function windowPart(x: number, y: number, z: number, rng: Rng, shutter: Colour, ry = 0, size = 1): Part[] {
  const w = 0.24 * size;
  const h = 0.26 * size;
  const parts: Part[] = [
    [box(w + 0.06, h + 0.06, 0.03, 0, -0.03, 0.005), C.glassFrame],
    [box(w, h, 0.03, 0, 0, 0.02), C.window],
    [box(0.025, h, 0.03, 0, 0, 0.03), C.glassFrame],
    [box(w, 0.025, 0.03, 0, h / 2 - 0.0125, 0.03), C.glassFrame],
    [box(w + 0.12, 0.035, 0.08, 0, -0.06, 0.04), C.timberLight],
  ];
  const sc = jitter(shutter, rng);
  for (const s of [-1, 1]) parts.push([box(w * 0.5, h, 0.02, s * (w / 2 + w * 0.3), 0, 0.03), sc]);
  return parts.map(([g, c]) => [g.rotateY(ry).translate(x, y, z), c] as Part);
}

/** A plank door with a frame and a step. */
export function door(x: number, y: number, z: number, rng: Rng, ry = 0): Part[] {
  const w = 0.3;
  const h = 0.52;
  const parts: Part[] = [
    [box(w + 0.07, h + 0.05, 0.03, 0, 0, 0.005), C.glassFrame],
    [box(w, h, 0.03, 0, 0, 0.02), jitter(C.timberLight, rng, 1.5)],
    [box(0.04, 0.04, 0.03, w * 0.3, h * 0.45, 0.04), "#2a2622"],
    [box(w + 0.14, 0.06, 0.16, 0, -0.06, 0.08), jitter(C.stone, rng)],
  ];
  return parts.map(([g, c]) => [g.rotateY(ry).translate(x, y, z), c] as Part);
}

export function chimney(x: number, z: number, top: number, base: number, rng: Rng): Part[] {
  const h = top - base;
  return [
    [box(0.2, h, 0.2, x, base, z), jitter(C.stone, rng, 1.5)],
    [box(0.25, 0.05, 0.25, x, top, z), C.stoneDark],
  ];
}

/** Flower box under a window facing +Z. */
export function flowerBox(x: number, y: number, z: number, rng: Rng): Part[] {
  const parts: Part[] = [[box(0.28, 0.06, 0.07, x, y, z), C.timber]];
  const cols = ["#e56b6f", "#f4d35e", "#f7f0e6", "#b56bd6"];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.035, 0).translate(x - 0.1 + i * 0.066, y + 0.08, z);
    parts.push([g, i % 2 ? "#5f8f45" : rng.pick(cols)]);
  }
  return parts;
}

function colourOf(c: Colour): THREE.Color {
  return c instanceof THREE.Color ? c : new THREE.Color(c);
}

/** True for the window colour (kept exact so the material's night glow finds it). */
function isWindow(r: number, g: number, b: number): boolean {
  return r >= 0.95 && g >= 0.55 && g <= 0.8 && b >= 0.15 && b <= 0.4;
}

/** Merge parts into one flat-coloured geometry with baked ambient occlusion. */
export function assemble(parts: Part[], ao = true, keepNormals = false): THREE.BufferGeometry {
  const geos = parts.map(([g, c]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const col = colourOf(c);
    const n = geo.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    geo.deleteAttribute("uv");
    return geo;
  });
  const geo = mergeGeometries(geos);
  if (!keepNormals) geo.computeVertexNormals();
  if (ao) bakeAO(geo);
  return geo;
}

/** Darken near the ground and on downward faces (eaves, undersides). */
function bakeAO(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const col = geo.getAttribute("color");
  for (let i = 0; i < pos.count; i++) {
    const r = col.getX(i);
    const g = col.getY(i);
    const b = col.getZ(i);
    if (isWindow(r, g, b)) continue;
    const y = pos.getY(i);
    const ground = 0.62 + 0.38 * smooth(0, 0.45, y);
    const down = nor.getY(i) < -0.5 ? 0.55 : 1;
    const k = ground * down;
    col.setXYZ(i, r * k, g * k, b * k);
  }
  col.needsUpdate = true;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
