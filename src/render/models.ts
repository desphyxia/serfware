import * as THREE from "three/webgpu";
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

function house(): THREE.BufferGeometry {
  const parts: Part[] = [];
  // Flower boxes under the windows and a little garden fence.
  for (const x of [-0.32, 0.32]) {
    parts.push([box(0.3, 0.07, 0.08, x, 0.34, 0.54), "#6e4b33"]);
    parts.push([new THREE.IcosahedronGeometry(0.06, 0).translate(x - 0.08, 0.44, 0.55), "#e56b6f"]);
    parts.push([new THREE.IcosahedronGeometry(0.06, 0).translate(x + 0.06, 0.44, 0.55), "#f4d35e"]);
  }
  for (let i = 0; i < 5; i++) parts.push([box(0.04, 0.22, 0.04, -0.9 + i * 0.2, 0, 0.85), "#d8cbb0"]);
  parts.push([box(0.84, 0.03, 0.03, -0.5, 0.16, 0.85), "#d8cbb0"]);
  parts.push([new THREE.IcosahedronGeometry(0.22, 0).translate(0.85, 0.2, 0.6), "#5f8f45"]);
  return cottage(1.1, 0.95, 0.8, "#7a6a9a", parts);
}

function storehouse(): THREE.BufferGeometry {
  const parts: Part[] = [
    [box(2.6, 0.16, 2.0), STONE],
    [box(2.4, 1.15, 1.8, 0, 0.16), "#b5876a"],
    [roof(2.4, 1.8, 0.9, 1.31, 0, 0, 0.18), ROOF_SLATE],
    [box(0.8, 0.9, 0.05, 0, 0.16, 0.91), TIMBER],
    [box(0.05, 0.9, 0.05, 0, 0.16, 0.94), "#4a3222"],
    [box(0.3, 0.25, 0.05, 0.8, 0.75, 0.91), WINDOW],
    [box(0.3, 0.25, 0.05, -0.8, 0.75, 0.91), WINDOW],
  ];
  for (let i = 0; i < 4; i++) parts.push([box(0.35, 0.3, 0.35, -1.35 + (i % 2) * 0.4, (i > 1 ? 0.3 : 0) + 0.16, 1.1), "#c9a06a"]);
  parts.push(...stonePile(1.4, 1.2));
  return merge(parts);
}

function farm(): THREE.BufferGeometry {
  const silo = cyl(0.36, 0.36, 1.6, 12, 1.2, 0.14, -0.5);
  const dome = new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(1.2, 1.74, -0.5);
  return merge([
    [box(3.0, 0.14, 2.2), STONE],
    [box(1.3, 0.8, 1.0, -0.8, 0.14, 0.3), WALL],
    [roof(1.3, 1.0, 0.6, 0.94, -0.8, 0.3), ROOF_RED],
    [box(0.3, 0.45, 0.05, -0.8, 0.14, 0.81), TIMBER],
    [box(0.24, 0.2, 0.05, -1.2, 0.5, 0.81), WINDOW],
    [box(0.22, 0.8, 0.22, -0.45, 0.9, 0.1), STONE],
    [box(1.2, 1.0, 1.4, 0.35, 0.14, -0.4, 0.15), "#9a4a3a"],
    [roof(1.2, 1.4, 0.7, 1.14, 0.35, -0.4), "#6a4a3a"],
    [box(0.5, 0.6, 0.05, 0.35, 0.14, 0.31), "#e8dcc4"],
    [silo, "#cfc4b0"],
    [dome, "#8a8f98"],
    [box(0.9, 0.35, 0.5, 1.0, 0.14, 0.7), "#d8b95c"],
  ]);
}

function windmillBody(): THREE.BufferGeometry {
  return merge([
    [box(1.6, 0.14, 1.6), STONE],
    [cyl(0.5, 0.72, 2.2, 10, 0, 0.14), "#e2d6c0"],
    [new THREE.ConeGeometry(0.62, 0.8, 10).translate(0, 2.74, 0), ROOF_RED],
    [box(0.36, 0.6, 0.05, 0, 0.14, 0.72), TIMBER],
    [box(0.2, 0.2, 0.05, 0, 1.4, 0.58), WINDOW],
    [cyl(0.08, 0.08, 0.4, 6, 0, 2.2, 0.55).rotateX(Math.PI / 2).translate(0, 2.2 - 0.1, 0.2), TIMBER],
    ...logPile(0.9, 0.6, 2),
  ]);
}

