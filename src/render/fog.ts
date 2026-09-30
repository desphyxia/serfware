import * as THREE from "three/webgpu";
import { cameraPosition, float, fog, length, max, mix, mx_noise_float, positionWorld, rangeFogFactor, smoothstep, time, uniform } from "three/tsl";
import { rgb } from "./painterly";

/**
 * Scene fog: aerial perspective (distant land fades into the horizon colour) and valley mist
 * that pools in low ground around dawn and after rain. Assigned to `scene.fogNode`.
 */
export const FOG = {
  near: uniform(1e6),
  far: uniform(2e6),
  color: uniform(new THREE.Color("#8fb6d8")),
  /** Planet radius (sea level). */
  radius: uniform(100),
  /** 0..1 how much valley mist there is right now. */
  valley: uniform(0),
  valleyColor: uniform(new THREE.Color("#d8dde6")),
};

export function makeFogNode(): THREE.Node {
  const distance = rangeFogFactor(FOG.near, FOG.far);
  const height = length(positionWorld).sub(FOG.radius);
  const toCam = length(cameraPosition.sub(positionWorld));
  const drift = mx_noise_float(positionWorld.mul(0.07).add(time.mul(0.015))).mul(0.5).add(0.5);
  // Mist lies in the lowest ground, thins with height, drifts in banks, and needs some distance
  // between it and the camera to read as mist rather than a veil.
  const banks = smoothstep(0.35, 0.75, drift);
  const valley = FOG.valley.mul(float(1).sub(smoothstep(0.1, 1.3, height))).mul(smoothstep(6, 26, toCam)).mul(banks).mul(0.5);
  const factor = max(distance, valley);
  const colour = mix(rgb(FOG.color), rgb(FOG.valleyColor), valley.div(factor.add(1e-4)).min(1));
  return fog(colour, factor);
}
