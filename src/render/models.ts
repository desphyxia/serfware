import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Procedural low-poly models. Each part is a primitive with a flat vertex colour; parts are
 * merged into one geometry per model so a building is a single draw call. Units: one tile is
 * about 3.5 wide; a settler is about 0.55 tall.
 */

type Part = [THREE.BufferGeometry, string];

function tint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute("uv");
  return geo;
}

function merge(parts: Part[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts.map(([g, c]) => tint(g, c)));
  geo.computeVertexNormals();
  return geo;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  return g.translate(x, y + h / 2, z);
};

const cyl = (rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);

/** Gabled roof: a triangular prism along Z. */
function roof(w: number, d: number, h: number, y: number, x = 0, z = 0, overhang = 0.12): THREE.BufferGeometry {
  const hw = w / 2 + overhang;
  const hd = d / 2 + overhang;
  const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: hd * 2, bevelEnabled: false });
  g.translate(0, 0, -hd);
  return g.translate(x, y, z);
}

const WALL = "#d9c7a4";
const WALL_DARK = "#b9a37f";
const TIMBER = "#6e4b33";
const ROOF_RED = "#a8513c";
const ROOF_SLATE = "#56657a";
const ROOF_MOSS = "#6b7d4a";
const STONE = "#9a948a";
const WINDOW = "#ffd58a";

function cottage(w: number, d: number, h: number, roofColor: string, extras: Part[] = []): THREE.BufferGeometry {
  return merge([
    [box(w + 0.1, 0.18, d + 0.1), STONE],
    [box(w, h, d, 0, 0.18), WALL],
    [box(0.08, h, 0.08, -w / 2, 0.18, d / 2), TIMBER],
    [box(0.08, h, 0.08, w / 2, 0.18, d / 2), TIMBER],
    [box(0.08, h, 0.08, -w / 2, 0.18, -d / 2), TIMBER],
    [box(0.08, h, 0.08, w / 2, 0.18, -d / 2), TIMBER],
    [roof(w, d, h * 0.75, h + 0.18), roofColor],
    [box(0.36, 0.55, 0.05, 0, 0.18, d / 2 + 0.01), TIMBER],
    [box(0.26, 0.24, 0.05, -w * 0.28, h * 0.45 + 0.18, d / 2 + 0.01), WINDOW],
    [box(0.26, 0.24, 0.05, w * 0.28, h * 0.45 + 0.18, d / 2 + 0.01), WINDOW],
    [box(0.22, h * 0.9, 0.22, w * 0.3, h * 0.6 + 0.18, -d * 0.2), STONE],
    ...extras,
  ]);
}

function logPile(x: number, z: number, n = 3): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6).rotateZ(Math.PI / 2);
    out.push([g.translate(x, 0.1 + (i > 1 ? 0.17 : 0), z + (i % 2) * 0.2 - 0.1 + (i > 1 ? 0.1 : 0)), "#8a5a3a"]);
  }
  return out;
}

function stonePile(x: number, z: number): Part[] {
  return [
    [new THREE.DodecahedronGeometry(0.22).translate(x, 0.18, z), STONE],
    [new THREE.DodecahedronGeometry(0.17).translate(x + 0.25, 0.14, z + 0.1), "#8b857c"],
    [new THREE.DodecahedronGeometry(0.15).translate(x + 0.1, 0.38, z + 0.05), "#aaa398"],
  ];
}