/** Four sails, centred on the origin, facing +Z. Rotated by the renderer. */
export function windmillRotor(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const arm = new THREE.BoxGeometry(0.06, 1.3, 0.04).translate(0, 0.65, 0).rotateZ(a);
    const sail = new THREE.BoxGeometry(0.34, 1.0, 0.02).translate(0.2, 0.75, 0.02).rotateZ(a);
    parts.push([arm, TIMBER], [sail, "#efe6d2"]);
  }
  parts.push([new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8).rotateX(Math.PI / 2), TIMBER]);
  return merge(parts);
}
export const WINDMILL_HUB = new THREE.Vector3(0, 2.2, 0.82);

function bakery(): THREE.BufferGeometry {
  const oven = new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.85, 0.14, -0.1);
  return cottage(1.3, 1.0, 0.8, ROOF_RED, [
    [oven, "#b86a4a"],
    [box(0.2, 0.18, 0.05, 0.85, 0.14, 0.31), WINDOW],
    [box(0.14, 0.6, 0.14, 0.95, 0.35, -0.3), STONE],
    [box(0.4, 0.3, 0.3, -0.95, 0.14, 0.6), "#d9b27a"],
  ]);
}

function fisher(): THREE.BufferGeometry {
  const hull = new THREE.CylinderGeometry(0.28, 0.2, 1.3, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(1.0, 0.3, 0.6);
  return cottage(1.0, 0.9, 0.75, ROOF_SLATE, [
    [hull, "#6a4a3a"],
    [cyl(0.03, 0.03, 0.9, 5, -0.9, 0, 0.5), TIMBER],
    [cyl(0.03, 0.03, 0.9, 5, -0.9, 0, -0.3), TIMBER],
    [box(0.02, 0.5, 0.8, -0.9, 0.3, 0.1), "#c9bfa8"],
  ]);
}

function pasture(): THREE.BufferGeometry {
  const parts: Part[] = [[box(0.9, 0.6, 0.8, -0.6, 0, -0.5), "#a87a55"], [roof(0.9, 0.8, 0.4, 0.6, -0.6, -0.5), ROOF_MOSS]];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push([box(0.06, 0.4, 0.06, Math.cos(a) * 1.25, 0, Math.sin(a) * 1.05), TIMBER]);
    const b = a + Math.PI / 12;
    parts.push([box(0.66, 0.05, 0.04, Math.cos(b) * 1.22, 0.3, Math.sin(b) * 1.02, -b + Math.PI / 2), TIMBER]);
  }
  for (const [x, z] of [
    [0.3, 0.3],
    [0.6, -0.1],
    [-0.1, 0.55],
  ] as const) {
    parts.push([box(0.3, 0.2, 0.18, x, 0.08, z), "#f0c8b8"], [box(0.12, 0.12, 0.12, x + 0.18, 0.14, z), "#e8b8a8"]);
  }
  return merge(parts);
}

function butcher(): THREE.BufferGeometry {
  return cottage(1.1, 1.0, 0.8, ROOF_RED, [
    [box(1.1, 0.04, 0.4, 0, 0.75, 0.7), "#b33a3a"],
    [box(0.1, 0.22, 0.1, -0.3, 0.5, 0.75), "#b86a5a"],
    [box(0.1, 0.22, 0.1, 0.3, 0.5, 0.75), "#b86a5a"],
  ]);
}

const ORE_COLORS: Record<string, string> = { coal: "#2a2a2e", iron: "#a0583f", gold: "#e0b84a", granite: "#b8b2a8" };

function mine(resource: string): THREE.BufferGeometry {
  const cart = [
    [box(0.4, 0.22, 0.28, 0.75, 0.1, 0.55), "#5a4a3c"] as Part,
    [box(0.36, 0.08, 0.24, 0.75, 0.32, 0.55), ORE_COLORS[resource] ?? STONE] as Part,
  ];
  return merge([
    [new THREE.DodecahedronGeometry(1.0, 0).scale(1.2, 0.8, 1.0).translate(0, 0.35, -0.5), "#8d8479"],
    [box(0.9, 0.9, 0.3, 0, 0, 0.15), "#2a2320"],
    [box(0.12, 1.0, 0.12, -0.5, 0, 0.3), TIMBER],
    [box(0.12, 1.0, 0.12, 0.5, 0, 0.3), TIMBER],
    [box(1.2, 0.14, 0.16, 0, 0.95, 0.3), TIMBER],
    [box(0.08, 0.02, 1.0, -0.15, 0, 0.8), "#5a5a60"],
    [box(0.08, 0.02, 1.0, 0.15, 0, 0.8), "#5a5a60"],
    ...cart,
    [box(0.6, 0.5, 0.5, -0.9, 0, 0.6), WALL_DARK],
    [roof(0.6, 0.5, 0.3, 0.5, -0.9, 0.6), ROOF_SLATE],
    [box(0.16, 0.14, 0.04, -0.9, 0.25, 0.86), WINDOW],
  ]);
}

