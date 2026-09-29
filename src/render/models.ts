import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as kit from "./kit";

/**
 * Procedural low-poly models. Each part is a primitive with a flat vertex colour; parts are
 * merged into one geometry per model so a building is a single draw call. Units: one tile is
 * about 3.5 wide; a settler is about 0.55 tall.
 */

type Part = kit.Part;

function merge(parts: Part[]): THREE.BufferGeometry {
  return kit.assemble(parts);
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

/** Variation seed of the model being built (set by `buildingGeometry`). */
let variant = 1;
const SHUTTERS = [kit.C.shutterGreen, kit.C.shutterBlue, kit.C.shutterRed] as const;

/** A timber-framed cottage from the building kit: plinth, walls, shingle roof, door, windows. */
function cottage(w: number, d: number, h: number, roofColor: string, extras: Part[] = [], opts: { thatch?: boolean; logs?: boolean } = {}): THREE.BufferGeometry {
  const rng = new kit.Rng(variant * 7919 + Math.round(w * 100));
  const ph = 0.2;
  const rh = h * rng.range(0.75, 0.9);
  const shutter = rng.pick(SHUTTERS);
  const walls = opts.logs ? kit.logWalls(w, d, h, ph, rng) : kit.timberWalls(w, d, h, ph, rng, rng.pick([kit.C.plaster, "#e8dcc0", "#dcc8a6"]));
  const doorX = -w * 0.24;
  const winY = ph + h * 0.5;
  const parts: kit.Part[] = [
    ...kit.plinth(w + 0.12, d + 0.12, ph, rng),
    ...walls,
    ...kit.shingleRoof(w, d, rh, ph + h, kit.jitter(roofColor, rng, 0.6), rng, { thatch: opts.thatch, gable: opts.logs ? kit.C.log : undefined }),
    ...kit.door(doorX, ph, d / 2 + 0.01, rng),
    ...kit.windowPart(w * 0.24, winY, d / 2 + 0.01, rng, shutter),
    ...kit.windowPart(w / 2 + 0.01, winY, 0, rng, shutter, Math.PI / 2),
    ...kit.windowPart(-w / 2 - 0.01, winY, 0, rng, shutter, -Math.PI / 2),
    ...kit.windowPart(0, winY, -d / 2 - 0.01, rng, shutter, Math.PI),
    ...kit.chimney(w * 0.28, -d * 0.2, ph + h + rh * 0.44 + 0.22, ph + h * 0.5, rng),
    ...extras,
  ];
  return kit.assemble(parts);
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
  const rng = new kit.Rng(variant * 53 + 11);
  const ph = 0.18;
  const parts: Part[] = [];
  // Workshop on the left.
  const w = 1.1;
  const d = 1.0;
  const h = 0.75;
  const bx = -0.55;
  const shift = (ps: Part[], x: number, z = 0) => ps.map(([g, c]) => [g.translate(x, 0, z), c] as Part);
  parts.push(
    ...shift(kit.plinth(w + 0.1, d + 0.1, ph, rng), bx),
    ...shift(kit.timberWalls(w, d, h, ph, rng), bx),
    ...shift(kit.shingleRoof(w, d, 0.55, ph + h, kit.jitter(ROOF_RED, rng, 0.6), rng), bx),
    ...shift(kit.door(0, ph, d / 2 + 0.01, rng), bx - 0.2),
    ...shift(kit.windowPart(0, ph + 0.38, d / 2 + 0.01, rng, kit.C.shutterGreen), bx + 0.28),
    ...shift(kit.windowPart(0, ph + 0.38, 0, rng, kit.C.shutterGreen, -Math.PI / 2), bx - w / 2 - 0.01),
  );
  // Open saw shed on the right: posts, a lean-to roof, the frame saw and a log on its carriage.
  const sx = 0.72;
  parts.push([kit.box(1.0, 0.08, 1.0, sx, 0), kit.C.stoneDark]);
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) {
    const hh = x < 0 ? 1.05 : 0.8;
    parts.push([kit.box(0.08, hh, 0.08, sx + x, 0.08, z), kit.C.timber]);
  }
  const lean = new THREE.BoxGeometry(1.2, 0.04, 1.2).rotateZ(-Math.atan2(0.25, 0.9)).translate(sx, 0.08 + 0.95, 0);
  parts.push([lean, kit.jitter("#8a6444", rng)]);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(1.2, 0.03, 0.2).rotateZ(-Math.atan2(0.25, 0.9)).translate(sx, 0.08 + 0.985 + 0.004 * i, -0.5 + i * 0.2);
    parts.push([g, kit.jitter("#9a7250", rng, 2)]);
  }
  // Frame saw: two uprights, crossbars and the blade.
  parts.push(
    [kit.box(0.06, 0.85, 0.06, sx - 0.05, 0.08, -0.22), kit.C.timberLight],
    [kit.box(0.06, 0.85, 0.06, sx - 0.05, 0.08, 0.22), kit.C.timberLight],
    [kit.box(0.06, 0.06, 0.5, sx - 0.05, 0.86, 0), kit.C.timberLight],
    [kit.box(0.06, 0.06, 0.5, sx - 0.05, 0.5, 0), kit.C.timberLight],
    [kit.box(0.015, 0.36, 0.1, sx - 0.05, 0.5, 0), "#c9c9cf"],
  );
  // Rails and a log on the carriage passing through the saw.
  parts.push([kit.box(0.9, 0.04, 0.05, sx, 0.08, -0.12), "#4a3a2e"], [kit.box(0.9, 0.04, 0.05, sx, 0.08, 0.12), "#4a3a2e"]);
  parts.push(...kit.log(0.95, 0.11, sx + 0.1, 0.13, 0));
  // Sawdust heap, log stack behind, planks in front.
  parts.push([new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(sx + 0.15, 0.08, 0.3), "#d9b98a"]);
  parts.push(...kit.logStack(0.2, -0.95, 3, 0.9, rng));
  parts.push(...kit.plankStack(0.5, 0.95, 4, rng), ...kit.plankStack(-0.25, 0.9, 2, rng, 0.1));
  parts.push(...kit.barrel(-1.25, 0.55, rng));
  return kit.assemble(parts);
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
  const rng = new kit.Rng(variant * 31 + 5);
  const w = 1.1;
  const d = 0.95;
  const parts: Part[] = [...kit.flowerBox(w * 0.24, 0.52, d / 2 + 0.07, rng)];
  // A garden fence to the side, a bush, and a washing line on some cottages.
  for (let i = 0; i < 6; i++) parts.push([kit.box(0.04, 0.24, 0.04, 0.72 + (i % 3) * 0.2, 0, 0.6 - Math.floor(i / 3) * 0.9), "#d8cbb0"]);
  parts.push([kit.box(0.04, 0.03, 0.94, 0.72, 0.17, 0.15), "#d8cbb0"], [kit.box(0.04, 0.03, 0.94, 1.12, 0.17, 0.15), "#d8cbb0"]);
  parts.push([new THREE.IcosahedronGeometry(0.2, 1).translate(0.92, 0.16, 0.3), kit.jitter("#5f8f45", rng, 2)]);
  parts.push([new THREE.IcosahedronGeometry(0.14, 1).translate(0.95, 0.12, -0.1), kit.jitter("#6f9a4a", rng, 2)]);
  if (rng.next() < 0.6) {
    parts.push([kit.cyl(0.02, 0.02, 0.6, 5, -0.95, 0, 0.75), kit.C.timber], [kit.cyl(0.02, 0.02, 0.6, 5, -0.95, 0, -0.35), kit.C.timber]);
    parts.push([kit.box(0.01, 0.01, 1.1, -0.95, 0.57, 0.2), kit.C.rope]);
    for (let i = 0; i < 3; i++) parts.push([kit.box(0.02, 0.2, 0.18, -0.95, 0.37, 0.55 - i * 0.3), rng.pick(["#e8e0d0", "#8aa6c8", "#c87a6a", "#e0c86a"])]);
  }
  const thatch = rng.next() < 0.35;
  return cottage(w, d, 0.8, thatch ? kit.C.roofThatch : rng.pick([ROOF_RED, "#7a6a9a", ROOF_SLATE, "#9a6a3a"]), parts, { thatch });
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
  const rng = new kit.Rng(variant * 71 + 3);
  const parts: Part[] = [];
  // A jetty of planks on posts running out in front, with a boat tied alongside.
  const jx = 0.95;
  for (let i = 0; i < 8; i++) parts.push([kit.box(0.5, 0.035, 0.13, jx, 0.2 + rng.range(-0.01, 0.01), 0.1 + i * 0.14, rng.range(-0.04, 0.04)), kit.jitter("#9a7a55", rng, 2)]);
  for (const z of [0.15, 0.6, 1.1]) for (const x of [-0.22, 0.22]) parts.push([kit.cyl(0.035, 0.04, 0.34, 6, jx + x, -0.12, z), kit.C.timber]);
  // A small rowing boat on the bank beside the jetty: a hull bowl with a thwart and an oar.
  const hull = new THREE.SphereGeometry(0.2, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.8, 0.6, 2.3).translate(jx + 0.5, 0.12, 0.7);
  parts.push([hull, "#6a4a3a"], [kit.box(0.28, 0.025, 0.07, jx + 0.5, 0.1, 0.7), "#8a6a4a"]);
  parts.push([kit.box(0.025, 0.025, 0.6, jx + 0.55, 0.13, 0.65, 0.15), kit.C.timberLight]);
  // Net drying rack and fish-drying poles.
  parts.push([kit.cyl(0.025, 0.025, 0.8, 5, -0.95, 0, 0.55), kit.C.timber], [kit.cyl(0.025, 0.025, 0.8, 5, -0.95, 0, -0.35), kit.C.timber]);
  parts.push([kit.box(0.02, 0.02, 0.95, -0.95, 0.78, 0.1), kit.C.timber]);
  for (let i = 0; i < 5; i++) parts.push([kit.box(0.01, 0.5, 0.012, -0.95, 0.26, -0.27 + i * 0.18), "#a89a7a"]);
  for (let i = 0; i < 4; i++) parts.push([kit.box(0.01, 0.012, 0.8, -0.95, 0.3 + i * 0.13, 0.1), "#a89a7a"]);
  for (let i = 0; i < 3; i++) parts.push([new THREE.SphereGeometry(0.03, 6, 4).translate(-0.95, 0.76, -0.2 + i * 0.3), "#d8583a"]);
  for (let i = 0; i < 4; i++) parts.push([kit.box(0.03, 0.12, 0.06, -0.72, 0.42, 0.45 - i * 0.12), "#b8c4c8"]);
  parts.push([kit.box(0.02, 0.02, 0.5, -0.72, 0.5, 0.27), kit.C.timber]);
  parts.push(...kit.barrel(0.62, 0.62, rng), ...kit.barrel(0.62, 0.38, rng, 0.2), ...kit.crate(-0.55, 0.72, rng, 0.18));
  return cottage(1.0, 0.9, 0.72, ROOF_SLATE, parts, { logs: rng.next() < 0.5 });
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

