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
  /** Marker for the owner's colour: replaced per building by the material. */
  player: "#ff00ff",
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

/** Walls of coursed stone blocks around a rectangle. */
export function stoneWalls(w: number, d: number, h: number, y: number, rng: Rng, tone: Colour = C.stone): Part[] {
  const parts: Part[] = [[box(w - 0.04, h, d - 0.04, 0, y), new THREE.Color(tone).multiplyScalar(0.8)]];
  const course = 0.13;
  const rows = Math.max(2, Math.round(h / course));
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const yy = y + r * rh;
    for (const [len, along, off] of [
      [w, "x", d / 2],
      [w, "x", -d / 2],
      [d, "z", w / 2],
      [d, "z", -w / 2],
    ] as const) {
      let s0 = -len / 2 + (r % 2 ? rng.range(0.05, 0.12) : 0);
      if (r % 2) parts.push([along === "x" ? box(s0 + len / 2, rh - 0.012, 0.06, (-len / 2 + s0) / 2, yy, off) : box(0.06, rh - 0.012, s0 + len / 2, off, yy, (-len / 2 + s0) / 2), jitter(tone, rng, 2)]);
      while (s0 < len / 2 - 0.01) {
        const l = Math.min(len / 2 - s0, rng.range(0.14, 0.26));
        const c = s0 + l / 2;
        const g = along === "x" ? box(l - 0.012, rh - 0.012, 0.06, c, yy, off) : box(0.06, rh - 0.012, l - 0.012, off, yy, c);
        parts.push([g, jitter(tone, rng, 2)]);
        s0 += l;
      }
    }
  }
  return parts;
}

/** A round stone tower of coursed blocks. */
export function roundTower(r: number, h: number, y: number, rng: Rng, tone: Colour = C.stone, taper = 0.9): Part[] {
  const parts: Part[] = [[cyl(r * taper - 0.02, r - 0.02, h, 12, 0, y), new THREE.Color(tone).multiplyScalar(0.8)]];
  const course = 0.14;
  const rows = Math.max(2, Math.round(h / course));
  const rh = h / rows;
  for (let i = 0; i < rows; i++) {
    const f = i / rows;
    const rr = r * (1 - (1 - taper) * f);
    const n = Math.max(8, Math.round((Math.PI * 2 * rr) / 0.22));
    const off = i % 2 ? Math.PI / n : 0;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + off;
      const len = ((Math.PI * 2 * rr) / n) * 0.96;
      const g = box(len, rh - 0.012, 0.06, 0, 0, 0).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * rr, y + i * rh, Math.sin(a) * rr);
      parts.push([g, jitter(tone, rng, 2)]);
    }
  }
  return parts;
}

/** A conical roof of shingle rings with a finial. */
export function coneRoof(r: number, h: number, y: number, colour: Colour, rng: Rng): Part[] {
  const parts: Part[] = [[new THREE.ConeGeometry(r * 0.97, h * 0.97, 16).translate(0, y + h / 2, 0), new THREE.Color(colour).multiplyScalar(0.7)]];
  const rings = Math.max(3, Math.round(h / 0.13));
  const base = new THREE.Color(colour);
  for (let i = 0; i < rings; i++) {
    const f0 = i / rings;
    const rr = r * (1 - f0) + 0.03;
    const n = Math.max(6, Math.round((Math.PI * 2 * rr) / 0.16));
    const slant = Math.atan2(h, r);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (i % 2 ? Math.PI / n : 0);
      const len = h / rings / Math.sin(slant) * 1.4;
      const g = new THREE.BoxGeometry(((Math.PI * 2 * rr) / n) * 1.02, 0.025, len).rotateX(slant + 0.08).translate(0, 0, 0).rotateY(-a + Math.PI / 2);
      const c = base.clone();
      c.offsetHSL(rng.range(-0.01, 0.01), rng.range(-0.04, 0.04), rng.range(-0.06, 0.06));
      parts.push([g.translate(Math.cos(a) * rr * 0.93, y + f0 * h + 0.02, Math.sin(a) * rr * 0.93), c]);
    }
  }
  parts.push([new THREE.SphereGeometry(0.045, 6, 4).translate(0, y + h + 0.02, 0), "#3a3a3a"]);
  return parts;
}

