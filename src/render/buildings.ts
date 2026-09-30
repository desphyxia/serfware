import * as THREE from "three/webgpu";
import * as kit from "./kit";
import type { Part } from "./kit";

/**
 * Every building, built from the kit (see kit.ts). Each has a signature element for its trade,
 * seeded variation (hue, roof, shutters, props) per variant, a pennant or banner in the owner's
 * colour, and records where its chimney smoke, lantern flame or windmill hub sits.
 * Front (door, flag side) is +Z.
 */

export interface BuildingMeta {
  /** Top of the chimney, for smoke. */
  chimney?: THREE.Vector3;
  /** Lantern flame, for light and glow. */
  flame?: THREE.Vector3;
  /** Windmill sail hub. */
  hub?: THREE.Vector3;
  /** Footprint (x/z half-sizes) and height, for scaffolding and construction. */
  size: THREE.Vector3;
}

const ROOF = { red: "#a8513c", slate: "#56657a", moss: "#6b7d4a", brown: "#8a5a3a", purple: "#7a6a9a" } as const;
const SHUTTERS = [kit.C.shutterGreen, kit.C.shutterBlue, kit.C.shutterRed] as const;
const PLASTERS = [kit.C.plaster, "#e8dcc0", "#dcc8a6", "#e6d0b8"] as const;

class Build {
  readonly parts: Part[] = [];
  readonly meta: BuildingMeta = { size: new THREE.Vector3() };
  constructor(readonly rng: kit.Rng) {}
  add(...ps: Part[]): this {
    this.parts.push(...ps);
    return this;
  }
  /** Add parts moved (and turned about Y) as a group. */
  place(ps: Part[], x: number, z: number, ry = 0, y = 0): this {
    for (const [g, c] of ps) {
      if (ry) g.rotateY(ry);
      this.parts.push([g.translate(x, y, z), c]);
    }
    return this;
  }
}

/** Move a point the same way `place` moves parts. */
function moved(p: THREE.Vector3, x: number, z: number, ry = 0, y = 0): THREE.Vector3 {
  return p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(x, y, z));
}

interface CottageOpts {
  roof?: string;
  thatch?: boolean;
  logs?: boolean;
  stone?: boolean;
  chimney?: boolean;
  /** Door offset along the front (fraction of width). */
  doorAt?: number;
}

/** A cottage: plinth, walls, roof, door, windows and chimney. Returns its parts and chimney top. */
function cottage(rng: kit.Rng, w: number, d: number, h: number, o: CottageOpts = {}): { parts: Part[]; chimney: THREE.Vector3 | undefined; top: number } {
  const ph = 0.2;
  const rh = h * rng.range(0.75, 0.9);
  const shutter = rng.pick(SHUTTERS);
  const walls = o.stone ? kit.stoneWalls(w, d, h, ph, rng) : o.logs ? kit.logWalls(w, d, h, ph, rng) : kit.timberWalls(w, d, h, ph, rng, rng.pick(PLASTERS));
  const roofColour = o.thatch ? kit.C.roofThatch : (o.roof ?? rng.pick([ROOF.red, ROOF.slate, ROOF.brown]));
  const doorX = -w * (o.doorAt ?? 0.24);
  const winY = ph + h * 0.5;
  const parts: Part[] = [
    ...kit.plinth(w + 0.12, d + 0.12, ph, rng),
    ...walls,
    ...kit.shingleRoof(w, d, rh, ph + h, kit.jitter(roofColour, rng, 0.6), rng, { thatch: o.thatch, gable: o.logs ? kit.C.log : o.stone ? kit.C.stone : undefined }),
    ...kit.door(doorX, ph, d / 2 + 0.01, rng),
    ...kit.windowPart(w * 0.24, winY, d / 2 + 0.01, rng, shutter),
    ...kit.windowPart(w / 2 + 0.01, winY, 0, rng, shutter, Math.PI / 2),
    ...kit.windowPart(-w / 2 - 0.01, winY, 0, rng, shutter, -Math.PI / 2),
    ...kit.windowPart(0, winY, -d / 2 - 0.01, rng, shutter, Math.PI),
  ];
  let chimney: THREE.Vector3 | undefined;
  if (o.chimney !== false) {
    const top = ph + h + rh * 0.44 + 0.22;
    parts.push(...kit.chimney(w * 0.28, -d * 0.2, top, ph + h * 0.5, rng));
    chimney = new THREE.Vector3(w * 0.28, top + 0.08, -d * 0.2);
  }
  return { parts, chimney, top: ph + h + rh };
}

// ---------------------------------------------------------------------------------------------

