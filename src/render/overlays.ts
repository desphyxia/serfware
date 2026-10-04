import * as THREE from "three/webgpu";
import { attribute, dot, float, mrt, positionWorld, pow, sin, smoothstep, time, uniform, vec3, vec4 } from "three/tsl";
import type { LandUse } from "../sim/econ/landuse";
import { SurfaceFrames } from "./frames";
import { buildingGeometry, flagGeometry } from "./models";

/** Build-mode helpers: territory border, placement markers, road preview and ghost buildings. */
export class Overlays {
  readonly group = new THREE.Group();
  private border: THREE.Mesh | null = null;
  private territoryVersion = -1;
  private readonly markers: THREE.InstancedMesh;
  private readonly reach: THREE.InstancedMesh;
  private readonly preview: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly ghostMat = new THREE.MeshStandardMaterial({ color: "#9cc58f", transparent: true, opacity: 0.55, emissive: "#2a4a20", depthWrite: false });
  private ghost: THREE.Mesh | null = null;
  private ghostKey = "";
  private readonly ghostFlag: THREE.Mesh;
  /** Pulsing double ring around the flag a road is being drawn from. */
  private readonly anchor: THREE.Group;
  /** Debug: every tile's outline, drawn on the ground (built the first time it is switched on). */
  private tileEdges: THREE.LineSegments | null = null;