/** A small pennant in the owner's colour on a pole, rising from (x, y, z). */
export function pennant(x: number, y: number, z: number, h = 0.5): Part[] {
  const flag = new THREE.BufferGeometry();
  flag.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.28, -0.05, 0, 0, -0.14, 0, 0, 0, 0, 0, -0.14, 0, 0.28, -0.05, 0], 3));
  flag.computeVertexNormals();
  return [
    [cyl(0.018, 0.022, h, 5, x, y, z), C.timber],
    [flag.translate(x + 0.02, y + h - 0.02, z), C.player],
  ];
}

/** A hanging banner in the owner's colour on a wall facing +Z. */
export function banner(x: number, y: number, z: number, w = 0.26, h = 0.42): Part[] {
  return [
    [box(w + 0.08, 0.03, 0.03, x, y, z + 0.02), C.timber],
    [box(w, h, 0.015, x, y - h, z + 0.03), C.player],
    [box(w, 0.04, 0.02, x, y - h - 0.02, z + 0.035), "#d8b25a"],
  ];
}

export function hayBale(x: number, z: number, rng: Rng, ry = 0): Part[] {
  const c = jitter("#d8b95c", rng, 1.5);
  return [[box(0.34, 0.2, 0.22, x, 0, z, ry), c], [box(0.35, 0.02, 0.23, x, 0.08, z, ry), new THREE.Color(c).multiplyScalar(0.75)]];
}

export function sack(x: number, z: number, rng: Rng, c: Colour = "#cdbb95"): Part[] {
  return [
    [new THREE.SphereGeometry(0.09, 8, 6).scale(1, 1.1, 0.8).translate(x, 0.09, z), jitter(c, rng)],
    [cyl(0.03, 0.045, 0.05, 6, x, 0.17, z), jitter(c, rng)],
  ];
}

/** Scaffolding around a footprint: poles, ledgers and a couple of plank decks. */
export function scaffolding(w: number, d: number, h: number): Part[] {
  const parts: Part[] = [];
  const wood = "#b08a5c";
  const xs = [-w / 2 - 0.12, w / 2 + 0.12];
  const zs = [-d / 2 - 0.12, d / 2 + 0.12];
  const nx = Math.max(2, Math.round(w / 0.7) + 1);
  const nz = Math.max(2, Math.round(d / 0.7) + 1);
  for (let i = 0; i < nx; i++) for (const z of zs) parts.push([cyl(0.025, 0.025, h, 5, xs[0]! + ((xs[1]! - xs[0]!) * i) / (nx - 1), 0, z), wood]);
  for (let i = 1; i < nz - 1; i++) for (const x of xs) parts.push([cyl(0.025, 0.025, h, 5, x, 0, zs[0]! + ((zs[1]! - zs[0]!) * i) / (nz - 1)), wood]);
  for (let y = 0.45; y < h; y += 0.45) {
    for (const z of zs) parts.push([box(w + 0.3, 0.03, 0.03, 0, y, z), wood]);
    for (const x of xs) parts.push([box(0.03, 0.03, d + 0.3, x, y, 0), wood]);
    for (const z of zs) parts.push([box(w + 0.28, 0.025, 0.14, 0, y + 0.03, z + Math.sign(z) * -0.05), "#c8a06a"]);
  }
  // Diagonal braces on the long sides.
  for (const z of zs) {
    const len = Math.hypot(w, h * 0.8);
    parts.push([new THREE.BoxGeometry(len, 0.025, 0.025).rotateZ(Math.atan2(h * 0.8, w)).translate(0, h * 0.4, z), wood]);
  }
  return parts;
}