function house(b: Build): void {
  const { rng } = b;
  const w = 1.1;
  const d = 0.95;
  const thatch = rng.next() < 0.35;
  const c = cottage(rng, w, d, 0.8, { thatch, roof: rng.pick([ROOF.red, ROOF.purple, ROOF.slate, ROOF.brown]) });
  b.add(...c.parts, ...kit.flowerBox(w * 0.24, 0.52, d / 2 + 0.07, rng));
  b.meta.chimney = c.chimney;
  for (let i = 0; i < 6; i++) b.add([kit.box(0.04, 0.24, 0.04, 0.72 + (i % 3) * 0.2, 0, 0.6 - Math.floor(i / 3) * 0.9), "#d8cbb0"]);
  b.add([kit.box(0.04, 0.03, 0.94, 0.72, 0.17, 0.15), "#d8cbb0"], [kit.box(0.04, 0.03, 0.94, 1.12, 0.17, 0.15), "#d8cbb0"]);
  b.add([new THREE.IcosahedronGeometry(0.2, 1).translate(0.92, 0.16, 0.3), kit.jitter("#5f8f45", rng, 2)]);
  b.add([new THREE.IcosahedronGeometry(0.14, 1).translate(0.95, 0.12, -0.1), kit.jitter("#6f9a4a", rng, 2)]);
  if (rng.next() < 0.6) {
    b.add([kit.cyl(0.02, 0.02, 0.6, 5, -0.95, 0, 0.75), kit.C.timber], [kit.cyl(0.02, 0.02, 0.6, 5, -0.95, 0, -0.35), kit.C.timber]);
    b.add([kit.box(0.01, 0.01, 1.1, -0.95, 0.57, 0.2), kit.C.rope]);
    for (let i = 0; i < 3; i++) b.add([kit.box(0.02, 0.2, 0.18, -0.95, 0.37, 0.55 - i * 0.3), rng.pick(["#e8e0d0", "#8aa6c8", "#c87a6a", "#e0c86a"])]);
  }
  b.add(...kit.pennant(-w / 2 + 0.06, c.top - 0.05, 0, 0.35));
}

function woodcutter(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.2, 1.0, 0.78, { logs: true, roof: ROOF.moss });
  b.add(...c.parts);
  b.meta.chimney = c.chimney;
  b.add(...kit.logStack(-1.05, 0.1, 3, 0.8, rng, Math.PI / 2));
  // Chopping block with an axe in it, and a pile of split wood.
  b.add([kit.cyl(0.17, 0.2, 0.28, 9, 0.85, 0, 0.6), "#9b6b45"], [kit.cyl(0.16, 0.16, 0.012, 9, 0.85, 0.28, 0.6), kit.C.logEnd]);
  b.add([kit.box(0.03, 0.34, 0.03, 0.85, 0.34, 0.6).rotateZ(0.35).translate(0.12, -0.05, 0), kit.C.timberLight], [kit.box(0.02, 0.06, 0.1, 0.85, 0.3, 0.6), "#b8bec8"]);
  for (let i = 0; i < 5; i++) b.add([kit.box(0.26, 0.05, 0.06, 0.55 + rng.range(-0.1, 0.1), 0.05 * i, 0.85 + rng.range(-0.05, 0.05), rng.range(-0.3, 0.3)), kit.jitter(kit.C.logEnd, rng)]);
  b.add(...kit.pennant(0.55, 0, -0.75, 0.9));
}

function forester(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.1, 1.0, 0.82, { roof: ROOF.red });
  b.add(...c.parts);
  b.meta.chimney = c.chimney;
  // A nursery bed of saplings in a little fence, and pots by the door.
  for (let i = 0; i < 6; i++) {
    const x = -1.0 + (i % 3) * 0.24;
    const z = 0.45 + Math.floor(i / 3) * 0.3;
    b.add([kit.cyl(0.006, 0.01, 0.12, 4, x, 0.02, z), kit.C.timber], [new THREE.ConeGeometry(0.07 + rng.range(0, 0.04), 0.2, 6).translate(x, 0.2, z), kit.jitter("#4f7d56", rng, 1.5)]);
  }
  b.add([kit.box(0.8, 0.05, 0.7, -0.76, 0, 0.6), "#6e5034"]);
  for (const z of [0.25, 0.95]) b.add([kit.box(0.82, 0.03, 0.02, -0.76, 0.14, z), "#d8cbb0"]);
  for (let i = 0; i < 3; i++) b.add([kit.cyl(0.07, 0.05, 0.1, 7, 0.75 + i * 0.16, 0, 0.62), "#b0603a"], [new THREE.IcosahedronGeometry(0.07, 0).translate(0.75 + i * 0.16, 0.15, 0.62), "#5f8f45"]);
  b.add([kit.cyl(0.012, 0.012, 0.5, 4, 0.95, 0, -0.15).rotateZ(0.2), kit.C.timberLight], [kit.box(0.08, 0.1, 0.012, 1.04, 0.02, -0.15), "#8a8e96"]);
  b.add(...kit.pennant(-0.62, c.top - 0.1, -0.1, 0.35));
}

function quarry(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.0, 0.85, 0.7, { stone: true, roof: ROOF.slate });
  b.place(c.parts, 0.35, -0.3);
  if (c.chimney) b.meta.chimney = moved(c.chimney, 0.35, -0.3);
  // Cut blocks and rubble, and a timber crane lifting a block.
  for (let i = 0; i < 6; i++) b.add([kit.box(0.28, 0.18, 0.2, -0.85 + (i % 3) * 0.3, Math.floor(i / 3) * 0.18, 0.55, rng.range(-0.1, 0.1)), kit.jitter("#b3ab9d", rng, 2)]);
  for (let i = 0; i < 5; i++) b.add([new THREE.DodecahedronGeometry(rng.range(0.07, 0.14), 0).translate(-0.4 + rng.range(-0.3, 0.3), 0.06, 0.95 + rng.range(-0.1, 0.1)), kit.jitter(kit.C.stone, rng, 2)]);
  const cx = -0.85;
  const cz = -0.45;
  b.add([kit.box(0.07, 1.4, 0.07, cx - 0.15, 0, cz).rotateZ(0.1).translate(0, 0, 0), kit.C.timber], [kit.box(0.07, 1.4, 0.07, cx + 0.15, 0, cz).rotateZ(-0.1), kit.C.timber]);
  b.add([kit.box(0.08, 0.06, 1.1, cx, 1.33, cz + 0.3), kit.C.timber], [kit.box(0.01, 0.55, 0.01, cx, 0.78, cz + 0.8), kit.C.rope], [kit.box(0.22, 0.16, 0.18, cx, 0.62, cz + 0.8), "#b3ab9d"]);
  b.add(...kit.pennant(cx, 1.36, cz, 0.35));
}

