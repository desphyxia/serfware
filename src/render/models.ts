import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as kit from "./kit";
import { buildBuilding, sledgeParts } from "./buildings";

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


const TIMBER = "#6e4b33";

const cache = new Map<string, THREE.BufferGeometry>();

/** Distinct looks per building kind (seeded variations of the same model). */
export const VARIANTS = 4;

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

/** A building's geometry (cached per kind and variant); `userData.meta` holds its BuildingMeta. */
export function buildingGeometry(id: string, v = 0): THREE.BufferGeometry {
  const key = `${id}:${v % VARIANTS}`;
  let g = cache.get(key);
  if (!g) {
    g = buildBuilding(id, (v % VARIANTS) + 1);
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
  const geos = [...(plain.length ? [kit.assemble(plain, true)] : []), ...baked.map(([g]) => g)].map((g) => {
    g.deleteAttribute("uv");
    return g;
  });
  return mergeGeometries(geos);
}

export function coniferGeometry(lite = false): THREE.BufferGeometry {
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
    const cone = new THREE.ConeGeometry(r, h, lite ? 7 : 11, lite ? 1 : 2);
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

export function broadleafGeometry(lite = false): THREE.BufferGeometry {
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
    const g = new THREE.IcosahedronGeometry(r, lite ? 0 : 1);
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

/** Birch: a slender white trunk banded with dark marks, under a light, airy crown. */
export function birchGeometry(lite = false): THREE.BufferGeometry {
  const rng = new kit.Rng(41);
  const trunk: Part[] = [];
  for (let i = 0; i < 6; i++) {
    const y0 = i * 0.2;
    const r = 0.055 - i * 0.006;
    const mark = rng.range(0.015, 0.035);
    trunk.push([cyl(r * 0.94, r, 0.2 - mark, 6, 0, y0), "#e6e1d6"], [cyl(r * 0.97 + 0.003, r * 0.97 + 0.003, mark, 6, 0, y0 + 0.2 - mark), i % 2 ? "#4a4440" : "#8a847a"]);
  }
  trunk.push([cyl(0.02, 0.03, 0.4, 5).rotateZ(-0.6).translate(0.1, 0.85, 0), "#e6e1d6"], [cyl(0.018, 0.026, 0.36, 5).rotateZ(0.7).rotateY(2).translate(-0.06, 0.95, 0.06), "#e6e1d6"]);
  const centre = new THREE.Vector3(0, 1.35, 0);
  const lumps: [number, number, number, number][] = [[0, 1.5, 0, 0.26], [0, 1.82, 0, 0.18]];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const rr = rng.range(0.18, 0.28);
    lumps.push([Math.cos(a) * rr, rng.range(1.05, 1.7), Math.sin(a) * rr, rng.range(0.14, 0.2)]);
  }
  const leaves: Part[] = lumps.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, lite ? 0 : 1).scale(1, 1.25, 1);
    return foliage(g.translate(x, y, z), centre, kit.jitter("#8db55a", rng, 1.2), 0.7);
  });
  return mergeBaked(trunk, leaves);
}

/** Pine: a tall, bare, rust-barked trunk carrying a few flat, dark crowns near the top. */
export function pineGeometry(lite = false): THREE.BufferGeometry {
  const rng = new kit.Rng(53);
  const trunk: Part[] = [
    [cyl(0.05, 0.1, 1.2, 7), "#6a4a36"],
    [cyl(0.035, 0.05, 0.7, 6, 0, 1.2), "#b0663e"],
    [cyl(0.02, 0.03, 0.4, 5).rotateZ(-0.9).translate(0.16, 1.45, 0), "#b0663e"],
    [cyl(0.02, 0.03, 0.4, 5).rotateZ(0.9).rotateY(2.2).translate(-0.1, 1.6, 0.12), "#b0663e"],
  ];
  const centre = new THREE.Vector3(0, 1.75, 0);
  const pads: [number, number, number, number][] = [[0, 1.95, 0, 0.42], [0.3, 1.62, 0.05, 0.3], [-0.24, 1.72, 0.14, 0.28], [0.05, 1.5, -0.26, 0.25]];
  const leaves: Part[] = pads.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, lite ? 0 : 1);
    const p = g.getAttribute("position");
    for (let k = 0; k < p.count; k++) {
      const w = 1 + Math.sin(p.getX(k) * 19 + p.getZ(k) * 11) * 0.1;
      p.setXYZ(k, p.getX(k) * w, p.getY(k) * 0.42, p.getZ(k) * w);
    }
    return foliage(g.translate(x, y, z), centre, kit.jitter("#3d5f3e", rng, 1), 0.6);
  });
  return mergeBaked(trunk, leaves);
}