/** Marked-out ground: corner pegs joined by string, and a few tools. */
export function markedGround(w: number, d: number): Part[] {
  const parts: Part[] = [];
  const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const;
  for (const [x, z] of cs) parts.push([box(0.04, 0.22, 0.04, x, 0, z), "#b08a5c"]);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cs[i]!;
    const [bx, bz] = cs[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, bz - az);
    parts.push([box(len, 0.008, 0.008, (ax + bx) / 2, 0.16, (az + bz) / 2, -Math.atan2(bz - az, bx - ax)), "#efe6d2"]);
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
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
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
    if (isWindow(r, g, b) || (r > 0.95 && g < 0.05 && b > 0.95)) continue;
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

/**
 * A clinker-built hull lofted from cross sections: fine at the bow (+z), fuller at the stern,
 * with sheer rising toward both ends. Each strake is its own part, lapped a little over the one
 * below, so the planking reads from afar. Returns the parts and the gunwale half-width per z.
 */
export function hull(len: number, beam: number, depth: number, rng: Rng, tone: Colour = "#7a5238"): { parts: Part[]; halfWidth: (z: number) => number; sheer: (z: number) => number } {
  const L = len / 2;
  const halfWidth = (z: number) => {
    const u = Math.min(1, Math.abs(z) / L);
    return beam * Math.max(0, 1 - Math.pow(u, z > 0 ? 1.7 : 3.2));
  };
  const sheer = (z: number) => depth + 0.28 * Math.pow(z / L, 2);
  // The keel rockers up toward the bow and a little at the stern.
  const keel = (z: number) => (z > 0 ? 0.55 * Math.pow(z / L, 2.4) * depth : 0.2 * Math.pow(-z / L, 3) * depth);
  const stations = 22;
  const strakes = 7;
  const parts: Part[] = [];
  for (let k = 0; k < strakes; k++) {
    const pos: number[] = [];
    for (const side of [-1, 1]) {
      const at = (i: number, f: number, lap: number): [number, number, number] => {
        const z = -L + (i / stations) * len;
        const b = halfWidth(z) * (1 + lap);
        const top = sheer(z);
        const bot = keel(z);
        const phi = (f * Math.PI) / 2;
        return [side * b * Math.sin(phi), top - (top - bot) * Math.pow(Math.cos(phi), 1.25), z];
      };
      const f0 = k / strakes;
      const f1 = (k + 1) / strakes;
      for (let i = 0; i < stations; i++) {
        const a = at(i, f0, 0.035);
        const b = at(i + 1, f0, 0.035);
        const c = at(i + 1, f1, 0);
        const d = at(i, f1, 0);
        const tri = side > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
        for (const p of tri) pos.push(...p);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const c = jitter(tone, rng, 2).offsetHSL(0, 0, (k % 2 ? -0.03 : 0.02) + (k > strakes - 2 ? 0.04 : 0));
    parts.push([g, c]);
  }
  // Keel, stem and sternpost: short timbers following the rocker and rising past the sheer.
  const post = (z0: number, z1: number, y0: number, y1: number) => {
    const dz = z1 - z0;
    const dy = y1 - y0;
    const l = Math.hypot(dz, dy);
    const g = new THREE.BoxGeometry(0.12, 0.14, l).rotateX(-Math.atan2(dy, dz)).translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.push([g, "#4e3524"]);
  };
  for (let i = 0; i < 10; i++) {
    const z0 = -L + (i / 10) * len * 0.96;
    const z1 = -L + ((i + 1) / 10) * len * 0.96;
    post(z0, z1, keel(z0) - 0.04, keel(z1) - 0.04);
  }
  const stemTop = sheer(L) + 0.45;
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 0.5;
    const a1 = ((i + 1) / 4) * Math.PI * 0.5;
    const r = 0.35;
    post(L * 0.96 + Math.sin(a0) * r - 0.1, L * 0.96 + Math.sin(a1) * r - 0.1, keel(L * 0.96) + (stemTop - keel(L)) * (i / 4), keel(L * 0.96) + (stemTop - keel(L)) * ((i + 1) / 4));
  }
  post(-L - 0.02, -L - 0.12, keel(-L), sheer(-L) + 0.25);
  // Gunwale rails.
  for (const side of [-1, 1]) {
    for (let i = 0; i < stations; i++) {
      const z0 = -L + (i / stations) * len;
      const z1 = z0 + len / stations;
      const x0 = side * halfWidth(z0);
      const x1 = side * halfWidth(z1);
      const y0 = sheer(z0);
      const y1 = sheer(z1);
      const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      if (l < 1e-3) continue;
      const g = new THREE.BoxGeometry(0.08, 0.07, l);
      g.lookAt(new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.02, (z0 + z1) / 2);
      parts.push([g, "#5a3d2a"]);
    }
  }
  return { parts, halfWidth, sheer };
}