function sawmill(b: Build): void {
  const { rng } = b;
  const ph = 0.18;
  const w = 1.1;
  const d = 1.0;
  const h = 0.75;
  const bx = -0.55;
  b.place(kit.plinth(w + 0.1, d + 0.1, ph, rng), bx, 0);
  b.place(kit.timberWalls(w, d, h, ph, rng, rng.pick(PLASTERS)), bx, 0);
  b.place(kit.shingleRoof(w, d, 0.55, ph + h, kit.jitter(rng.pick([ROOF.red, ROOF.brown]), rng, 0.6), rng), bx, 0);
  b.place(kit.door(0, ph, d / 2 + 0.01, rng), bx - 0.2, 0);
  b.place(kit.windowPart(0, ph + 0.38, d / 2 + 0.01, rng, kit.C.shutterGreen), bx + 0.28, 0);
  b.place(kit.windowPart(0, ph + 0.38, 0, rng, kit.C.shutterGreen, -Math.PI / 2), bx - w / 2 - 0.01, 0);
  const sx = 0.72;
  b.add([kit.box(1.0, 0.08, 1.0, sx, 0), kit.C.stoneDark]);
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) b.add([kit.box(0.08, x < 0 ? 1.05 : 0.8, 0.08, sx + x, 0.08, z), kit.C.timber]);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(1.2, 0.03, 0.2).rotateZ(-Math.atan2(0.25, 0.9)).translate(sx, 0.08 + 0.985 + 0.004 * i, -0.5 + i * 0.2);
    b.add([g, kit.jitter("#9a7250", rng, 2)]);
  }
  b.add(
    [kit.box(0.06, 0.85, 0.06, sx - 0.05, 0.08, -0.22), kit.C.timberLight],
    [kit.box(0.06, 0.85, 0.06, sx - 0.05, 0.08, 0.22), kit.C.timberLight],
    [kit.box(0.06, 0.06, 0.5, sx - 0.05, 0.86, 0), kit.C.timberLight],
    [kit.box(0.06, 0.06, 0.5, sx - 0.05, 0.5, 0), kit.C.timberLight],
    [kit.box(0.015, 0.36, 0.1, sx - 0.05, 0.5, 0), "#c9c9cf"],
    [kit.box(0.9, 0.04, 0.05, sx, 0.08, -0.12), "#4a3a2e"],
    [kit.box(0.9, 0.04, 0.05, sx, 0.08, 0.12), "#4a3a2e"],
    ...kit.log(0.95, 0.11, sx + 0.1, 0.13, 0),
    [new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(sx + 0.15, 0.08, 0.3), "#d9b98a"],
  );
  b.add(...kit.logStack(0.2, -0.95, 3, 0.9, rng), ...kit.plankStack(0.5, 0.95, 4, rng), ...kit.plankStack(-0.25, 0.9, 2, rng, 0.1), ...kit.barrel(-1.25, 0.55, rng));
  b.add(...kit.pennant(sx - 0.45, 1.13, -0.45, 0.35));
}

function fisher(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.0, 0.9, 0.72, { logs: rng.next() < 0.5, roof: ROOF.slate });
  b.add(...c.parts);
  b.meta.chimney = c.chimney;
  const jx = 0.95;
  for (let i = 0; i < 8; i++) b.add([kit.box(0.5, 0.035, 0.13, jx, 0.2 + rng.range(-0.01, 0.01), 0.1 + i * 0.14, rng.range(-0.04, 0.04)), kit.jitter("#9a7a55", rng, 2)]);
  for (const z of [0.15, 0.6, 1.1]) for (const x of [-0.22, 0.22]) b.add([kit.cyl(0.035, 0.04, 0.34, 6, jx + x, -0.12, z), kit.C.timber]);
  const hull = new THREE.SphereGeometry(0.2, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.8, 0.6, 2.3).translate(jx + 0.5, 0.12, 0.7);
  b.add([hull, "#6a4a3a"], [kit.box(0.28, 0.025, 0.07, jx + 0.5, 0.1, 0.7), "#8a6a4a"], [kit.box(0.025, 0.025, 0.6, jx + 0.55, 0.13, 0.65, 0.15), kit.C.timberLight]);
  b.add([kit.cyl(0.025, 0.025, 0.8, 5, -0.95, 0, 0.55), kit.C.timber], [kit.cyl(0.025, 0.025, 0.8, 5, -0.95, 0, -0.35), kit.C.timber], [kit.box(0.02, 0.02, 0.95, -0.95, 0.78, 0.1), kit.C.timber]);
  for (let i = 0; i < 5; i++) b.add([kit.box(0.01, 0.5, 0.012, -0.95, 0.26, -0.27 + i * 0.18), "#a89a7a"]);
  for (let i = 0; i < 4; i++) b.add([kit.box(0.01, 0.012, 0.8, -0.95, 0.3 + i * 0.13, 0.1), "#a89a7a"]);
  for (let i = 0; i < 3; i++) b.add([new THREE.SphereGeometry(0.03, 6, 4).translate(-0.95, 0.76, -0.2 + i * 0.3), "#d8583a"]);
  for (let i = 0; i < 4; i++) b.add([kit.box(0.03, 0.12, 0.06, -0.72, 0.42, 0.45 - i * 0.12), "#b8c4c8"]);
  b.add([kit.box(0.02, 0.02, 0.5, -0.72, 0.5, 0.27), kit.C.timber], ...kit.barrel(0.62, 0.62, rng), ...kit.barrel(0.62, 0.38, rng, 0.2), ...kit.crate(-0.55, 0.72, rng, 0.18));
  b.add(...kit.pennant(jx + 0.22, 0.2, 1.12, 0.55));
}