/** Palm: a curved, ringed trunk and a head of drooping fronds (both sides drawn). */
export function palmGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(67);
  const trunk: Part[] = [];
  const at = (f: number) => new THREE.Vector3(0.35 * f * f, f * 1.9, 0);
  for (let i = 0; i < 9; i++) {
    const a = at(i / 9);
    const b = at((i + 1) / 9);
    const d = b.clone().sub(a);
    const r = 0.075 - i * 0.004;
    const g = cyl(r * 0.85, r, d.length(), 7).translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    trunk.push([g.translate(a.x, a.y, a.z), i % 2 ? "#8a7050" : "#9c8260"]);
  }
  const top = at(1);
  trunk.push([new THREE.SphereGeometry(0.06, 6, 4).translate(top.x + 0.04, top.y - 0.06, 0.05), "#5a4430"], [new THREE.SphereGeometry(0.06, 6, 4).translate(top.x - 0.04, top.y - 0.07, -0.04), "#5a4430"]);
  const fronds: Part[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(0.75, 0.95);
    const pos: number[] = [];
    const seg = 5;
    const pt = (f: number, side: number) => {
      const r = f * len;
      const droop = 0.25 * f - 0.75 * f * f;
      const w = Math.sin(Math.PI * Math.min(1, f * 1.1)) * 0.13 * side;
      return [top.x + Math.cos(a) * r - Math.sin(a) * w, top.y + droop * len + Math.abs(w) * 0.3, Math.sin(a) * r + Math.cos(a) * w];
    };
    for (let k = 0; k < seg; k++) {
      const f0 = k / seg;
      const f1 = (k + 1) / seg;
      const c0 = pt(f0, 0);
      const c1 = pt(f1, 0);
      for (const side of [-1, 1]) {
        const e0 = pt(f0, side);
        const e1 = pt(f1, side);
        pos.push(...c0, ...e0, ...e1, ...c0, ...e1, ...c1);
        pos.push(...c0, ...e1, ...e0, ...c0, ...c1, ...e1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    fronds.push(foliage(g, top.clone().add(new THREE.Vector3(0, 0.3, 0)), kit.jitter("#5d8f3c", rng, 1.2), 0.5));
  }
  return mergeBaked(trunk, fronds);
}

/**
 * An ancient giant of the Canopy Deeps: a buttressed, moss-banded trunk five times a man's height,
 * heavy limbs and a broad, dark crown. Treehouses are built around its trunk.
 */
export function giantTreeGeometry(lite = false): THREE.BufferGeometry {
  const rng = new kit.Rng(83);
  const bark = "#4d3b2e";
  const moss = "#4f6a34";
  const trunk: Part[] = [
    [cyl(0.34, 0.6, 2.2, 10), bark],
    [cyl(0.26, 0.34, 2.6, 9, 0, 2.2), bark],
    [cyl(0.605, 0.62, 0.5, 10, 0, 0.1), moss],
  ];
  // Buttress roots flaring out from the base.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const g = new THREE.BoxGeometry(0.16, 0.9, 1.0).translate(0, 0.45, 0.5);
    const p = g.getAttribute("position");
    // Taper toward the tip and the top so each root is a fin.
    for (let k = 0; k < p.count; k++) {
      const z = p.getZ(k);
      const y = p.getY(k);
      p.setY(k, y * (1 - z * 0.85));
      p.setX(k, p.getX(k) * (1 - z * 0.6));
    }
    g.computeVertexNormals();
    trunk.push([g.rotateY(a).translate(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25), i % 2 ? bark : moss]);
  }
  // Heavy limbs.
  const limbs: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const y = rng.range(3.6, 4.6);
    trunk.push([cyl(0.08, 0.16, 1.9, 6).translate(0, 0.95, 0).rotateZ(1.05).rotateY(a).translate(0, y, 0), bark]);
    limbs.push([Math.cos(a) * 1.7, y + 0.9, -Math.sin(a) * 1.7]);
  }
  const centre = new THREE.Vector3(0, 5.6, 0);
  const lumps: [number, number, number, number][] = [[0, 6.2, 0, 1.5], [0, 5.3, 0, 1.3]];
  for (const [x, y, z] of limbs) lumps.push([x, y, z, rng.range(0.95, 1.25)]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(1.2, 2.2);
    lumps.push([Math.cos(a) * r, rng.range(5.2, 6.6), Math.sin(a) * r, rng.range(0.8, 1.15)]);
  }
  const leaves: Part[] = lumps.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, lite ? 0 : 1);
    const p = g.getAttribute("position");
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      p.setY(k, yy < 0 ? yy * 0.6 : yy * 0.85);
    }
    return foliage(g.translate(x, y, z), centre, kit.jitter("#2f5a33", rng, 1), 0.7);
  });
  return mergeBaked(trunk, leaves);
}