function smelter(gold = false): THREE.BufferGeometry {
  return merge([
    [box(1.8, 0.14, 1.4), STONE],
    [box(1.2, 0.9, 1.0, -0.2, 0.14), gold ? "#c9b48a" : "#9a6a55"],
    [roof(1.2, 1.0, 0.5, 1.04, -0.2, 0), gold ? ROOF_RED : ROOF_SLATE],
    [cyl(0.4, 0.5, 1.6, 8, 0.65, 0.14, -0.1), "#8a5a48"],
    [cyl(0.18, 0.22, 0.9, 8, 0.65, 1.74, -0.1), "#5a4a44"],
    [box(0.3, 0.26, 0.05, 0.65, 0.35, 0.39), WINDOW],
    [box(0.28, 0.4, 0.05, -0.2, 0.14, 0.51), TIMBER],
    ...(gold ? [[box(0.22, 0.22, 0.04, -0.6, 0.7, 0.52), "#f0c85a"] as Part] : stonePile(-1.0, 0.6)),
  ]);
}

function toolsmith(): THREE.BufferGeometry {
  return cottage(1.3, 1.0, 0.85, ROOF_SLATE, [
    [box(0.3, 0.2, 0.16, 0.95, 0.2, 0.55), "#3a3a42"],
    [box(0.14, 0.2, 0.12, 0.95, 0, 0.55), "#4a3a30"],
    [box(0.5, 0.35, 0.5, -1.0, 0, 0.3), "#8a5a48"],
    [box(0.3, 0.12, 0.05, -1.0, 0.2, 0.56), WINDOW],
  ]);
}

const cache = new Map<string, THREE.BufferGeometry>();

function lanternPost(): THREE.BufferGeometry {
  const parts: Part[] = [
    [cyl(0.34, 0.42, 0.22, 7), STONE],
    [cyl(0.06, 0.08, 1.35, 6, 0, 0.2), TIMBER],
    [box(0.5, 0.06, 0.06, 0.2, 1.42), TIMBER],
    [box(0.04, 0.16, 0.04, 0.4, 1.28), "#3a3a3a"],
    [box(0.2, 0.24, 0.2, 0.4, 1.02), "#3a3a3a"],
    [box(0.16, 0.2, 0.16, 0.4, 1.04), WINDOW],
    [new THREE.ConeGeometry(0.16, 0.14, 4).rotateY(Math.PI / 4).translate(0.4, 1.33, 0), "#3a3a3a"],
    // A warden's bench and a stack of lamp oil.
    [box(0.5, 0.06, 0.18, -0.35, 0.22, 0.35), TIMBER],
    [box(0.06, 0.22, 0.14, -0.55, 0, 0.35), TIMBER],
    [box(0.06, 0.22, 0.14, -0.15, 0, 0.35), TIMBER],
    [cyl(0.09, 0.09, 0.2, 7, 0.35, 0, -0.35), "#7a5a3a"],
    [cyl(0.09, 0.09, 0.2, 7, 0.5, 0, -0.22), "#7a5a3a"],
  ];
  return merge(parts);
}

function lampHouse(): THREE.BufferGeometry {
  const parts: Part[] = [
    [box(1.0, 0.16, 1.0), STONE],
    [box(0.9, 1.1, 0.9, 0, 0.16), WALL_DARK],
    [box(0.16, 0.22, 0.05, 0, 0.8, 0.46), WINDOW],
    [box(0.3, 0.5, 0.05, 0, 0.16, 0.46), TIMBER],
    [box(1.02, 0.1, 1.02, 0, 1.26), TIMBER],
  ];
  // Lantern room on top: four posts, glass and a pointed roof.
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]] as const) parts.push([box(0.06, 0.42, 0.06, x, 1.36, z), TIMBER]);
  parts.push([box(0.38, 0.34, 0.38, 0, 1.4), WINDOW]);
  parts.push([new THREE.ConeGeometry(0.46, 0.5, 4).rotateY(Math.PI / 4).translate(0, 2.03, 0), ROOF_SLATE]);
  parts.push([cyl(0.02, 0.02, 0.25, 4, 0, 2.25), "#3a3a3a"]);
  return merge(parts);
}