function bakery(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.2, 1.0, 0.8, { roof: ROOF.red, doorAt: 0.3, chimney: false });
  b.add(...c.parts);
  // Signature: a domed bread oven of brick against the side wall, with its own flue.
  const ox = 0.9;
  const oz = -0.05;
  b.add([kit.box(0.7, 0.2, 0.7, ox, 0, oz), kit.C.stoneDark]);
  for (let ring = 0; ring < 4; ring++) {
    const r = 0.34 * Math.cos((ring / 4) * Math.PI * 0.5);
    const y = 0.2 + 0.34 * Math.sin((ring / 4) * Math.PI * 0.5);
    b.add([new THREE.TorusGeometry(Math.max(0.05, r), 0.05, 5, 14).rotateX(Math.PI / 2).translate(ox, y, oz), kit.jitter("#b86a4a", rng, 2)]);
  }
  b.add([new THREE.SphereGeometry(0.31, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(ox, 0.2, oz), "#a85e40"]);
  b.add([kit.box(0.16, 0.14, 0.05, ox, 0.22, oz + 0.3), kit.C.window]);
  b.add(...kit.chimney(ox + 0.12, oz - 0.12, 1.0, 0.35, rng));
  b.meta.chimney = new THREE.Vector3(ox + 0.12, 1.08, oz - 0.12);
  // Bread on a bench by the door, flour sacks.
  b.add([kit.box(0.5, 0.05, 0.2, -0.85, 0.28, 0.55), kit.C.timber], [kit.box(0.05, 0.28, 0.16, -1.05, 0, 0.55), kit.C.timber], [kit.box(0.05, 0.28, 0.16, -0.65, 0, 0.55), kit.C.timber]);
  for (let i = 0; i < 3; i++) b.add([new THREE.SphereGeometry(0.05, 8, 5).scale(1.4, 0.8, 1).translate(-1.0 + i * 0.14, 0.36, 0.55), "#d98f4e"]);
  b.add(...kit.sack(-0.95, -0.7, rng, "#f1e6cc"), ...kit.sack(-0.78, -0.72, rng, "#f1e6cc"));
  b.add(...kit.banner(-0.36 * 1.2 + 0.25, 0.95, 0.51, 0.18, 0.3));
}

function butcher(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.1, 1.0, 0.8, { roof: rng.pick([ROOF.red, ROOF.brown]) });
  b.add(...c.parts);
  b.meta.chimney = c.chimney;
  // Signature: a small smokehouse and a rack of hams under a lean-to.
  const sx = -0.95;
  b.add(...kit.plinth(0.5, 0.5, 0.12, rng).map(([g, col]) => [g.translate(sx, 0, -0.35), col] as Part));
  b.add(...kit.logWalls(0.4, 0.4, 0.5, 0.12, rng).map(([g, col]) => [g.translate(sx, 0, -0.35), col] as Part));
  b.add(...kit.shingleRoof(0.4, 0.4, 0.25, 0.62, kit.C.roofSlate, rng).map(([g, col]) => [g.translate(sx, 0, -0.35), col] as Part));
  b.add([kit.cyl(0.025, 0.025, 0.7, 5, 0.85, 0, 0.4), kit.C.timber], [kit.cyl(0.025, 0.025, 0.7, 5, 0.85, 0, 0.9), kit.C.timber], [kit.box(0.03, 0.03, 0.55, 0.85, 0.68, 0.65), kit.C.timber]);
  for (let i = 0; i < 3; i++) b.add([kit.box(0.006, 0.08, 0.006, 0.85, 0.6, 0.48 + i * 0.16), kit.C.rope], [new THREE.SphereGeometry(0.06, 7, 5).scale(0.9, 1.4, 0.9).translate(0.85, 0.5, 0.48 + i * 0.16), "#a8574a"]);
  b.add(...kit.barrel(0.55, -0.62, rng));
  b.add(...kit.pennant(0.85, 0.7, 0.9, 0.3));
}

function toolsmith(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.1, 0.95, 0.8, { stone: rng.next() < 0.5, roof: ROOF.slate, chimney: false });
  b.place(c.parts, -0.35, 0);
  // Signature: an open forge with a stone hearth, a tall chimney, anvil and bellows.
  const fx = 0.72;
  b.add([kit.box(0.9, 0.08, 0.9, fx, 0), kit.C.stoneDark]);
  for (const [x, z] of [[-0.38, 0.38], [0.38, 0.38]] as const) b.add([kit.box(0.07, 0.85, 0.07, fx + x, 0.08, z), kit.C.timber]);
  for (let i = 0; i < 5; i++) b.add([new THREE.BoxGeometry(1.0, 0.03, 0.2).rotateZ(-0.25).translate(fx, 0.95 + i * 0.003, -0.42 + i * 0.2), kit.jitter("#6a6e76", rng, 2)]);
  b.add(...kit.stoneWalls(0.5, 0.4, 0.45, 0.08, rng).map(([g, col]) => [g.translate(fx + 0.1, 0, -0.2), col] as Part));
  b.add([kit.box(0.3, 0.12, 0.05, fx + 0.1, 0.28, 0.01), "#ffb050"]);
  b.add(...kit.chimney(fx + 0.1, -0.25, 1.55, 0.5, rng));
  b.meta.chimney = new THREE.Vector3(fx + 0.1, 1.63, -0.25);
  b.add([kit.cyl(0.08, 0.1, 0.2, 7, fx - 0.15, 0.08, 0.3), kit.C.timber], [kit.box(0.26, 0.08, 0.1, fx - 0.15, 0.28, 0.3), "#3a3d42"]);
  b.add([kit.box(0.24, 0.06, 0.18, fx + 0.38, 0.35, 0.05, 0.3), "#7a5638"]);
  b.add(...kit.crate(-1.05, 0.7, rng, 0.2), ...kit.pennant(fx + 0.38, 0.85, 0.38, 0.3));
}