/** An orchard tree: a short trunk, a round crown, and red fruit among the leaves. */
export function fruitTreeGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(97);
  const trunk: Part[] = [
    [cyl(0.05, 0.08, 0.55, 6), "#6e5038"],
    [cyl(0.025, 0.04, 0.35, 5).rotateZ(-0.8).translate(0.08, 0.5, 0), "#6e5038"],
    [cyl(0.025, 0.04, 0.35, 5).rotateZ(0.8).rotateY(2).translate(-0.05, 0.5, 0.06), "#6e5038"],
  ];
  const centre = new THREE.Vector3(0, 0.85, 0);
  const lumps: [number, number, number, number][] = [[0, 0.9, 0, 0.36]];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.2, 0.2);
    lumps.push([Math.cos(a) * 0.26, rng.range(0.72, 1.0), Math.sin(a) * 0.26, rng.range(0.2, 0.26)]);
  }
  const leaves: Part[] = lumps.map(([x, y, z, r]) => foliage(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), centre, kit.jitter("#5f9a45", rng, 1.2), 0.7));
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const e = rng.range(-0.4, 0.9);
    const r = 0.42;
    trunk.push([new THREE.SphereGeometry(0.045, 6, 4).translate(Math.cos(a) * Math.cos(e) * r, 0.88 + Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r), kit.jitter("#c8392e", rng, 1.5)]);
  }
  return mergeBaked(trunk, leaves);
}

/** One hedgerow segment: a row of clipped, lumpy bushes one unit long along +z. */
export function hedgeGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(101);
  const centre = new THREE.Vector3(0, 0.15, 0.5);
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const z = i * 0.22 + 0.06;
    const r = rng.range(0.15, 0.2);
    const g = new THREE.IcosahedronGeometry(r, 1).scale(1, 1.25, 1.1).translate(rng.range(-0.03, 0.03), r * 1.1, z);
    parts.push(foliage(g, centre.clone().setZ(z), kit.jitter("#48723a", rng, 1), 0.55));
  }
  return mergeBaked([], parts);
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

/**
 * A geothermal vent: a low cone of rust-red, sulphur-crusted rock with a dark throat that glows
 * orange inside. Pressure is shown by the renderer (instance colour, steam).
 */
