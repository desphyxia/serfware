import * as THREE from "three/webgpu";
import { attribute, normalize, positionLocal, uniform } from "three/tsl";
import type { TerrainField } from "./terrain/field";

/** Half-width of a lattice road, in world units. */
const HALF = 0.15;
/** Samples along one lattice edge, so the ribbon follows the ground. */
const STEPS = 6;
const DISC = 10;

/**
 * Lattice-mode roads drawn as thin ribbons of their own geometry laid on the ground, with a disc at
 * every junction. They do not depend on how coarse the ground mesh is, so they stay whole when zoomed out.
 */
export class RoadRibbons {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly widen = uniform(0);
  private readonly lift = uniform(0);
  private readonly material: THREE.MeshStandardNodeMaterial;

  constructor(
    private readonly field: TerrainField,
    private readonly radius: number,
  ) {
    const m = new THREE.MeshStandardNodeMaterial({ color: "#a07b45", roughness: 1, metalness: 0 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    // Wider and higher with camera distance, so a far road never thins to dashes or sinks into the coarse ground.
    m.positionNode = positionLocal.add(attribute("aSide", "vec3").mul(this.widen)).add(normalize(positionLocal).mul(this.lift));
    this.material = m;
    this.group.name = "roadRibbons";
  }

  /** Rebuild from lattice edges (pairs of node ids). */
  set(edges: readonly [number, number][]): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (edges.length === 0) return;
    const R = this.radius;
    const pos: number[] = [];
    const side: number[] = [];
    const idx: number[] = [];
    const up = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const sv = new THREE.Vector3();
    const at = (d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => out.copy(d).multiplyScalar(R + this.field.height(d.x, d.y, d.z).h + 0.03);
    const seen = new Set<string>();
    const nodes = new Set<number>();
    const key = (p: number, q: number) => (p < q ? `${p}:${q}` : `${q}:${p}`);
    for (const [n0, n1] of edges) {
      if (seen.has(key(n0, n1))) continue;
      seen.add(key(n0, n1));
      nodes.add(n0);
      nodes.add(n1);
      const p0 = new THREE.Vector3(...this.field.nodeXYZ(n0));
      const p1 = new THREE.Vector3(...this.field.nodeXYZ(n1));
      const base = pos.length / 3;
      const dirs: THREE.Vector3[] = [];
      for (let i = 0; i <= STEPS; i++) dirs.push(p0.clone().lerp(p1, i / STEPS).normalize());
      for (let i = 0; i <= STEPS; i++) {
        at(dirs[Math.max(0, i - 1)] as THREE.Vector3, a);
        at(dirs[Math.min(STEPS, i + 1)] as THREE.Vector3, b);
        tan.subVectors(b, a).normalize();
        up.copy(dirs[i] as THREE.Vector3);
        sv.crossVectors(tan, up).normalize();
        const c = at(dirs[i] as THREE.Vector3, new THREE.Vector3());
        for (const s of [-1, 1]) {
          pos.push(c.x + sv.x * HALF * s, c.y + sv.y * HALF * s, c.z + sv.z * HALF * s);
          side.push(sv.x * s, sv.y * s, sv.z * s);
        }
        if (i < STEPS) {
          const k = base + i * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    // A disc at each junction hides the seams where ribbons meet at an angle.
    for (const n of nodes) {
      const d = new THREE.Vector3(...this.field.nodeXYZ(n)).normalize();
      const c = at(d, new THREE.Vector3());
      const e1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
      const base = pos.length / 3;
      pos.push(c.x, c.y, c.z);
      side.push(0, 0, 0);
      for (let i = 0; i < DISC; i++) {
        const th = (i / DISC) * Math.PI * 2;
        sv.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
        pos.push(c.x + sv.x * HALF, c.y + sv.y * HALF, c.z + sv.z * HALF);
        side.push(sv.x, sv.y, sv.z);
        idx.push(base, base + 1 + i, base + 1 + ((i + 1) % DISC));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** Camera distance to the ground, in world units. */
  update(distance: number): void {
    const far = Math.max(0, distance - 12);
    this.widen.value = Math.min(0.3, far * 0.006);
    this.lift.value = Math.min(0.6, far * 0.02);
  }
}