/** Distinct looks per building kind (seeded variations of the same model). */
export const VARIANTS = 4;

export function buildingGeometry(id: string, v = 0): THREE.BufferGeometry {
  const key = `${id}:${v % VARIANTS}`;
  let g = cache.get(key);
  if (!g) {
    variant = (v % VARIANTS) + 1;
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
    cache.set(key, g);
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

/**
 * Soft foliage: each lump's normals lean outward from the crown's centre (so the whole crown
 * shades like one soft, painted form) and its colour darkens toward the crown's inside and base.
 */
function foliage(g: THREE.BufferGeometry, centre: THREE.Vector3, colour: THREE.Color, soft = 0.7): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const p = geo.getAttribute("position");
  const n = geo.getAttribute("normal");
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    o.copy(v).sub(centre).normalize();
    const nx = n.getX(i) * (1 - soft) + o.x * soft;
    const ny = n.getY(i) * (1 - soft) + o.y * soft;
    const nz = n.getZ(i) * (1 - soft) + o.z * soft;
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
    const k = 0.62 + 0.38 * (o.y * 0.5 + 0.5);
    col.set([colour.r * k, colour.g * k, colour.b * k], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return [geo, colour];
}

/** Merge parts whose colours and normals are already baked (foliage) with plain ones. */
function mergeBaked(plain: Part[], baked: Part[]): THREE.BufferGeometry {
  const a = kit.assemble(plain, true);
  const geos = [a, ...baked.map(([g]) => g)].map((g) => {
    g.deleteAttribute("uv");
    return g;
  });
  return mergeGeometries(geos);
}

export function coniferGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(17);
  const trunk: Part[] = [[cyl(0.06, 0.1, 0.6, 7), "#5f4230"]];
  const tiers: Part[] = [];
  const centre = new THREE.Vector3(0, 1.3, 0);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const r = 0.66 - f * 0.46;
    const h = 0.62 - f * 0.18;
    const y = 0.45 + f * 1.35;
    const cone = new THREE.ConeGeometry(r, h, 11, 2);
    // Droop the lower rim and ruffle it, so tiers read as boughs rather than cones.
    const p = cone.getAttribute("position");
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      if (yy < -h / 2 + 0.01) {
        const a = Math.atan2(p.getZ(k), p.getX(k));
        const w = 1 + Math.sin(a * 5 + i) * 0.09;
        p.setXYZ(k, p.getX(k) * w, yy - 0.06 * w, p.getZ(k) * w);
      }
    }
    cone.rotateY(rng.range(0, Math.PI));
    const c = kit.jitter("#3f6b45", rng, 0.8).offsetHSL(0, 0, f * 0.05);
    tiers.push(foliage(cone.translate(0, y + h / 2, 0), centre, c, 0.45));
  }
  return mergeBaked(trunk, tiers);
}