export function ventGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(211);
  const parts: Part[] = [];
  // The cone: a ring of slabs leaning in toward the throat.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const r = rng.range(0.42, 0.55);
    const g = new THREE.DodecahedronGeometry(rng.range(0.2, 0.3), 0).scale(1, 0.75, 0.7).rotateZ(0.5).rotateY(-a).translate(Math.cos(a) * r, 0.14, Math.sin(a) * r);
    parts.push([g, kit.jitter(rng.pick(["#8a4a32", "#6e3a2a", "#9a6a44"]), rng, 1.5)]);
  }
  parts.push([kit.cyl(0.42, 0.7, 0.2, 12), "#5a3a2c"]);
  // Sulphur crust on the rim.
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    parts.push([new THREE.IcosahedronGeometry(rng.range(0.04, 0.08), 0).scale(1, 0.4, 1).translate(Math.cos(a) * 0.38, 0.27, Math.sin(a) * 0.38), kit.jitter("#d8c04a", rng, 1)]);
  }
  // The throat: dark, then glowing deeper in.
  parts.push([kit.cyl(0.26, 0.22, 0.04, 10, 0, 0.21), "#1a1210"], [kit.cyl(0.14, 0.14, 0.03, 8, 0, 0.23), "#ff9a3a"]);
  // Scattered glassy cinders.
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.75, 1.1);
    parts.push([new THREE.OctahedronGeometry(rng.range(0.05, 0.09), 0).scale(1, 1.3, 0.8).translate(Math.cos(a) * r, 0.03, Math.sin(a) * r), kit.jitter("#1c1a22", rng, 1)]);
  }
  return merge(parts);
}

/** A sledge (front +Z), for carriers on snow and ice; the dog is drawn with the animals. */
export function sledgeGeometry(): THREE.BufferGeometry {
  const parts = sledgeParts(new kit.Rng(19));
  // The traces to the dog.
  for (const x of [-0.08, 0.08]) parts.push([kit.box(0.008, 0.008, 0.36, x, 0.14, 0.48), kit.C.rope]);
  return merge(parts);
}

/**
 * A salt-crystal spire: a cluster of long six-sided prisms, pale rose to white, leaning out from
 * a crusted base. They catch the evening light and glow faintly at night (the renderer tints them).
 */
/**
 * A Precursor ruin: a broken ring of pale columns of five sides around a worn platform, a
 * fallen lintel, and a rune stone with a faint cyan glow. `dug` shows it excavated: the
 * platform lifted away into a pit, and the lens beneath it shining.
 */
export function ruinGeometry(dug = false): THREE.BufferGeometry {
  const rng = new kit.Rng(dug ? 911 : 907);
  const stone = "#d6d0c4";
  const parts: Part[] = [];
  if (!dug) parts.push([kit.cyl(0.72, 0.78, 0.12, 5, 0, 0, 0), "#bdb6a8"]);
  else parts.push([kit.cyl(0.55, 0.45, 0.06, 5, 0, 0, 0), "#3a342e"], [kit.cyl(0.18, 0.18, 0.08, 10, 0, 0.04, 0), "#8ff0ff"]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const h = [0.95, 0.4, 0.7, 0.25, 0.85][i]! * (0.85 + rng.next() * 0.3);
    parts.push([kit.cyl(0.09, 0.11, h, 5, Math.cos(a) * 0.6, 0.05, Math.sin(a) * 0.6), kit.jitter(stone, rng, 0.6)]);
    if (h > 0.6) parts.push([kit.cyl(0.13, 0.12, 0.06, 5, Math.cos(a) * 0.6, 0.05 + h, Math.sin(a) * 0.6), stone]);
  }
  parts.push([box(0.7, 0.1, 0.16, 0.2, 0.06, 0.75, 0.5), kit.jitter(stone, rng, 0.6)]);
  parts.push([box(0.16, 0.34, 0.08, -0.15, 0.08, -0.15, 0.4), "#a8a294"], [box(0.06, 0.12, 0.09, -0.15, 0.2, -0.15, 0.4), "#7fe8ff"]);
  return merge(parts);
}

