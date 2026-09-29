import * as THREE from "three";
import type { LandUse } from "../sim/econ/landuse";
import { SurfaceFrames } from "./frames";
import { buildingGeometry, flagGeometry } from "./models";

/** Build-mode helpers: territory border, placement markers, road preview and ghost buildings. */
export class Overlays {
  readonly group = new THREE.Group();
  private border: THREE.LineSegments | null = null;
  private territoryVersion = -1;
  private readonly markers: THREE.InstancedMesh;
  private readonly preview: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly ghostMat = new THREE.MeshStandardMaterial({ color: "#9cc58f", transparent: true, opacity: 0.55, emissive: "#2a4a20", depthWrite: false });
  private ghost: THREE.Mesh | null = null;
  private ghostKey = "";
  private readonly ghostFlag: THREE.Mesh;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
  ) {
    const disc = new THREE.RingGeometry(0.18, 0.3, 16).rotateX(-Math.PI / 2);
    this.markers = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: "#c8f0a8", transparent: true, opacity: 0.75, depthWrite: false }), land.planet.grid.count);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 6;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.preview = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: "#9cc58f", transparent: true, depthTest: false, linewidth: 2 }));
    this.preview.renderOrder = 11;
    this.preview.visible = false;
    this.preview.frustumCulled = false;
    this.ghostFlag = new THREE.Mesh(flagGeometry(), this.ghostMat);
    this.ghostFlag.visible = false;
    this.group.add(this.markers, this.preview, this.ghostFlag);
  }

  update(): void {
    if (this.land.territoryVersion !== this.territoryVersion) {
      this.territoryVersion = this.land.territoryVersion;
      this.rebuildBorder();
    }
  }

  private rebuildBorder(): void {
    if (this.border) {
      this.group.remove(this.border);
      this.border.geometry.dispose();
    }
    const { grid } = this.land.planet;
    const pts: number[] = [];
    const R = this.land.planet.params.radius;
    const corner = (c: number) => {
      let h = 0;
      for (let j = 0; j < 3; j++) h += Math.max(0, this.land.planet.terrain.elevation[grid.cornerTiles[c * 3 + j] as number] as number);
      const r = R + h / 3 + 0.3;
      return [(grid.corners[c * 3] as number) * r, (grid.corners[c * 3 + 1] as number) * r, (grid.corners[c * 3 + 2] as number) * r];
    };
    for (let t = 0; t < grid.count; t++) {
      if (!this.land.territory[t]) continue;
      const ns = grid.neighborsOf(t);
      const cs = grid.cornersOf(t);
      for (let k = 0; k < ns.length; k++) {
        if (this.land.territory[ns[k] as number]) continue;
        const c0 = cs[(k - 1 + cs.length) % cs.length] as number;
        const c1 = cs[k] as number;
        pts.push(...corner(c0), ...corner(c1));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.border = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#f0b25a", transparent: true, opacity: 0.85 }));
    this.border.renderOrder = 5;
    this.group.add(this.border);
  }

  /** Show placement markers on the given tiles (or hide with an empty list). */
  setMarkers(tiles: readonly number[], color: string): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const t of tiles) {
      const p = this.frames.pos(t, 0.14);
      this.frames.orient(p, null, q);
      m.compose(p, q, s);
      this.markers.setMatrixAt(n++, m);
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    (this.markers.material as THREE.MeshBasicMaterial).color.set(color);
  }

  setPreview(tiles: readonly number[] | null, valid: boolean): void {
    if (!tiles || tiles.length < 2) {
      this.preview.visible = false;
      return;
    }
    const attr = this.preview.geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = Math.min(tiles.length, 64);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.frames.pos(tiles[i] as number, 0.4, p);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.preview.geometry.setDrawRange(0, n);
    this.preview.material.color.set(valid ? "#b8f08c" : "#ff8a6a");
    this.preview.visible = true;
  }

  setGhost(buildingId: string | null, tile: number, flagTile: number, valid: boolean): void {
    this.ghostMat.color.set(valid ? "#9cc58f" : "#e58a6c");
    this.ghostMat.emissive.set(valid ? "#1e3a14" : "#3a1410");
    if (!buildingId || tile < 0) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostFlag.visible = false;
      return;
    }
    if (this.ghostKey !== buildingId) {
      if (this.ghost) this.group.remove(this.ghost);
      this.ghost = buildingId === "flag" ? null : new THREE.Mesh(buildingGeometry(buildingId), this.ghostMat);
      if (this.ghost) this.group.add(this.ghost);
      this.ghostKey = buildingId;
    }
    if (this.ghost) {
      const p = this.frames.pos(tile, -0.02);
      this.ghost.position.copy(p);
      this.frames.orient(p, flagTile >= 0 ? this.frames.pos(flagTile) : null, this.ghost.quaternion);
      this.ghost.visible = true;
    }
    const ft = buildingId === "flag" ? tile : flagTile;
    if (ft >= 0) {
      const fp = this.frames.pos(ft);
      this.ghostFlag.position.copy(fp);
      this.frames.orient(fp, null, this.ghostFlag.quaternion);
      this.ghostFlag.visible = true;
    } else this.ghostFlag.visible = false;
  }

  dispose(): void {
    this.border?.geometry.dispose();
    this.markers.dispose();
    this.preview.geometry.dispose();
  }
}