function storehouse(b: Build): void {
  const { rng } = b;
  const w = 2.3;
  const d = 1.7;
  const h = 1.1;
  b.add(...kit.plinth(w + 0.14, d + 0.14, 0.2, rng), ...kit.logWalls(w, d, h, 0.2, rng));
  b.add(...kit.shingleRoof(w, d, 0.85, 0.2 + h, kit.jitter(ROOF.slate, rng, 0.5), rng, { gable: kit.C.log }));
  // Signature: wide double doors with a hoist beam above, and goods stacked outside.
  b.add([kit.box(0.9, 0.85, 0.04, 0, 0.2, d / 2 + 0.02), "#6a4a30"], [kit.box(0.02, 0.85, 0.05, 0, 0.2, d / 2 + 0.04), "#3a2a1e"]);
  b.add([kit.box(0.94, 0.05, 0.06, 0, 1.05, d / 2 + 0.05), kit.C.timberLight]);
  b.add([kit.box(0.1, 0.1, 0.5, 0, 1.55, d / 2 + 0.2), kit.C.timber], [kit.box(0.01, 0.35, 0.01, 0, 1.2, d / 2 + 0.42), kit.C.rope], ...kit.sack(0, d / 2 + 0.36, rng).map(([g, col]) => [g.translate(0, 1.0, 0.06), col] as Part));
  b.add(...kit.windowPart(-0.75, 0.75, d / 2 + 0.01, rng, rng.pick(SHUTTERS)), ...kit.windowPart(0.75, 0.75, d / 2 + 0.01, rng, rng.pick(SHUTTERS)));
  for (let i = 0; i < 4; i++) b.add(...kit.crate(-1.35 + (i % 2) * 0.26, 1.1, rng, 0.24, i > 1 ? 0.24 : 0));
  b.add(...kit.barrel(1.3, 1.05, rng), ...kit.barrel(1.5, 0.85, rng), ...kit.sack(1.15, 1.25, rng), ...kit.sack(1.35, 1.3, rng, "#e2c46e"));
  b.add(...kit.plankStack(-1.35, -0.2, 3, rng, Math.PI / 2), ...kit.banner(-0.58, 1.18, d / 2 + 0.01), ...kit.banner(0.58, 1.18, d / 2 + 0.01));
}

function farm(b: Build): void {
  const { rng } = b;
  const c = cottage(rng, 1.2, 0.95, 0.78, { roof: ROOF.red, thatch: rng.next() < 0.4 });
  b.place(c.parts, -0.8, 0.35);
  if (c.chimney) b.meta.chimney = moved(c.chimney, -0.8, 0.35);
  // Barn with a big roof and wide door, a round silo, hay bales.
  const bw = 1.1;
  const bd = 1.3;
  const barn: Part[] = [
    ...kit.plinth(bw + 0.1, bd + 0.1, 0.14, rng),
    ...kit.timberWalls(bw, bd, 0.95, 0.14, rng, "#9a4a3a"),
    ...kit.shingleRoof(bw, bd, 0.7, 1.09, kit.jitter("#6a4a3a", rng, 0.5), rng, { gable: "#9a4a3a" }),
    [kit.box(0.5, 0.62, 0.04, 0, 0.14, bd / 2 + 0.02), "#e8dcc4"],
    [kit.box(0.5, 0.04, 0.05, 0, 0.45, bd / 2 + 0.04, 0), "#6a4a30"],
  ];
  b.place(barn, 0.45, -0.35);
  b.place(kit.roundTower(0.3, 1.45, 0.1, rng, "#cfc4b0"), 1.25, 0.6);
  b.place(kit.coneRoof(0.36, 0.4, 1.55, "#8a8f98", rng), 1.25, 0.6);
  b.add([kit.box(0.7, 0.1, 0.7, 1.25, 0, 0.6), kit.C.stoneDark]);
  b.add(...kit.hayBale(0.2, 0.75, rng), ...kit.hayBale(0.45, 0.8, rng, 0.2), ...kit.hayBale(0.3, 0.8, rng, -0.1).map(([g, col]) => [g.translate(0, 0.2, 0), col] as Part));
  b.add(...kit.pennant(1.25, 1.95, 0.6, 0.35));
}

function windmill(b: Build): void {
  const { rng } = b;
  b.add([kit.box(1.5, 0.14, 1.5), kit.C.stoneDark], ...kit.roundTower(0.72, 2.1, 0.14, rng, "#e2d6c0", 0.72));
  b.add(...kit.coneRoof(0.62, 0.75, 2.24, kit.jitter(ROOF.red, rng, 0.6), rng));
  b.add(...kit.door(0, 0.14, 0.72, rng), ...kit.windowPart(0, 1.35, 0.6, rng, kit.C.shutterGreen, 0, 0.8));
  b.add([kit.cyl(0.08, 0.08, 0.5, 8, 0, 0, 0).rotateX(Math.PI / 2).translate(0, 2.1, 0.55), kit.C.timber]);
  b.meta.hub = new THREE.Vector3(0, 2.1, 0.82);
  b.add(...kit.sack(0.8, 0.55, rng, "#f1e6cc"), ...kit.sack(0.95, 0.4, rng, "#e2c46e"), ...kit.pennant(0, 2.95, 0, 0.3));
}