export function spireGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(307);
  const parts: Part[] = [[new THREE.CylinderGeometry(0.55, 0.7, 0.18, 8).translate(0, 0.09, 0), "#d8cfc6"]];
  for (let i = 0; i < 7; i++) {
    const h = i === 0 ? 2.6 : rng.range(0.7, 1.8);
    const r = i === 0 ? 0.2 : rng.range(0.08, 0.15);
    const g = new THREE.CylinderGeometry(r * 0.25, r, h, 6).translate(0, h / 2, 0);
    const a = rng.range(0, Math.PI * 2);
    const lean = i === 0 ? 0.05 : rng.range(0.15, 0.5);
    g.rotateZ(lean).rotateY(a).translate(i === 0 ? 0 : Math.cos(a) * 0.25, 0.05, i === 0 ? 0 : Math.sin(a) * 0.25);
    parts.push([g, kit.jitter(rng.pick(["#f3e6e8", "#e8d2da", "#fbf6f2", "#dcc8e0"]), rng, 1)]);
  }
  return merge(parts);
}

/** A small rowing boat (front +Z), moored by the shellfisher, fisher and tide mill. */
export function rowboatGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(71);
  const h = kit.hull(1.3, 0.3, 0.22, rng, "#6e4a34");
  const parts = h.parts;
  parts.push([kit.box(0.5, 0.03, 0.12, 0, 0.16, -0.05), kit.C.timberLight], [kit.box(0.02, 0.02, 0.9, 0.18, 0.24, 0, 0.1), kit.C.timberLight]);
  return merge(parts);
}

/** Stilts under a building on the tidal flats: posts at the corners and cross-braces. */
export function stiltsGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const [x, z] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45], [0, -0.45], [0, 0.45]] as const) parts.push([box(0.08, 0.5, 0.08, x, -0.45, z), TIMBER]);
  for (const z of [-0.45, 0.45]) parts.push([new THREE.BoxGeometry(1.2, 0.04, 0.04).rotateZ(0.35).translate(0, -0.2, z), TIMBER]);
  parts.push([box(1.25, 0.06, 1.0, 0, -0.05, 0), "#8a6444"]);
  return merge(parts);
}

/**
 * A patch of glowcaps: a ring of pale-stemmed mushrooms with wide caps. The caps are bright
 * vertex colours; the renderer adds a teal glow at night.
 */
export function glowcapGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(401);
  const parts: Part[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = i === 0 ? 0 : rng.range(0.15, 0.45);
    const h = rng.range(0.12, 0.3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    parts.push([cyl(0.025, 0.035, h, 6, x, 0, z), "#e8e2d0"]);
    const cap = rng.range(0.07, 0.13);
    parts.push([new THREE.SphereGeometry(cap, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(x, h, z), kit.jitter(rng.pick(["#7fe8d0", "#9af0c8", "#b0e8f0"]), rng, 1)]);
  }
  return merge(parts);
}

/**
 * A sky island: a slab of buoyant stone, flat-topped with turf and a few crystals, tapering to a
 * jagged point below with hanging roots. About three tiles across.
 */
export function skyIslandGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(503);
  const parts: Part[] = [];
  // The underside: stacked, narrowing rings of rock.
  for (let i = 0; i < 5; i++) {
    const r0 = 3.2 * (1 - i * 0.2);
    const r1 = 3.2 * (1 - (i + 1) * 0.2) + 0.05;
    const g = new THREE.CylinderGeometry(r0, r1, 0.9, 9).translate(0, -0.45 - i * 0.9, 0);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const s = 1 + Math.sin(k * 1.7 + i) * 0.12;
      p.setX(k, p.getX(k) * s);
      p.setZ(k, p.getZ(k) * s);
    }
    parts.push([g, kit.jitter(i % 2 ? "#8a7a6e" : "#9a8a7a", rng, 1.5)]);
  }
  parts.push([new THREE.ConeGeometry(0.5, 1.4, 6).rotateX(Math.PI).translate(0.3, -5.1, 0.2), "#7a6a60"]);
  // The top: turf, a few buoyant-stone crystals, a lone pine.
  parts.push([new THREE.CylinderGeometry(3.25, 3.2, 0.18, 12).translate(0, 0.02, 0), "#7aa050"]);
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.6, 2.4);
    const h = rng.range(0.4, 1.0);
    parts.push([new THREE.CylinderGeometry(0.02, 0.14, h, 5).rotateZ(rng.range(-0.3, 0.3)).translate(Math.cos(a) * r, h / 2 + 0.1, Math.sin(a) * r), kit.jitter("#b8d8f0", rng, 1)]);
  }
  parts.push([cyl(0.08, 0.1, 0.7, 6, -1.2, 0.1, 0.8), "#6a4a34"], [new THREE.ConeGeometry(0.55, 1.4, 7).translate(-1.2, 1.3, 0.8), "#3f6a44"]);
  // Hanging roots.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push([cyl(0.02, 0.04, 1.2, 4, Math.cos(a) * 1.8, -1.9, Math.sin(a) * 1.8), "#5a4632"]);
  }
  return merge(parts);
}