/** The Hearthship: a landed ship-hull keep with a lantern tower and a furled sail mast. */
function hearthship(): THREE.BufferGeometry {
  const hull = new THREE.CylinderGeometry(1.25, 0.9, 3.4, 10, 1).rotateX(Math.PI / 2).scale(1, 0.62, 1).translate(0, 0.9, 0);
  const deck = box(2.1, 0.12, 3.0, 0, 1.55);
  const cabin = box(1.5, 1.0, 1.5, 0, 1.65, -0.4);
  const cabinRoof = roof(1.5, 1.5, 0.6, 2.65, 0, -0.4, 0.15);
  const tower = cyl(0.32, 0.4, 2.2, 8, 0.55, 1.6, 0.9);
  const lamp = cyl(0.26, 0.26, 0.38, 8, 0.55, 3.8, 0.9);
  const cap = new THREE.ConeGeometry(0.36, 0.45, 8).translate(0.55, 4.4, 0.9);
  const mast = cyl(0.06, 0.08, 3.2, 6, -0.55, 1.6, 0.8);
  const sail = box(0.12, 0.9, 1.2, -0.55, 3.2, 0.8);
  const ports: Part[] = [];
  for (let i = -1; i <= 1; i++) {
    ports.push([new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10).rotateZ(Math.PI / 2).translate(1.13, 1.0, i * 0.8), WINDOW]);
    ports.push([new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10).rotateZ(Math.PI / 2).translate(-1.13, 1.0, i * 0.8), WINDOW]);
  }
  const legs: Part[] = [];
  for (const [x, z] of [
    [0.9, 1.2],
    [-0.9, 1.2],
    [0.9, -1.2],
    [-0.9, -1.2],
  ] as const) legs.push([cyl(0.08, 0.14, 0.7, 6, x, 0, z), "#5a4a3c"]);
  return merge([
    [box(2.8, 0.15, 3.9), STONE],
    [hull, "#7a5238"],
    [box(2.5, 0.18, 3.5, 0, 0.35), "#5a3d2a"],
    [deck, "#a07a55"],
    [cabin, WALL],
    [cabinRoof, ROOF_SLATE],
    [box(0.3, 0.3, 0.05, 0.3, 2.1, 0.36), WINDOW],
    [box(0.3, 0.3, 0.05, -0.3, 2.1, 0.36), WINDOW],
    [tower, "#cbb994"],
    [lamp, WINDOW],
    [cap, ROOF_RED],
    [mast, TIMBER],
    [sail, "#e8dcc4"],
    ...ports,
    ...legs,
    ...logPile(-1.0, 1.6),
    ...stonePile(1.1, 1.6),
  ]);
}

function woodcutter(): THREE.BufferGeometry {
  const axeHandle = box(0.05, 0.5, 0.05, 0.75, 0.35, 0.55);
  axeHandle.rotateZ(0.3);
  return cottage(1.3, 1.0, 0.8, ROOF_MOSS, [
    ...logPile(-0.95, 0.2, 4),
    [cyl(0.2, 0.22, 0.3, 8, 0.75, 0, 0.55), "#9b6b45"],
    [axeHandle, TIMBER],
  ]);
}

function forester(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    parts.push([cyl(0.12, 0.09, 0.16, 7, -0.95 + i * 0.28, 0, 0.75), "#9b5b3a"]);
    parts.push([new THREE.ConeGeometry(0.1, 0.28, 6).translate(-0.95 + i * 0.28, 0.3, 0.75), "#5f8f4a"]);
  }
  return cottage(1.1, 1.0, 0.85, ROOF_RED, [...parts, [box(0.7, 0.4, 0.05, 0.9, 0, -0.1, Math.PI / 2), TIMBER]]);
}

function quarry(): THREE.BufferGeometry {
  return merge([
    [box(1.4, 0.18, 1.1), STONE],
    [box(1.2, 0.7, 0.9, 0, 0.18), WALL_DARK],
    [roof(1.2, 0.9, 0.5, 0.88), ROOF_SLATE],
    [box(0.3, 0.45, 0.05, 0, 0.18, 0.46), TIMBER],
    [box(0.22, 0.2, 0.05, 0.35, 0.5, 0.46), WINDOW],
    ...stonePile(-0.9, 0.5),
    ...stonePile(0.8, 0.7),
    [cyl(0.05, 0.05, 1.6, 5, -0.7, 0, -0.55), TIMBER],
    [box(0.9, 0.05, 0.05, -0.35, 1.55, -0.55), TIMBER],
  ]);
}

function sawmill(): THREE.BufferGeometry {
  const blade = new THREE.CylinderGeometry(0.34, 0.34, 0.04, 16).rotateZ(Math.PI / 2).translate(0.95, 0.55, 0.3);
  return merge([
    [box(2.0, 0.18, 1.2), STONE],
    [box(1.8, 0.75, 1.0, 0, 0.18), WALL],
    [roof(1.8, 1.0, 0.55, 0.93), ROOF_RED],
    [box(0.4, 0.55, 0.05, -0.4, 0.18, 0.51), TIMBER],
    [box(0.25, 0.22, 0.05, 0.4, 0.55, 0.51), WINDOW],
    [blade, "#c9c9cf"],
    [box(0.9, 0.12, 0.3, 1.2, 0.35, 0.3), "#8a6a4a"],
    ...logPile(-1.3, -0.1, 4),
    [box(0.7, 0.08, 0.4, 1.15, 0.2, -0.3), "#d9b27a"],
    [box(0.7, 0.08, 0.4, 1.15, 0.28, -0.3), "#d0a870"],
  ]);
}