export function broadleafGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(29);
  const trunk: Part[] = [
    [cyl(0.07, 0.12, 0.95, 7), "#6e5038"],
    [cyl(0.035, 0.05, 0.45, 5).rotateZ(-0.7).translate(0.05, 0.6, 0), "#6e5038"],
    [cyl(0.03, 0.045, 0.4, 5).rotateZ(0.8).rotateY(1.2).translate(-0.03, 0.65, 0.02), "#6e5038"],
  ];
  const centre = new THREE.Vector3(0, 1.2, 0);
  const lumps: [number, number, number, number][] = [[0, 1.25, 0, 0.5], [0, 1.6, 0.05, 0.36]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const rr = rng.range(0.34, 0.44);
    lumps.push([Math.cos(a) * rr, rng.range(0.98, 1.42), Math.sin(a) * rr, rng.range(0.27, 0.36)]);
  }
  const leaves: Part[] = lumps.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.getAttribute("position");
    // Slightly lumpy, flattened underneath.
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      const w = 1 + Math.sin(p.getX(k) * 17 + p.getZ(k) * 13) * 0.06;
      p.setXYZ(k, p.getX(k) * w, (yy < 0 ? yy * 0.72 : yy) * w, p.getZ(k) * w);
    }
    return foliage(g.translate(x, y, z), centre, kit.jitter("#5f8f45", rng, 1.2), 0.72);
  });
  return mergeBaked(trunk, leaves);
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
  return kit.assemble([[g, "#ffffff"]], false);
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