/** A sky skiff: a light boat under a gas bag, with a little sail for steering. Front +Z. */
export function skiffGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(89);
  const h = kit.hull(1.0, 0.24, 0.18, rng, "#8a5a3a");
  const parts = h.parts;
  parts.push([new THREE.SphereGeometry(0.34, 12, 8).scale(0.8, 0.7, 1.5).translate(0, 0.95, 0), "#e8d8b0"]);
  for (const [x, z] of [[-0.14, -0.2], [0.14, -0.2], [-0.14, 0.2], [0.14, 0.2]] as const) parts.push([box(0.012, 0.62, 0.012, x, 0.18, z), kit.C.rope]);
  parts.push([box(0.01, 0.3, 0.26, 0, 0.2, -0.45), "#c8503a"]);
  return merge(parts);
}

/**
 * A skyship: a clinker hull hung under a long ribbed gas envelope, brass fins and a glowing
 * copper drive at the stern. Bow is -Z (like the skiff).
 */
export function skyshipGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(131);
  const h = kit.hull(1.7, 0.42, 0.3, rng, "#7a5236");
  const parts = h.parts;
  parts.push([new THREE.SphereGeometry(0.5, 16, 10).scale(1, 0.8, 2.6).translate(0, 1.35, 0), "#d9c9a2"]);
  for (let i = -3; i <= 3; i++) parts.push([new THREE.TorusGeometry(0.44, 0.022, 4, 16).scale(1, 0.8, 1).translate(0, 1.35, i * 0.3), "#8a6a44"]);
  for (const [x, z] of [[-0.24, -0.4], [0.24, -0.4], [-0.24, 0.4], [0.24, 0.4]] as const) parts.push([box(0.016, 0.72, 0.016, x, 0.3, z), kit.C.rope]);
  parts.push([box(0.02, 0.4, 0.34, 0, 1.4, 1.2), "#b8903a"], [box(0.6, 0.02, 0.3, 0, 1.35, 1.22), "#b8903a"]);
  parts.push([kit.cyl(0.1, 0.13, 0.26, 10).rotateX(Math.PI / 2).translate(0, 0.38, 0.95), "#b8703a"], [kit.cyl(0.07, 0.07, 0.04, 10).rotateX(Math.PI / 2).translate(0, 0.38, 1.1), "#ffb45a"]);
  parts.push([box(0.36, 0.22, 0.4, 0, 0.3, 0.1), "#6a4a30"], [box(0.4, 0.04, 0.44, 0, 0.43, 0.1), "#56657a"]);
  return merge(parts);
}

/**
 * The Hearthship under way: a big lofted clinker hull with a deckhouse, two long gas envelopes
 * and a row of copper drives. It lands and unpacks into a keep.
 */