function pasture(b: Build): void {
  const { rng } = b;
  // A field shelter from the kit, and a fenced paddock with a trough.
  const shelter: Part[] = [
    ...kit.logWalls(0.9, 0.7, 0.55, 0.05, rng),
    ...kit.shingleRoof(0.9, 0.7, 0.35, 0.6, kit.C.roofMoss, rng, { gable: kit.C.log, thatch: true }),
  ];
  b.place(shelter, -0.6, -0.55);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.add([kit.box(0.06, 0.42, 0.06, Math.cos(a) * 1.25, 0, Math.sin(a) * 1.05), kit.jitter(kit.C.timber, rng)]);
    const n = a + Math.PI / 14;
    for (const y of [0.18, 0.34]) b.add([kit.box(0.58, 0.035, 0.035, Math.cos(n) * 1.22, y, Math.sin(n) * 1.02, -n + Math.PI / 2), kit.C.timberLight]);
  }
  b.add([kit.box(0.5, 0.14, 0.18, 0.5, 0, 0.35), kit.C.timber], [kit.box(0.44, 0.02, 0.12, 0.5, 0.13, 0.35), "#5f89a8"]);
  b.add(...kit.hayBale(0.6, -0.4, rng), ...kit.pennant(1.25, 0.4, 0, 0.35));
}

const ORE: Record<string, string> = { coal: "#2a2a2e", iron: "#a0583f", gold: "#e0b84a", granite: "#b8b2a8" };

function mine(b: Build, resource: string): void {
  const { rng } = b;
  // Signature: a timber-framed adit in a rocky mound, rails and a cart of ore.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI - Math.PI;
    const r = rng.range(0.3, 0.5);
    b.add([new THREE.DodecahedronGeometry(r, 0).translate(Math.cos(a) * 0.65, r * 0.6, Math.sin(a) * 0.5 - 0.2), kit.jitter("#8a847a", rng, 2)]);
  }
  b.add([new THREE.DodecahedronGeometry(0.75, 1).scale(1.3, 0.75, 0.9).translate(0, 0.25, -0.4), kit.jitter("#958e82", rng)]);
  b.add([kit.box(0.5, 0.6, 0.12, 0, 0, 0.3), "#1e1a18"]);
  b.add([kit.box(0.08, 0.7, 0.08, -0.3, 0, 0.36), kit.C.timber], [kit.box(0.08, 0.7, 0.08, 0.3, 0, 0.36), kit.C.timber], [kit.box(0.76, 0.1, 0.12, 0, 0.66, 0.36), kit.C.timber]);
  b.add(...kit.shingleRoof(0.7, 0.3, 0.18, 0.76, ROOF.slate, rng, { overhang: 0.05, gable: kit.C.timber }).map(([g, col]) => [g.translate(0, 0, 0.36), col] as Part));
  for (const x of [-0.1, 0.1]) b.add([kit.box(0.03, 0.03, 1.3, x, 0, 0.95), "#4a4e56"]);
  for (let i = 0; i < 6; i++) b.add([kit.box(0.34, 0.025, 0.06, 0, 0, 0.4 + i * 0.2), "#6a4a30"]);
  b.add([kit.box(0.3, 0.18, 0.38, 0, 0.06, 1.15), "#5a4636"]);
  for (const [x, z] of [[-0.12, 1.02], [0.12, 1.02], [-0.12, 1.28], [0.12, 1.28]] as const) b.add([kit.cyl(0.05, 0.05, 0.03, 8, 0, 0, 0).rotateZ(Math.PI / 2).translate(x * 1.3, 0.06, z), "#2a2a2e"]);
  const ore = ORE[resource] ?? "#8a847a";
  for (let i = 0; i < 4; i++) b.add([new THREE.DodecahedronGeometry(0.06, 0).translate(rng.range(-0.1, 0.1), 0.27, 1.15 + rng.range(-0.1, 0.1)), kit.jitter(ore, rng, 1.5)]);
  for (let i = 0; i < 6; i++) b.add([new THREE.DodecahedronGeometry(rng.range(0.07, 0.13), 0).translate(0.75 + rng.range(-0.15, 0.15), 0.06, 0.7 + rng.range(-0.15, 0.15)), kit.jitter(ore, rng, 1.5)]);
  b.add([kit.cyl(0.04, 0.05, 0.35, 5, -0.55, 0, 0.8), kit.C.timber], [kit.box(0.2, 0.2, 0.02, -0.55, 0.3, 0.8), "#e0d6c0"], ...kit.pennant(-0.3, 0.76, 0.36, 0.35));
}

