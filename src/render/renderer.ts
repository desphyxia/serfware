import * as THREE from "three/webgpu";
import {
  clamp,
  colorToDirection,
  directionToColor,
  dot,
  emissive,
  float,
  length,
  max,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  pass,
  pow,
  renderOutput,
  sample,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import type { GraphicsSettings } from "../core/settings";
import { rgb } from "./painterly";

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
  width: number;
  height: number;
  gpu: string;
  backend: string;
}

/**
 * Colour grade, tuned per time of day, season and biome by the game: lift (shadows), gain
 * (highlights), a warm/cool split tone, saturation and a soft vignette.
 */
export const GRADE = {
  exposure: uniform(1.0),
  saturation: uniform(1.08),
  shadowTint: uniform(new THREE.Color(0.93, 0.95, 1.08)),
  highlightTint: uniform(new THREE.Color(1.06, 1.02, 0.94)),
  contrast: uniform(1.06),
  vignette: uniform(0.22),
  aoStrength: uniform(0.65),
  /** 0 = no depth of field; 1 = full tilt-shift. */
  dofAmount: uniform(0),
  dofFocus: uniform(20),
};

/**
 * three.js always passes `swizzle: "rgba"` (the identity) when creating texture views. Browsers
 * implementing an older draft of that field reject the string, so drop the identity value:
 * leaving it out means exactly the same thing.
 */
/** Set after a GPU device loss so the next load uses WebGL2. */
export const FALLBACK_KEY = "seedfall.webgl-fallback";

/** Whether this load should use WebGL2: forced by settings, the URL, or an earlier device loss. */
export function wantWebGL(settingsBackend: string): boolean {
  if (settingsBackend === "webgl") return true;
  try {
    if (new URLSearchParams(location.search).get("backend") === "webgl") return true;
    return sessionStorage.getItem(FALLBACK_KEY) === "1";
  } catch {
    return false;
  }
}

function shimIdentitySwizzle(): void {
  const proto = (globalThis as unknown as { GPUTexture?: { prototype: { createView: (d?: Record<string, unknown>) => unknown; __seedfallShim?: boolean } } }).GPUTexture?.prototype;
  if (!proto || proto.__seedfallShim) return;
  const original = proto.createView;
  proto.createView = function (this: unknown, d?: Record<string, unknown>) {
    if (d && d.swizzle === "rgba") {
      const rest = { ...d };
      delete rest.swizzle;
      return original.call(this, rest);
    }
    return original.call(this, d);
  };
  proto.__seedfallShim = true;
}