function beacon(): THREE.BufferGeometry {
  const parts: Part[] = [
    [cyl(1.0, 1.15, 0.3, 8), STONE],
    [cyl(0.62, 0.8, 2.6, 8, 0, 0.3), "#c9bca0"],
    [cyl(0.64, 0.64, 0.12, 8, 0, 1.2), STONE],
    [cyl(0.64, 0.64, 0.12, 8, 0, 2.0), STONE],
    [cyl(0.85, 0.7, 0.2, 8, 0, 2.9), STONE],
    [box(0.36, 0.6, 0.06, 0, 0.3, 0.76), TIMBER],
    [box(0.14, 0.24, 0.05, 0.0, 1.5, 0.7), WINDOW],
    [box(0.14, 0.24, 0.05, 0.0, 2.3, -0.66), WINDOW],
    [cyl(0.42, 0.42, 0.62, 8, 0, 3.1), WINDOW],
    [new THREE.ConeGeometry(0.72, 0.8, 8).translate(0, 4.12, 0), "#8a4a3a"],
    [cyl(0.03, 0.03, 0.4, 4, 0, 4.5), "#3a3a3a"],
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push([box(0.07, 0.62, 0.07, Math.cos(a) * 0.5, 3.1, Math.sin(a) * 0.5), "#3a3a3a"]);
    parts.push([box(0.12, 0.16, 0.12, Math.cos(a) * 0.8, 3.1, Math.sin(a) * 0.8), STONE]);
  }
  return merge(parts);
}

/** Where the flame sits in each lantern building, in model space. */
export const LANTERN_FLAME: Record<string, THREE.Vector3> = {
  keep: new THREE.Vector3(0.55, 3.99, 0.9),
  lantern: new THREE.Vector3(0.4, 1.14, 0),
  lamphouse: new THREE.Vector3(0, 1.57, 0),
  beacon: new THREE.Vector3(0, 3.41, 0),
};

export function buildingGeometry(id: string): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    switch (id) {
      case "keep": g = hearthship(); break;
      case "storehouse": g = storehouse(); break;
      case "house": g = house(); break;
      case "woodcutter": g = woodcutter(); break;
      case "forester": g = forester(); break;
      case "quarry": g = quarry(); break;
      case "sawmill": g = sawmill(); break;
      case "farm": g = farm(); break;
      case "mill": g = windmillBody(); break;
      case "bakery": g = bakery(); break;
      case "fisher": g = fisher(); break;
      case "pasture": g = pasture(); break;
      case "butcher": g = butcher(); break;
      case "coalmine": g = mine("coal"); break;
      case "ironmine": g = mine("iron"); break;
      case "goldmine": g = mine("gold"); break;
      case "granitemine": g = mine("granite"); break;
      case "smelter": g = smelter(); break;
      case "goldsmith": g = smelter(true); break;
      case "toolsmith": g = toolsmith(); break;
      case "lantern": g = lanternPost(); break;
      case "lamphouse": g = lampHouse(); break;
      case "beacon": g = beacon(); break;
      default: g = cottage(1.2, 1.0, 0.8, ROOF_RED);
    }
    cache.set(id, g);
  }
  return g;
}

/** Tilled soil under a field. */
export function fieldSoilGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [[box(2.3, 0.05, 2.3), "#6e5034"]];
  for (let i = 0; i < 7; i++) parts.push([box(2.2, 0.03, 0.12, 0, 0.04, -1.0 + i * 0.33), "#5a4028"]);
  return merge(parts);
}

/** Rows of grain; scaled by growth and tinted from green to gold. */
export function fieldRowsGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 7; i++)
    for (let j = 0; j < 9; j++) parts.push([new THREE.ConeGeometry(0.1, 0.4, 4).translate(-1.0 + j * 0.25, 0.2, -1.0 + i * 0.33), "#ffffff"]);
  return merge(parts);
}

export function signpostGeometry(): THREE.BufferGeometry {
  return merge([
    [cyl(0.03, 0.035, 0.7, 5), "#c9b89a"],
    [box(0.3, 0.2, 0.03, 0, 0.55, 0.02), "#ffffff"],
  ]);
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
  // White, so the owner's colour can be applied per instance.
  return tint(g, "#ffffff");
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
