import * as THREE from "three";

/**
 * Shared wind uniforms and a material patch that sways instanced plants. Sway grows with the
 * vertex's height above the instance origin, so trunks stay planted and crowns move.
 */
export const WIND = {
  uTime: { value: 0 },
  /** 0 calm .. 1 stormy. Driven by weather later; a gentle breeze for now. */
  uStrength: { value: 0.35 },
};

export function patchWind(mat: THREE.Material, stiffness = 1): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uWindTime = WIND.uTime;
    shader.uniforms.uWindStrength = WIND.uStrength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = dot(ip, vec3(0.37, 0.21, 0.29));
          float h = max(transformed.y, 0.0);
          float gust = 0.6 + 0.4 * sin(uWindTime * 0.35 + ph * 0.2);
          float sway = (sin(uWindTime * 1.7 + ph) * 0.6 + sin(uWindTime * 3.1 + ph * 1.7) * 0.25) * gust;
          float amt = uWindStrength * h * h * ${(0.07 / stiffness).toFixed(4)};
          transformed.x += sway * amt;
          transformed.z += cos(uWindTime * 1.3 + ph) * amt * 0.5;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `wind${stiffness}`;
}