export function hearthshipCraftGeometry(): THREE.BufferGeometry {
  const rng = new kit.Rng(277);
  const h = kit.hull(3.2, 0.8, 0.6, rng, "#6e4a30");
  const parts = h.parts;
  for (const x of [-0.55, 0.55]) {
    parts.push([new THREE.SphereGeometry(0.55, 16, 10).scale(1, 0.85, 3.1).translate(x, 2.0, 0), "#e2d4b0"]);
    for (let i = -4; i <= 4; i++) parts.push([new THREE.TorusGeometry(0.5, 0.025, 4, 16).scale(1, 0.85, 1).translate(x, 2.0, i * 0.34), "#8a6a44"]);
  }
  parts.push([box(1.0, 0.5, 1.2, 0, 0.55, 0.3), "#8a6444"], [box(1.1, 0.06, 1.3, 0, 0.82, 0.3), "#a8513c"], [box(0.9, 0.08, 0.1, 0, 0.62, -0.29), "#ffd890"]);
  for (const x of [-0.4, 0, 0.4]) parts.push([kit.cyl(0.12, 0.16, 0.34, 10).rotateX(Math.PI / 2).translate(x, 0.45, 1.75), "#b8703a"], [kit.cyl(0.09, 0.09, 0.04, 10).rotateX(Math.PI / 2).translate(x, 0.45, 1.94), "#ffb45a"]);
  for (const [x, z] of [[-0.5, -0.9], [0.5, -0.9], [-0.5, 0.9], [0.5, 0.9]] as const) parts.push([box(0.02, 1.2, 0.02, x, 0.6, z), kit.C.rope]);
  return merge(parts);
}

/** A survey probe: a brass sphere with a dish, antennae and a glowing eye. */
export function probeGeometry(): THREE.BufferGeometry {
  return merge([
    [new THREE.SphereGeometry(0.28, 12, 8), "#c8a050"],
    [new THREE.CylinderGeometry(0.3, 0.05, 0.12, 12).translate(0, 0.32, 0), "#d8d0c0"],
    [box(0.01, 0.6, 0.01, 0.15, 0.1, 0), "#5a5e66"],
    [box(0.01, 0.5, 0.01, -0.15, 0.05, 0.05), "#5a5e66"],
    [new THREE.SphereGeometry(0.07, 8, 6).translate(0, 0, -0.27), "#7fe0ff"],
  ]);
}

/** A glider: a pale cloth wing on a light frame, as the Skyreef folk ride the updrafts. */
export function gliderGeometry(): THREE.BufferGeometry {
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.35, -0.6, 0, -0.2, 0, 0.04, -0.1, 0, 0, 0.35, 0, 0.04, -0.1, 0.6, 0, -0.2], 3));
  return merge([
    [wing, "#f0e6d0"],
    [box(0.02, 0.02, 0.5, 0, -0.02, 0.05), kit.C.timber],
    [box(0.05, 0.14, 0.05, 0, -0.18, 0.02), "#6a5a8a"],
  ]);
}

/** A ropeway cable (unit length along +Y, thin) and a gondola, for the renderer to stretch. */
export function cableGeometry(): THREE.BufferGeometry {
  return merge([[new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, 0.5, 0), "#3a3530"]]);
}