function smelter(b: Build, gold: boolean): void {
  const { rng } = b;
  const w = 1.25;
  const d = 1.0;
  b.add(...kit.plinth(w + 0.12, d + 0.12, 0.18, rng), ...kit.stoneWalls(w, d, 0.85, 0.18, rng, gold ? "#b8a888" : kit.C.stone));
  b.add(...kit.shingleRoof(w, d, 0.55, 1.03, kit.jitter(gold ? "#8a6a3a" : ROOF.slate, rng, 0.5), rng, { gable: kit.C.stone }));
  b.add(...kit.door(-0.3, 0.18, d / 2 + 0.01, rng));
  // Signature: a tall round furnace stack beside the hall, glowing at its mouth.
  const tx = 0.75;
  b.place(kit.roundTower(0.28, 2.2, 0.1, rng, "#8a7a6a", 0.75), tx, -0.15);
  b.add([kit.box(0.2, 0.18, 0.06, tx, 0.2, 0.13), "#ffb050"], [kit.box(0.3, 0.05, 0.3, tx, 2.3, -0.15), kit.C.stoneDark]);
  b.meta.chimney = new THREE.Vector3(tx, 2.45, -0.15);
  for (let i = 0; i < 5; i++) b.add([new THREE.DodecahedronGeometry(rng.range(0.07, 0.12), 0).translate(-0.9 + rng.range(-0.15, 0.15), 0.06, 0.6 + rng.range(-0.1, 0.1)), "#2a2a2e"]);
  const bars = gold ? "#f0c85a" : "#8f96a3";
  for (let i = 0; i < 3; i++) b.add([kit.box(0.16, 0.05, 0.06, 0.3 + (i % 2) * 0.08, 0.05 * Math.floor(i / 2), 0.72), bars]);
  b.add(...kit.banner(0.3, 0.95, d / 2 + 0.01, 0.2, 0.32));
}

function lantern(b: Build): void {
  const { rng } = b;
  b.add(...kit.plinth(0.7, 0.7, 0.2, rng));
  b.add([kit.cyl(0.06, 0.08, 1.35, 6, 0, 0.2), kit.C.timber], [kit.box(0.5, 0.06, 0.06, 0.2, 1.42), kit.C.timber]);
  b.add([kit.box(0.04, 0.16, 0.04, 0.4, 1.28), "#3a3a3a"], [kit.box(0.2, 0.24, 0.2, 0.4, 1.02), "#3a3a3a"], [kit.box(0.16, 0.2, 0.16, 0.4, 1.04), kit.C.window]);
  b.add([new THREE.ConeGeometry(0.16, 0.14, 4).rotateY(Math.PI / 4).translate(0.4, 1.33, 0), "#3a3a3a"]);
  b.add([kit.box(0.5, 0.06, 0.18, -0.35, 0.22, 0.35), kit.C.timber], [kit.box(0.06, 0.22, 0.14, -0.55, 0, 0.35), kit.C.timber], [kit.box(0.06, 0.22, 0.14, -0.15, 0, 0.35), kit.C.timber]);
  b.add(...kit.barrel(0.35, -0.35, rng, 0.2), ...kit.pennant(0, 1.48, 0, 0.3));
  b.meta.flame = new THREE.Vector3(0.4, 1.14, 0);
}

function lamphouse(b: Build): void {
  const { rng } = b;
  b.add(...kit.plinth(1.0, 1.0, 0.16, rng), ...kit.stoneWalls(0.9, 0.9, 1.1, 0.16, rng));
  b.add(...kit.door(0, 0.16, 0.46, rng), [kit.box(1.02, 0.1, 1.02, 0, 1.26), kit.C.timber]);
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]] as const) b.add([kit.box(0.06, 0.42, 0.06, x, 1.36, z), kit.C.timber]);
  b.add([kit.box(0.38, 0.34, 0.38, 0, 1.4), kit.C.window]);
  b.add(...kit.coneRoof(0.46, 0.5, 1.78, kit.jitter(ROOF.slate, rng, 0.5), rng));
  b.add(...kit.banner(0.3, 1.1, 0.46, 0.16, 0.3));
  b.meta.flame = new THREE.Vector3(0, 1.57, 0);
}

function beacon(b: Build): void {
  const { rng } = b;
  b.add([kit.cyl(1.0, 1.15, 0.3, 10), kit.C.stoneDark], ...kit.roundTower(0.8, 2.6, 0.3, rng, "#c9bca0", 0.78));
  b.add([kit.cyl(0.85, 0.7, 0.2, 10, 0, 2.9), kit.C.stone], ...kit.door(0, 0.3, 0.78, rng));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add([kit.box(0.07, 0.62, 0.07, Math.cos(a) * 0.5, 3.1, Math.sin(a) * 0.5), "#3a3a3a"], [kit.box(0.12, 0.16, 0.12, Math.cos(a) * 0.8, 3.1, Math.sin(a) * 0.8), kit.C.stone]);
  }
  b.add([kit.cyl(0.42, 0.42, 0.62, 8, 0, 3.1), kit.C.window], ...kit.coneRoof(0.72, 0.8, 3.72, kit.jitter("#8a4a3a", rng, 0.5), rng));
  b.add(...kit.pennant(0, 4.5, 0, 0.45), ...kit.banner(0.35, 2.4, 0.63, 0.2, 0.4));
  b.meta.flame = new THREE.Vector3(0, 3.41, 0);
}