  constructor(
    private readonly land: LandUse,
    private readonly frames: SurfaceFrames,
  ) {
    const disc = new THREE.RingGeometry(0.18, 0.3, 16).rotateX(-Math.PI / 2);
    this.markers = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: "#c8f0a8", transparent: true, opacity: 0.75, depthWrite: false }), land.planet.grid.count);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 6;
    // Enemy lanterns a selected lantern could attack: larger red rings.
    this.reach = new THREE.InstancedMesh(new THREE.RingGeometry(0.45, 0.7, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ff6a50", transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }), 64);
    this.reach.count = 0;
    this.reach.frustumCulled = false;
    this.reach.renderOrder = 12;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.preview = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: "#9cc58f", transparent: true, depthTest: false, linewidth: 2 }));
    this.preview.renderOrder = 11;
    this.preview.visible = false;
    this.preview.frustumCulled = false;
    this.ghostFlag = new THREE.Mesh(flagGeometry(), this.ghostMat);
    this.ghostFlag.visible = false;
    this.anchor = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2), ringMat);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    for (const m of [outer, inner]) {
      m.renderOrder = 13;
      m.frustumCulled = false;
      this.anchor.add(m);
    }
    this.anchor.visible = false;
    this.group.add(this.markers, this.reach, this.preview, this.ghostFlag, this.anchor);
  }

  /** Highlight the flag a road starts from (-1 hides it). */
  setAnchor(tile: number): void {
    if (tile < 0) {
      this.anchor.visible = false;
      return;
    }
    const p = this.frames.pos(tile, 0.2);
    this.anchor.position.copy(p);
    this.frames.orient(p, null, this.anchor.quaternion);
    this.anchor.visible = true;
  }

  private visionKey = "";
  private readonly borderNight = uniform(0);
  private readonly borderMat = (() => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const v = attribute("aV", "float");
    const col = attribute("color", "vec3");
    const shimmer = sin(time.mul(1.3).add(dot(positionWorld, vec3(0.9, 0.7, 1.1)).mul(1.7))).mul(0.25).add(0.75);
    const a = pow(float(1).sub(v), 2.4).mul(shimmer).mul(this.borderNight.mul(0.55).add(0.45)).add(smoothstep(0.1, 0, v).mul(0.35));
    m.colorNode = col.mul(a);
    m.opacityNode = a;
    m.mrtNode = mrt({ emissive: vec4(col.mul(a).mul(0.5), 1) });
    return m;
  })();

  /**
   * Rebuild borders when territory or the viewer's explored area changes. Borders glow in the
   * owner's colour as a low curtain of light.
   */
  update(_time = 0, night = 0, explored?: Uint8Array, visionVersion = 0, colors?: (owner: number) => THREE.Color): void {
    this.borderNight.value = night;
    if (this.anchor.visible) this.anchor.scale.setScalar(1 + 0.18 * Math.sin(performance.now() / 160));
    const key = `${this.land.territoryVersion}:${visionVersion}`;
    if (key !== this.visionKey) {
      this.visionKey = key;
      this.territoryVersion = this.land.territoryVersion;
      this.rebuildBorder(explored, colors);
    }
  }

  private rebuildBorder(explored?: Uint8Array, colors?: (owner: number) => THREE.Color): void {
    if (this.border) {
      this.group.remove(this.border);
      this.border.geometry.dispose();
    }
    const { grid } = this.land.planet;
    const pos: number[] = [];
    const col: number[] = [];
    const vs: number[] = [];
    const R = this.land.planet.params.radius;
    const corner = (c: number, lift: number) => {
      let h = 0;
      for (let j = 0; j < 3; j++) h += Math.max(0, this.land.planet.terrain.elevation[grid.cornerTiles[c * 3 + j] as number] as number);
      const r = R + h / 3 + lift;
      return [(grid.corners[c * 3] as number) * r, (grid.corners[c * 3 + 1] as number) * r, (grid.corners[c * 3 + 2] as number) * r];
    };
    const fallback = new THREE.Color("#f0b25a");
    for (let t = 0; t < grid.count; t++) {
      const o = this.land.territory[t] as number;
      if (!o || (explored && !explored[t])) continue;
      const c = colors ? colors(o - 1) : fallback;
      const ns = grid.neighborsOf(t);
      const cs = grid.cornersOf(t);
      for (let k = 0; k < ns.length; k++) {
        if (this.land.territory[ns[k] as number] === o) continue;
        const c0 = cs[(k - 1 + cs.length) % cs.length] as number;
        const c1 = cs[k] as number;
        // A vertical strip: bright at the ground, fading upward.
        const a0 = corner(c0, 0.08);
        const a1 = corner(c1, 0.08);
        const b0 = corner(c0, 0.75);
        const b1 = corner(c1, 0.75);
        pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
        vs.push(0, 0, 1, 0, 1, 1);
        for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aV", new THREE.Float32BufferAttribute(vs, 1));
    this.border = new THREE.Mesh(g, this.borderMat);
    this.border.renderOrder = 5;
    this.border.frustumCulled = false;
    this.group.add(this.border);
  }

  /** Debug: draw (or hide) the outline of every tile, so what a tile is, and what stands on which, can be seen. */
  setTileEdges(on: boolean): void {
    if (on && !this.tileEdges) this.tileEdges = this.buildTileEdges();
    if (this.tileEdges) this.tileEdges.visible = on;
  }

  get tileEdgesOn(): boolean {
    return !!this.tileEdges?.visible;
  }

  private buildTileEdges(): THREE.LineSegments {
    const { grid } = this.land.planet;
    const R = this.land.planet.params.radius;
    const elevation = this.land.planet.terrain.elevation;
    const pos: number[] = [];
    // A corner stands at the mean height of the three tiles that meet there, a little above the ground.
    const corner = (c: number) => {
      let h = 0;
      for (let j = 0; j < 3; j++) h += Math.max(0, elevation[grid.cornerTiles[c * 3 + j] as number] as number);
      const r = R + h / 3 + 0.1;
      pos.push((grid.corners[c * 3] as number) * r, (grid.corners[c * 3 + 1] as number) * r, (grid.corners[c * 3 + 2] as number) * r);
    };
    for (let t = 0; t < grid.count; t++) {
      const ns = grid.neighborsOf(t);
      const cs = grid.cornersOf(t);
      for (let k = 0; k < ns.length; k++) {
        // The edge shared with neighbour k runs between corners k-1 and k; each shared edge is drawn once.
        if ((ns[k] as number) < t) continue;
        corner(cs[(k - 1 + cs.length) % cs.length] as number);
        corner(cs[k] as number);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#fff1b8", transparent: true, opacity: 0.9, depthWrite: false }));
    lines.renderOrder = 4;
    lines.frustumCulled = false;
    this.group.add(lines);
    return lines;
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

  /** Ring the enemy buildings a selected lantern could attack (empty list hides them). */
  setReach(tiles: readonly number[]): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const t of tiles.slice(0, 64)) {
      const p = this.frames.pos(t, 0.2);
      this.frames.orient(p, null, q);
      m.compose(p, q, s);
      this.reach.setMatrixAt(n++, m);
    }
    this.reach.count = n;
    this.reach.instanceMatrix.needsUpdate = true;
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
    this.reach.dispose();
    this.preview.geometry.dispose();
    this.tileEdges?.geometry.dispose();
  }
}