export function constructionSite(progress: number): THREE.BufferGeometry {
  const parts: Part[] = [[box(1.6, 0.14, 1.3), STONE]];
  const h = 0.2 + progress * 1.0;
  for (const [x, z] of [
    [-0.75, -0.6],
    [0.75, -0.6],
    [-0.75, 0.6],
    [0.75, 0.6],
  ] as const) parts.push([box(0.07, 1.3, 0.07, x, 0.14, z), "#b08a5c"]);
  parts.push([box(1.6, 0.05, 0.07, 0, 1.2, 0.6), "#b08a5c"], [box(1.6, 0.05, 0.07, 0, 1.2, -0.6), "#b08a5c"]);
  if (progress > 0.05) parts.push([box(1.3, h * 0.8, 1.0, 0, 0.14), WALL_DARK]);
  parts.push(...logPile(0.95, 0.9, 2));
  return merge(parts);
}

const cache = new Map<string, THREE.BufferGeometry>();

export function buildingGeometry(id: string): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    switch (id) {
      case "keep": g = hearthship(); break;
      case "woodcutter": g = woodcutter(); break;
      case "forester": g = forester(); break;
      case "quarry": g = quarry(); break;
      case "sawmill": g = sawmill(); break;
      default: g = cottage(1.2, 1.0, 0.8, ROOF_RED);
    }
    cache.set(id, g);
  }
  return g;
}

// ---------------------------------------------------------------- nature and small props

export function coniferGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.07, 0.1, 0.5, 6), "#6b4a33"],
    [new THREE.ConeGeometry(0.62, 1.0, 7).translate(0, 0.9, 0), "#3f6b45"],
    [new THREE.ConeGeometry(0.48, 0.85, 7).translate(0, 1.35, 0), "#467450"],
    [new THREE.ConeGeometry(0.32, 0.7, 7).translate(0, 1.8, 0), "#4f7d56"],
  ]);
}

export function broadleafGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.08, 0.12, 0.8, 6), "#6e5038"],
    [new THREE.IcosahedronGeometry(0.62, 0).translate(0, 1.25, 0), "#5f8f45"],
    [new THREE.IcosahedronGeometry(0.45, 0).translate(0.3, 1.0, 0.12), "#6b9a4c"],
    [new THREE.IcosahedronGeometry(0.42, 0).translate(-0.28, 1.05, -0.1), "#56853f"],
  ]);
}

export function stumpGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.12, 0.15, 0.18, 7), "#7a5a3f"],
    [cyl(0.11, 0.11, 0.02, 7, 0, 0.18), "#c9a57a"],
  ]);
}

export function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.55, 0);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, y * 0.7 + 0.25);
    p.setX(i, p.getX(i) * (1 + Math.sin(i * 2.1) * 0.12));
  }
  return merge([
    [g, "#9b958b"],
    [new THREE.DodecahedronGeometry(0.3, 0).translate(0.45, 0.15, 0.2), "#8a847a"],
  ]);
}

export function flagGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.035, 0.045, 1.05, 5), "#d8cbb0"],
    [cyl(0.12, 0.14, 0.06, 6), "#8a7a64"],
  ]);
}

export function pennantGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.42, -0.1), new THREE.Vector2(0, -0.22)]);
  const g = new THREE.ShapeGeometry(shape);
  g.translate(0.03, 1.02, 0);
  return tint(g, "#f0b25a");
}

export function settlerBodyGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.075, 0.1, 0.3, 7, 0, 0.1), "#ffffff"],
    [box(0.05, 0.12, 0.05, -0.045, 0, 0), "#4a3a30"],
    [box(0.05, 0.12, 0.05, 0.045, 0, 0), "#4a3a30"],
  ]);
}

export function settlerHeadGeometry(): THREE.BufferGeometry {
  return merge([
    [new THREE.SphereGeometry(0.075, 8, 6).translate(0, 0.47, 0), "#e8c3a0"],
    [new THREE.SphereGeometry(0.078, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.49, 0), "#5a4030"],
  ]);
}

export function crateGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.2, 0.16, 0.2).translate(0, 0.08, 0);
}