/** The Hearthship: a landed ship turned keep, with a cabin, lantern tower, mast and banners. */
function keep(b: Build): void {
  const { rng } = b;
  b.add(...kit.plinth(2.8, 3.9, 0.15, rng));
  // Hull of planks around ribs, resting on props.
  const strakes = 7;
  for (let i = 0; i < strakes; i++) {
    const f = i / (strakes - 1);
    const y = 0.35 + f * 0.95;
    const hw = 0.75 + Math.sin(f * Math.PI * 0.5) * 0.5;
    const len = 2.6 + f * 0.8;
    for (const s of [-1, 1]) b.add([kit.box(0.08, 0.15, len, s * hw, y, 0), kit.jitter("#7a5238", rng, 2)]);
  }
  b.add([kit.box(1.5, 0.15, 2.6, 0, 0.35), "#5a3d2a"]);
  for (const z of [-1.2, -0.4, 0.4, 1.2]) for (const s of [-1, 1]) b.add([kit.cyl(0.08, 0.14, 0.6, 6, s * 0.95, 0, z), "#5a4a3c"]);
  for (let i = 0; i < 9; i++) b.add([kit.box(2.3, 0.05, 0.36, 0, 1.45, -1.55 + i * 0.39), kit.jitter("#a07a55", rng, 1.5)]);
  for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) b.add([new THREE.CylinderGeometry(0.12, 0.12, 0.05, 10).rotateZ(Math.PI / 2).translate(s * 1.26, 1.0, i * 0.8), kit.C.window]);
  // Cabin from the kit, with a chimney.
  const cabin = cottage(rng, 1.4, 1.3, 0.9, { roof: ROOF.slate, doorAt: 0 });
  b.place(cabin.parts, 0, -0.55, 0, 1.3);
  if (cabin.chimney) b.meta.chimney = moved(cabin.chimney, 0, -0.55, 0, 1.3);
  // Lantern tower of stone with a shingle cone.
  const tx = 0.6;
  const tz = 0.95;
  b.add(...kit.roundTower(0.36, 2.2, 1.5, rng, "#cbb994", 0.85).map(([g, col]) => [g.translate(tx, 0, tz), col] as Part));
  b.add([kit.cyl(0.28, 0.28, 0.38, 10, tx, 3.7, tz), kit.C.window], [kit.cyl(0.36, 0.36, 0.06, 10, tx, 3.68, tz), kit.C.stoneDark]);
  b.add(...kit.coneRoof(0.4, 0.5, 4.08, kit.jitter(ROOF.red, rng, 0.4), rng).map(([g, col]) => [g.translate(tx, 0, tz), col] as Part));
  b.meta.flame = new THREE.Vector3(tx, 3.9, tz);
  // Mast with a furled sail and the owner's banner.
  b.add([kit.cyl(0.06, 0.08, 3.4, 6, -0.6, 1.5, 0.8), kit.C.timber], [kit.box(1.3, 0.05, 0.05, -0.6, 4.3, 0.8), kit.C.timber]);
  b.add([kit.cyl(0.1, 0.1, 1.2, 8, 0, 0, 0).rotateZ(Math.PI / 2).translate(-0.6, 4.2, 0.8), "#e8dcc4"]);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.7, -0.12, 0, 0, -0.45, 0, 0, 0, 0, 0, -0.45, 0, 0.7, -0.12, 0], 3));
  flag.computeVertexNormals();
  b.add([flag.translate(-0.58, 4.85, 0.8), kit.C.player], [kit.cyl(0.03, 0.03, 0.5, 5, -0.6, 4.9, 0.8), kit.C.timber]);
  b.add(...kit.banner(-0.35, 2.05, 0.11, 0.24, 0.4), ...kit.banner(0.35, 2.05, 0.11, 0.24, 0.4));
  b.add(...kit.logStack(-1.0, 1.65, 2, 0.8, rng), ...kit.crate(1.1, 1.6, rng, 0.24), ...kit.crate(1.3, 1.45, rng, 0.2), ...kit.barrel(0.85, 1.75, rng));
}

const BUILDERS: Record<string, (b: Build) => void> = {
  keep,
  storehouse,
  house,
  woodcutter,
  forester,
  quarry,
  sawmill,
  farm,
  mill: windmill,
  bakery,
  fisher,
  pasture,
  butcher,
  coalmine: (b) => mine(b, "coal"),
  ironmine: (b) => mine(b, "iron"),
  goldmine: (b) => mine(b, "gold"),
  granitemine: (b) => mine(b, "granite"),
  smelter: (b) => smelter(b, false),
  goldsmith: (b) => smelter(b, true),
  toolsmith,
  lantern,
  lamphouse,
  beacon,
};

/** Build a building's geometry; `userData.meta` carries its BuildingMeta. */
export function buildBuilding(id: string, variant: number): THREE.BufferGeometry {
  const rng = new kit.Rng(variant * 7919 + id.length * 31 + id.charCodeAt(0));
  const b = new Build(rng);
  (BUILDERS[id] ?? house)(b);
  const g = kit.assemble(b.parts);
  g.computeBoundingBox();
  const bb = g.boundingBox as THREE.Box3;
  b.meta.size.set(Math.max(-bb.min.x, bb.max.x), bb.max.y, Math.max(-bb.min.z, bb.max.z));
  g.userData.meta = b.meta;
  return g;
}

/** Scaffolding and marked ground for a construction site of a building of this size. */
export function siteGeometry(size: THREE.Vector3, stage: "marked" | "scaffold"): THREE.BufferGeometry {
  const w = Math.min(size.x * 2, 2.6);
  const d = Math.min(size.z * 2, 2.6);
  const parts: Part[] = stage === "marked" ? kit.markedGround(w, d) : kit.scaffolding(w * 0.8, d * 0.8, Math.min(size.y, 2.4));
  if (stage === "marked") {
    const rng = new kit.Rng(3);
    parts.push(...kit.logStack(w / 2 + 0.25, d / 2, 1, 0.7, rng), ...kit.plankStack(-w / 2 - 0.2, d / 2 - 0.1, 2, rng));
  }
  return kit.assemble(parts);
}
