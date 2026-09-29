import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { GraphicsSettings } from "../core/settings";

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
}

/** Owns the WebGL renderer and post-processing chain, and applies graphics settings live. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private settings: GraphicsSettings;
  private readonly gpuName: string;
  private lastStats = { drawCalls: 0, triangles: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: GraphicsSettings,
  ) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = false;

    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: settings.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.apply(settings);
    this.resize();
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  apply(g: GraphicsSettings): void {
    const prev = this.settings;
    this.settings = g;
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * g.resolutionScale);
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);

    this.renderer.shadowMap.enabled = g.shadows !== "off";
    this.renderer.shadowMap.type = g.shadows === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;

    this.bloom.enabled = g.bloom;

    if (prev.msaa !== g.msaa) {
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        rt.samples = g.msaa;
        rt.dispose();
      }
    }
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
    this.lastStats = { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  stats(): RenderStats {
    const info = this.renderer.info;
    return {
      drawCalls: this.lastStats.drawCalls,
      triangles: this.lastStats.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pixelRatio: this.renderer.getPixelRatio(),
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
      gpu: this.gpuName,
    };
  }
}
