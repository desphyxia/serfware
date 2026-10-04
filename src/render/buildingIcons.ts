import * as THREE from "three/webgpu";
import * as kit from "./kit";
import { buildingGeometry, hedgeGeometry } from "./models";

/** Icon size in pixels (a row is then 512 bytes, which WebGPU reads back unpadded; drawn at about a third of this in the menu, so it stays sharp on phones). */
const SIZE = 128;

/**
 * Small pictures of the buildings for the build menu: each model is drawn once, on demand, into a
 * tiny offscreen target of the game's own renderer, read back and kept as a data URL. Nothing is
 * drawn until a menu with icons is opened, and one icon at a time, between frames.
 */
export class BuildingIcons {
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
  private target: THREE.RenderTarget | null = null;
  private flip: Promise<boolean> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly renderer: THREE.WebGPURenderer) {
    this.scene.add(new THREE.HemisphereLight("#fff4e0", "#5a4a3a", 1.6));
    const sun = new THREE.DirectionalLight("#fff0d0", 2.6);
    sun.position.set(-3, 5, 4);
    this.scene.add(sun);
  }

  /** The icon for a building (or tool) as a data URL, or null when it has no model. */
  get(id: string): Promise<string | null> {
    let p = this.cache.get(id);
    if (!p) {
      p = this.queue.then(() => this.draw(id)).catch(() => null);
      this.queue = p;
      this.cache.set(id, p);
    }
    return p;
  }

  private geometry(id: string): THREE.BufferGeometry | null {
    if (id === "hedge") return hedgeGeometry();
    if (id === "causeway") return causewayIcon();
    if (id === "bridge") return bridgeIcon();
    return buildingGeometry(id);
  }

  private async draw(id: string): Promise<string | null> {
    const geo = this.geometry(id);
    if (!geo) return null;
    const flip = await this.needsFlip();
    const pixels = await this.render(geo);
    return toDataUrl(pixels, flip);
  }

  private async render(geo: THREE.BufferGeometry): Promise<Uint8Array> {
    const mesh = new THREE.Mesh(geo, this.mat);
    this.scene.add(mesh);
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const s = geo.boundingSphere as THREE.Sphere;
    const dist = (s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02;
    // From the front (+Z, where the door is), a little above and to the right.
    const dir = new THREE.Vector3(0.55, 0.62, 1).normalize();
    this.camera.position.copy(s.center).addScaledVector(dir, dist);
    this.camera.lookAt(s.center);
    this.camera.updateMatrixWorld();
    try {
      return await this.readTarget(this.scene, this.camera);
    } finally {
      this.scene.remove(mesh);
    }
  }

  private async readTarget(scene: THREE.Scene, camera: THREE.Camera): Promise<Uint8Array> {
    const r = this.renderer;
    this.target ??= new THREE.RenderTarget(SIZE, SIZE, { depthBuffer: true, samples: 4 });
    const prevTarget = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    try {
      r.render(scene, camera);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevColor, prevAlpha);
    }
    const data = await r.readRenderTargetPixelsAsync(this.target, 0, 0, SIZE, SIZE);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // WebGPU pads each row to a multiple of 256 bytes; take the stride from the data's own size.
    const stride = Math.max(SIZE * 4, Math.floor(bytes.length / SIZE));
    const out = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) out.set(bytes.subarray(y * stride, y * stride + SIZE * 4), y * SIZE * 4);
    return out;
  }

  /** Backends differ on whether a read-back starts at the top or the bottom row: draw a test card to find out. */
  private needsFlip(): Promise<boolean> {
    this.flip ??= (async () => {
      const scene = new THREE.Scene();
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
      cam.position.z = 5;
      const quad = (y: number, c: string) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ color: c }));
        m.position.y = y;
        scene.add(m);
      };
      quad(0.5, "#ff0000");
      quad(-0.5, "#0000ff");
      const px = await this.readTarget(scene, cam);
      // The first pixel is red when the top row comes first.
      return (px[0] ?? 0) < (px[2] ?? 0);
    })();
    return this.flip;
  }

  dispose(): void {
    this.target?.dispose();
    this.mat.dispose();
    this.cache.clear();
  }
}

/** Stand-ins for the two tools that have no model of their own: drawn only for the menu. */
const slab = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

/** A stone deck on two dressed piers, over a patch of water. */
function causewayIcon(): THREE.BufferGeometry {
  const parts: kit.Part[] = [[new THREE.CylinderGeometry(1.5, 1.5, 0.04, 20).translate(0, -0.02, 0), "#5f8ea0"]];
  for (const z of [-0.8, 0.8]) {
    parts.push([new THREE.CylinderGeometry(0.42, 0.5, 0.6, 6).translate(0, 0.3, z), "#7c766d"]);
    parts.push([new THREE.CylinderGeometry(0.46, 0.46, 0.06, 6).translate(0, 0.63, z), "#9a948a"]);
  }
  parts.push([slab(0.9, 0.14, 2.4, 0, 0.62, 0), "#a39d92"]);
  parts.push([slab(0.1, 0.1, 2.4, -0.45, 0.76, 0), "#8a8479"], [slab(0.1, 0.1, 2.4, 0.45, 0.76, 0), "#8a8479"]);
  return kit.assemble(parts);
}

/** A plank deck with posts and rails, over a patch of water. */
function bridgeIcon(): THREE.BufferGeometry {
  const parts: kit.Part[] = [[new THREE.CylinderGeometry(1.5, 1.5, 0.04, 20).translate(0, -0.02, 0), "#5f8ea0"]];
  for (let i = 0; i < 9; i++) parts.push([slab(0.9, 0.06, 0.24, 0, 0.5, -1 + i * 0.25), i % 2 ? "#d9b27a" : "#c9a06a"]);
  for (const x of [-0.5, 0.5]) {
    for (const z of [-1, 0, 1]) parts.push([slab(0.1, 0.85, 0.1, x, 0, z), "#7a5638"]);
    parts.push([slab(0.06, 0.06, 2.2, x, 0.78, 0), "#8a6040"]);
  }
  return kit.assemble(parts);
}

const toSrgb = (u: number): number => {
  const c = u / 255;
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** Linear RGBA pixels to a PNG data URL (sRGB, rows turned over when the read-back came bottom first). */
function toDataUrl(px: Uint8Array, flip: boolean): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    const src = (flip ? SIZE - 1 - y : y) * SIZE * 4;
    for (let x = 0; x < SIZE; x++) {
      const i = src + x * 4;
      const a = px[i + 3] as number;
      // Targets hold premultiplied colour; undo it, encode as sRGB.
      const k = a > 0 ? 255 / a : 0;
      const o = (y * SIZE + x) * 4;
      img.data[o] = toSrgb(Math.min(255, (px[i] as number) * k));
      img.data[o + 1] = toSrgb(Math.min(255, (px[i + 1] as number) * k));
      img.data[o + 2] = toSrgb(Math.min(255, (px[i + 2] as number) * k));
      img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