/** Goods miniatures (about 0.2 across, resting on y = 0): what carriers haul and flags hold. */
export function goodGeometry(id: string): THREE.BufferGeometry {
  const key = `good:${id}`;
  let g = cache.get(key);
  if (g) return g;
  const rng = new kit.Rng(id.length * 97 + id.charCodeAt(0));
  const lumps = (c: string, n = 4, r = 0.065): Part[] => {
    const out: Part[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * rng.range(0.8, 1.15);
      out.push([new THREE.DodecahedronGeometry(rr, 0).translate(Math.cos(a) * 0.06, rr * 0.8 + (i === n - 1 ? 0.05 : 0), Math.sin(a) * 0.06), kit.jitter(c, rng, 1.5)]);
    }
    return out;
  };
  const sack = (c: string): Part[] => [
    [new THREE.SphereGeometry(0.1, 9, 7).scale(1, 1.05, 0.8).translate(0, 0.1, 0), c],
    [kit.cyl(0.035, 0.05, 0.05, 8, 0, 0.19), c],
    [kit.cyl(0.037, 0.037, 0.012, 8, 0, 0.2), "#8a6a44"],
  ];
  const basket = (fill: Part[]): Part[] => [[kit.cyl(0.1, 0.08, 0.09, 10), "#a8844e"], [kit.cyl(0.103, 0.103, 0.015, 10, 0, 0.08), "#8a6a3e"], ...fill];
  const bars = (c: string): Part[] => {
    const out: Part[] = [];
    for (let i = 0; i < 3; i++) out.push([kit.box(0.14, 0.045, 0.06, 0, i < 2 ? 0 : 0.045, i < 2 ? (i - 0.5) * 0.065 : 0, i < 2 ? 0 : Math.PI / 2), c]);
    return out;
  };
  let parts: Part[];
  switch (id) {
    case "log":
      parts = [...kit.log(0.3, 0.05, 0, 0, -0.05), ...kit.log(0.3, 0.05, 0, 0, 0.05), ...kit.log(0.3, 0.05, 0, 0.085, 0), [kit.box(0.02, 0.2, 0.2, 0, 0, 0), "#6a5238"]];
      break;
    case "plank":
      parts = kit.plankStack(0, 0, 2, rng).map(([g2, c]) => [g2.scale(0.34, 1.1, 0.6), c] as Part);
      break;
    case "stone":
      parts = lumps("#a9a59d");
      break;
    case "coal":
      parts = basket(lumps("#2e2e34", 4, 0.045).map(([g2, c]) => [g2.translate(0, 0.05, 0), c] as Part));
      break;
    case "ironore":
      parts = lumps("#a0583f", 4, 0.055);
      break;
    case "goldore":
      parts = lumps("#c9a24a", 4, 0.055);
      break;
    case "grain":
      parts = sack("#e2c46e");
      break;
    case "flour":
      parts = sack("#f1e6cc");
      break;
    case "bread":
      parts = basket([0, 1, 2].map((i) => [new THREE.SphereGeometry(0.045, 8, 5).scale(1.4, 0.8, 1).translate((i - 1) * 0.06, 0.1, (i % 2) * 0.03), "#d98f4e"] as Part));
      break;
    case "fish":
      parts = basket([0, 1, 2].map((i) => [new THREE.SphereGeometry(0.03, 6, 4).scale(3, 0.8, 1).rotateY(i * 0.9).translate(0, 0.095 + i * 0.012, 0), "#7fc4c8"] as Part));
      break;
    case "meat":
      parts = [[new THREE.SphereGeometry(0.075, 8, 6).scale(1.3, 0.9, 1).translate(0, 0.07, 0), "#b8574a"], [kit.cyl(0.018, 0.018, 0.08, 6).rotateZ(Math.PI / 2).translate(0.12, 0.07, 0), "#efe6d2"]];
      break;
    case "livestock":
      parts = [
        [new THREE.SphereGeometry(0.08, 8, 6).scale(1.4, 1, 1).translate(0, 0.1, 0), "#f0ece2"],
        [new THREE.SphereGeometry(0.04, 7, 5).translate(0.12, 0.13, 0), "#3a3430"],
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [kit.box(0.02, 0.05, 0.02, sx * 0.06, 0, sz * 0.04), "#3a3430"] as Part)),
      ];
      break;
    case "iron":
      parts = bars("#8f96a3");
      break;
    case "gold":
      parts = bars("#f0c85a");
      break;
    case "blade":
      parts = [[kit.box(0.03, 0.012, 0.3, 0, 0.02, 0), "#dde3ea"], [kit.box(0.09, 0.02, 0.02, 0, 0.02, -0.12), "#c9a24a"], [kit.box(0.03, 0.012, 0.3, 0.05, 0.035, 0.01, 0.1), "#dde3ea"]];
      break;
    case "bow":
      parts = [[new THREE.TorusGeometry(0.14, 0.012, 4, 12, Math.PI).rotateX(Math.PI / 2).translate(0, 0.02, 0), "#8a5a2b"], [kit.box(0.28, 0.006, 0.006, 0, 0.02, 0), "#e8e0d0"]];
      break;
    case "mount":
      parts = [[kit.box(0.18, 0.06, 0.14, 0, 0, 0), "#7a5236"], [kit.box(0.04, 0.05, 0.14, 0.07, 0.05, 0), "#6a4428"], [kit.box(0.04, 0.035, 0.14, -0.07, 0.05, 0), "#6a4428"]];
      break;
    default:
      parts = kit.crate(0, 0, rng, 0.16);
  }
  g = kit.assemble(parts, false);
  cache.set(key, g);
  return g;
}
