import * as THREE from "three/webgpu";
import { attribute, cameraPosition, mrt, vec4, clamp, dot, float, max, mix, mx_noise_float, normalize, positionWorld, pow, sin, smoothstep, time, uniform, vec3 } from "three/tsl";
import { rgb } from "./painterly";

/** Uniforms of the sea material, updated by the world view each frame. */
export interface WaterUniforms {
  sunDir: THREE.UniformNode<"vec3", THREE.Vector3>;
  sky: THREE.UniformNode<"color", THREE.Color>;
  day: THREE.UniformNode<"float", number>;
}

/**
 * Sea surface: depth-tinted colour, rippled normals, sun glint, Fresnel sky reflection and shore
 * foam that laps in and out. Depth comes from the terrain via the aDepth attribute.
 */
export function makeWaterMaterial(): THREE.MeshBasicNodeMaterial & { userData: { u: WaterUniforms } } {
  const u: WaterUniforms = {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sky: uniform(new THREE.Color("#8fb6d8")),
    day: uniform(1),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const depth = max(attribute("aDepth", "float"), 0);
  const fogOfWar = attribute("aFog", "float");
  const n = normalize(positionWorld);
  // Ripples: perturb the normal with two drifting noise layers.
  const p = positionWorld.mul(0.35);
  const t = time.mul(0.35);
  const e = 0.08;
  const o1 = vec3(t, 0, t.mul(0.7));
  const o2 = vec3(t.mul(0.6), t, 0).negate();
  const n1 = mx_noise_float(p.add(o1));
  const n2 = mx_noise_float(p.mul(2.3).add(o2));
  const g1 = vec3(mx_noise_float(p.add(vec3(e, 0, 0)).add(o1)), mx_noise_float(p.add(vec3(0, e, 0)).add(o1)), mx_noise_float(p.add(vec3(0, 0, e)).add(o1))).sub(n1).div(e);
  const g2 = vec3(mx_noise_float(p.mul(2.3).add(vec3(e, 0, 0)).add(o2)), mx_noise_float(p.mul(2.3).add(vec3(0, e, 0)).add(o2)), mx_noise_float(p.mul(2.3).add(vec3(0, 0, e)).add(o2))).sub(n2).div(e);
  let grad = g1.add(g2.mul(0.5)).mul(0.5);
  grad = grad.sub(n.mul(dot(grad, n)));
  const N = normalize(n.sub(grad.mul(0.06)));
  const V = normalize(cameraPosition.sub(positionWorld));
  const L = normalize(u.sunDir);
  const sunUp = clamp(dot(n, L).mul(3).add(0.2), 0, 1);
  const shallow = vec3(0.3, 0.62, 0.62);
  const deep = vec3(0.05, 0.2, 0.32);
  const base = mix(shallow, deep, smoothstep(0, 3.5, depth));
  const diff = max(dot(N, L), 0);
  let col = base.mul(diff.mul(sunUp).mul(0.82).add(0.18)).mul(mix(0.35, 1, u.day));
  const fres = pow(float(1).sub(max(dot(N, V), 0)), 5);
  col = mix(col, rgb(u.sky).mul(mix(0.25, 1, u.day)), fres.mul(0.55));
  const H = normalize(L.add(V));
  const spec = pow(max(dot(N, H), 0), 320).mul(sunUp);
  const glint = vec3(1.0, 0.95, 0.86).mul(spec).mul(0.9);
  col = col.add(glint);
  // Shore foam: bands that travel toward the coast.
  const shore = float(1).sub(smoothstep(0, 0.45, depth));
  const bands = smoothstep(0.55, 0.95, sin(depth.mul(9).sub(time.mul(1.6)).add(n1.mul(4))).mul(0.5).add(0.5));
  const foam = clamp(shore.mul(bands.mul(0.65).add(0.35)).mul(n2.mul(0.3).add(0.75)), 0, 1);
  col = mix(col, vec3(0.93, 0.95, 0.92).mul(mix(0.35, 1, sunUp)), foam.mul(0.6));
  // Fog of war over unexplored sea.
  col = mix(col, col.mul(0.1).add(vec3(0.01, 0.015, 0.03)), smoothstep(0.55, 1, fogOfWar));
  mat.colorNode = col;
  mat.opacityNode = max(mix(0.55, 0.93, smoothstep(0, 2, depth)), foam.mul(0.7));
  // Sun glints sparkle through bloom.
  mat.mrtNode = mrt({ emissive: vec4(glint.mul(0.6), 1) });
  const out = mat as THREE.MeshBasicNodeMaterial & { userData: { u: WaterUniforms } };
  out.userData.u = u;
  return out;
}
