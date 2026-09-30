import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as kit from "./kit";
import { buildBuilding } from "./buildings";

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