/**
 * Owns the WebGPU renderer (with a WebGL2 fallback) and the post-processing pipeline:
 * scene pass (colour, normals, emissive) → ambient occlusion → bloom on emissive → depth of
 * field (close-up) → colour grade → AgX tone mapping → FXAA.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGPURenderer;
  private pipeline: THREE.RenderPipeline;
  private settings: GraphicsSettings;
  private scenePass: ReturnType<typeof pass> | null = null;
  private lastStats = { drawCalls: 0, triangles: 0 };
  private built = "";
  private ready = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private camera: THREE.Camera,
    settings: GraphicsSettings,
  ) {
    this.settings = settings;
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      forceWebGL: wantWebGL(settings.backend),
    });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    // If the GPU device is ever lost (driver reset, unsupported hardware), reload once on WebGL2.
    this.renderer.onDeviceLost = (info: unknown) => {
      console.error("GPU device lost", info);
      try {
        if (sessionStorage.getItem(FALLBACK_KEY) !== "1") {
          sessionStorage.setItem(FALLBACK_KEY, "1");
          location.reload();
        }
      } catch {
        // No session storage: nothing more we can do automatically.
      }
    };
    this.pipeline = new THREE.RenderPipeline(this.renderer);
  }

  /** Start the graphics backend. Must finish before the first frame. */
  async init(): Promise<void> {
    shimIdentitySwizzle();
    await this.renderer.init();
    this.ready = true;
    this.apply(this.settings);
  }

  /** Build the shaders for everything in the scene now, reporting progress, so the first frame does not stall. */
  async precompile(onProgress: (fraction: number) => void): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera, null, (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    });
  }

  get backend(): string {
    const b = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return b?.isWebGPUBackend ? "WebGPU" : "WebGL2";
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.built = "";
    this.rebuild();
  }

  /** (Re)build the post-processing graph for the current settings. */
  private rebuild(): void {
    const g = this.settings;
    const key = `${g.msaa}:${g.bloom}:${g.ao}:${g.dof}`;
    if (key === this.built || !this.ready) return;
    this.built = key;
    // GTAO reads the depth buffer with textureGather, which WebGPU does not allow on a
    // multisampled texture: with ambient occlusion on, WebGPU renders the scene pass without
    // MSAA (FXAA still smooths edges). WebGL2 resolves the samples first, so it keeps MSAA.
    const samples = g.ao && this.backend === "WebGPU" ? 0 : g.msaa;
    const scenePass = pass(this.scene, this.camera, { samples });
    scenePass.setMRT(
      mrt({
        output,
        normal: directionToColor(normalView),
        emissive,
        metalness,
      }),
    );
    this.scenePass = scenePass;
    const color = scenePass.getTextureNode("output");
    let lit = color.rgb;
    if (g.ao) {
      const depth = scenePass.getTextureNode("depth");
      const normalTex = scenePass.getTextureNode("normal");
      const normal = sample((suv: THREE.Node<"vec2">) => colorToDirection(normalTex.sample(suv).rgb));
      const aoPass = ao(depth, normal, this.camera);
      aoPass.resolutionScale = 0.5;
      const occ = aoPass.getTextureNode().r;
      lit = lit.mul(mix(float(1), occ, GRADE.aoStrength));
    }
    if (g.bloom) {
      const glow = bloom(scenePass.getTextureNode("emissive"), 0.55, 0.45, 0.0);
      lit = lit.add(glow.rgb);
    }
    if (g.dof) {
      const viewZ = scenePass.getViewZNode();
      const blurred = dof(vec4(lit, 1), viewZ, GRADE.dofFocus, GRADE.dofFocus.mul(0.6), float(2.2));
      lit = mix(lit, (blurred as unknown as THREE.Node<"vec4">).rgb, GRADE.dofAmount);
    }
    // Grade in linear light before tone mapping.
    let c = lit.mul(GRADE.exposure);
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const shade = smoothstep(0.0, 0.6, lum);
    c = c.mul(mix(rgb(GRADE.shadowTint), rgb(GRADE.highlightTint), shade));
    c = mix(vec3(lum), c, GRADE.saturation);
    c = pow(max(c, vec3(0)).div(0.18), vec3(GRADE.contrast)).mul(0.18);
    const vig = float(1).sub(pow(clamp(length(screenUV.sub(0.5)).mul(1.35), 0, 1), 2.5).mul(GRADE.vignette));
    c = c.mul(vig);
    const out = renderOutput(vec4(c, 1));
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = fxaa(out);
    this.pipeline.needsUpdate = true;
  }

  apply(g: GraphicsSettings): void {
    this.settings = g;
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * g.resolutionScale);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = g.shadows !== "off";
    this.renderer.shadowMap.type = g.shadows === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.rebuild();
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
  }

  render(): void {
    if (!this.ready) return;
    this.renderer.info.reset();
    this.pipeline.render();
    this.lastStats = { drawCalls: this.renderer.info.render.drawCalls, triangles: this.renderer.info.render.triangles };
  }

  /** Render a throwaway object (memory leak test). */
  renderOnce(obj: THREE.Object3D): void {
    if (this.ready) this.renderer.render(obj, this.camera);
  }

  stats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: this.lastStats.drawCalls,
      triangles: this.lastStats.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: (info as unknown as { programs?: unknown[] }).programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
      gpu: this.backend,
      backend: this.backend,
    };
  }
}