export function gondolaGeometry(): THREE.BufferGeometry {
  return merge([
    [box(0.3, 0.24, 0.4, 0, -0.34, 0), "#8a6444"],
    [box(0.32, 0.03, 0.42, 0, -0.1, 0), "#5f412c"],
    [box(0.02, 0.1, 0.02, 0, -0.1, 0), "#3a3530"],
    [new THREE.SphereGeometry(0.05, 6, 4).translate(0, 0, 0), "#3a3530"],
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
    case "salt":
      parts = sack("#f4f2ec");
      break;
    case "glass":
      parts = [0, 1, 2].map((i) => [kit.box(0.14, 0.012, 0.18, 0, 0.02 + i * 0.014, 0, i * 0.2), "#bfe4e2"] as Part);
      break;
    case "shellfish":
      parts = basket(lumps("#3a3642", 5, 0.04));
      break;
    case "peat":
      parts = [0, 1, 2].map((i) => [kit.box(0.2, 0.05, 0.08, 0, 0.025 + i * 0.05, (i % 2) * 0.03 - 0.015, i * 0.4), kit.jitter("#4a3526", rng, 2)] as Part);
      break;
    case "glowcap":
      parts = basket([0, 1, 2].map((i) => [new THREE.SphereGeometry(0.045, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate((i - 1) * 0.05, 0.1, (i % 2) * 0.03), "#8ff0d0"] as Part));
      break;
    case "skystone":
      parts = [0, 1].map((i) => [new THREE.OctahedronGeometry(0.07 + i * 0.02, 0).scale(1, 1.4, 1).translate((i - 0.5) * 0.08, 0.12, 0), kit.jitter("#b8d8f0", rng, 1)] as Part);
      break;
    case "obsidian":
      // Volcanic glass: black, conchoidal shards with a faint violet sheen.
      parts = [0, 1, 2].map((i) => [new THREE.OctahedronGeometry(0.06 + i * 0.012, 0).scale(1, 1.5, 0.7).rotateZ(0.4 * i).translate((i - 1) * 0.06, 0.07, (i % 2) * 0.03), kit.jitter(i === 1 ? "#2a2436" : "#16141c", rng, 1)] as Part);
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
    case "fruit":
      parts = basket(lumps("#c8392e", 5, 0.05));
      break;
    case "honey":
      parts = [
        [kit.cyl(0.07, 0.08, 0.14, 10), "#d9a33a"],
        [kit.cyl(0.075, 0.075, 0.03, 10, 0, 0.14), "#e8dcc4"],
        [kit.cyl(0.02, 0.02, 0.03, 6, 0, 0.17), "#8a6a44"],
      ];
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
    default: {
      // Tools: a small cradle with the tool lying on it.
      const head = (w: number, h: number, d: number, x: number, z: number, c = "#9aa1ab"): Part => [kit.box(w, h, d, x, 0.07, z), c];
      const handle: Part = [kit.box(0.26, 0.022, 0.022, 0, 0.075, 0), "#8a6444"];
      const cradle: Part[] = [
        [kit.box(0.22, 0.05, 0.12, 0, 0, 0), "#b08a5c"],
        [kit.box(0.22, 0.02, 0.02, 0, 0.05, -0.05), "#8a6444"],
      ];
      const tools: Record<string, Part[]> = {
        axe: [handle, head(0.05, 0.02, 0.07, 0.12, 0.02)],
        saw: [[kit.box(0.26, 0.008, 0.06, 0.02, 0.07, 0), "#c9cdd4"], [kit.box(0.05, 0.03, 0.05, -0.12, 0.07, 0), "#8a6444"]],
        pick: [handle, head(0.03, 0.02, 0.18, 0.12, 0)],
        hammer: [handle, head(0.05, 0.035, 0.06, 0.12, 0, "#6a6e76")],
        shovel: [handle, head(0.08, 0.01, 0.07, 0.15, 0)],
        scythe: [handle, head(0.03, 0.008, 0.18, 0.13, 0.07, "#c9cdd4")],
        rod: [[kit.box(0.34, 0.012, 0.012, 0, 0.07, 0), "#8a6444"], [kit.box(0.02, 0.02, 0.02, -0.08, 0.07, 0.015), "#6a6e76"]],
        cleaver: [[kit.box(0.08, 0.02, 0.02, -0.05, 0.07, 0), "#8a6444"], head(0.1, 0.01, 0.07, 0.04, 0)],
        crook: [[kit.box(0.3, 0.018, 0.018, 0, 0.075, 0), "#8a6444"], [new THREE.TorusGeometry(0.035, 0.008, 4, 8, Math.PI * 1.3).rotateX(Math.PI / 2).translate(0.17, 0.075, 0.02), "#8a6444"]],
        tongs: [[kit.box(0.24, 0.015, 0.015, 0, 0.07, 0.012, 0.08), "#4a4e56"], [kit.box(0.24, 0.015, 0.015, 0, 0.07, -0.012, -0.08), "#4a4e56"]],
      };
      parts = tools[id] ? [...cradle, ...tools[id]!] : kit.crate(0, 0, rng, 0.16);
    }
  }
  g = kit.assemble(parts, false);
  cache.set(key, g);
  return g;
}
