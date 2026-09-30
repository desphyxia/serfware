import * as THREE from "three/webgpu";
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  linearDepth,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  screenUV,
  select,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
  viewportDepthTexture,
  viewportSafeUV,
  viewportSharedTexture,
} from "three/tsl";
import { rgb } from "./painterly";

type F = THREE.Node<"float">;
type V3 = THREE.Node<"vec3">;

/** Uniforms shared by every water surface, updated by the world view each frame. */
export interface WaterUniforms {
  sunDir: THREE.UniformNode<"vec3", THREE.Vector3>;
  sky: THREE.UniformNode<"color", THREE.Color>;
  day: THREE.UniformNode<"float", number>;
  /** How far the tide lifts the sea over the Tidewater flats, world units. */
  tideLift: THREE.UniformNode<"float", number>;
  /** 0..1 rain at the camera focus: rings on the water. */
  rain: THREE.UniformNode<"float", number>;
}

export function makeWaterUniforms(): WaterUniforms {
  return {
    sunDir: uniform(new THREE.Vector3(1, 0, 0)),
    sky: uniform(new THREE.Color("#8fb6d8")),
    day: uniform(1),
    tideLift: uniform(0),
    rain: uniform(0),
  };
}

export interface WaterOptions {
  /** World-space flow direction (rivers); ripples drift along it. */
  flow?: V3;
  /** Flow speed factor (0 = still water). */
  speed?: F;
  /** Fog of war per fragment (0 seen, 0.5 remembered, 1 unknown). */
  fog?: F;
  /** Extra foam (0..1), e.g. at river bends and mouths. */
  foam?: F;
  /** Ripple scale: small for rivers, large for the sea. */
  scale?: number;
}

/**
 * Shared water shading for the sea, lakes and rivers. What lies under the surface comes from the
 * frame so far: the depth buffer gives the water's thickness along the view ray (so colour, foam
 * and shallows follow the real shoreline at any detail level), and the colour buffer, offset by
 * the ripples, gives soft refraction of the bed. On top: absorption toward deep blue, caustics in
 * the shallows, Fresnel sky reflection, sun glints, shore foam, and rain rings.
 */
export function waterNodes(u: WaterUniforms, o: WaterOptions = {}): { color: V3; glint: V3 } {
  const up = normalize(positionWorld);
  const scale = o.scale ?? 1;
  const t = time;
  // Ripples wander on still water. On rivers they drift with the flow using two phases that
  // each slide a short way and cross-fade, so the offset never grows with time (a single drift
  // of flow × time smears the pattern wherever the flow turns).
  const t2 = t.mul(0.35);
  const o1 = vec3(t2, 0, t2.mul(0.7));
  const o2 = vec3(t2.mul(0.6), t2, 0).negate();
  const e = 0.08;
  const ripple = (q: V3) => {
    const a = mx_noise_float(q.add(o1));
    const b = mx_noise_float(q.mul(2.3).add(o2));
    const ga = vec3(mx_noise_float(q.add(vec3(e, 0, 0)).add(o1)), mx_noise_float(q.add(vec3(0, e, 0)).add(o1)), mx_noise_float(q.add(vec3(0, 0, e)).add(o1))).sub(a).div(e);
    const gb = vec3(mx_noise_float(q.mul(2.3).add(vec3(e, 0, 0)).add(o2)), mx_noise_float(q.mul(2.3).add(vec3(0, e, 0)).add(o2)), mx_noise_float(q.mul(2.3).add(vec3(0, 0, e)).add(o2))).sub(b).div(e);
    return { n1: a, n2: b, grad: ga.add(gb.mul(0.5)).mul(0.5) as V3 };
  };
  const base = positionWorld.mul(0.35 * scale);
  let n1: F;
  let n2: F;
  let grad: V3;
  const phaseA = t.mul(0.2).fract();
  const phaseB = t.mul(0.2).add(0.5).fract();
  const fade = abs(phaseA.mul(2).sub(1));
  if (o.flow) {
    const stretch = (o.speed ?? float(1)).mul(2.2 * scale);
    const ra = ripple(base.sub(o.flow.mul(phaseA.mul(stretch))));
    const rb = ripple(base.sub(o.flow.mul(phaseB.mul(stretch))).add(vec3(3.1, 1.7, 5.3)));
    n1 = mix(ra.n1, rb.n1, fade);
    n2 = mix(ra.n2, rb.n2, fade);
    grad = mix(ra.grad, rb.grad, fade);
  } else {
    const r = ripple(base);
    n1 = r.n1;
    n2 = r.n2;
    grad = r.grad;
  }
  // Rain: small rings spreading from drops scattered over a grid, each on its own clock.
  const cell = positionWorld.mul(1.6);
  const seed = mx_noise_float(cell.floor().mul(1.37)).mul(0.5).add(0.5);
  const age = t.mul(0.9).add(seed.mul(7)).fract();
  const r = cell.fract().sub(0.5).length();
  const rings = smoothstep(0.04, 0.0, abs(r.sub(age.mul(0.45)))).mul(float(1).sub(age)).mul(u.rain);
  const N = normalize(up.sub(grad.mul(0.07)));
  const V = normalize(cameraPosition.sub(positionWorld));
  const L = normalize(u.sunDir);
  const sunUp = clamp(dot(up, L).mul(3).add(0.2), 0, 1);
  const light = mix(float(0.3), float(1), u.day);

  // Water thickness along the view ray, from the depth of what is behind the surface.
  const range = cameraFar.sub(cameraNear);
  const behind = linearDepth(viewportDepthTexture(screenUV));
  const thick = max(behind.sub(linearDepth()).mul(range), 0);
  // Refraction: look up the bed a little off to the side, following the ripples; fall back to
  // straight through if the offset lands on something in front of the water.
  const offset = grad.xy.mul(0.012).mul(smoothstep(0, 1.2, thick));
  const ruv = viewportSafeUV(screenUV.add(offset));
  const behindR = linearDepth(viewportDepthTexture(ruv));
  const useR = behindR.greaterThan(linearDepth());
  const uvB = select(useR, ruv, screenUV);
  const bed = viewportSharedTexture(uvB).rgb;
  const thickB = select(useR, max(behindR.sub(linearDepth()).mul(range), 0), thick);

  // Absorption: red goes first, then green; deep water turns to the water's own colour.
  const trans = exp(thickB.mul(vec3(-1.5, -0.6, -0.42)));
  const deep = vec3(0.025, 0.12, 0.2).mul(light);
  const tint = vec3(0.7, 0.88, 0.9);
  let col: V3 = bed.mul(tint).mul(trans).add(deep.mul(vec3(1, 1, 1).sub(trans)));
  // Caustics: bright wandering lines on the shallow bed.
  // They fade out with distance, where they would only read as noise.
  const cp = o.flow ? positionWorld.mul(0.8).sub(o.flow.mul(phaseA.mul(1.5))) : positionWorld.mul(0.8);
  const ca = abs(mx_noise_float(cp.add(vec3(t.mul(0.4), t.mul(0.3), 0))));
  const cb = abs(mx_noise_float(cp.mul(1.7).sub(vec3(0, t.mul(0.35), t.mul(0.25)))));
  const near = float(1).sub(smoothstep(8, 22, cameraPosition.sub(positionWorld).length()));
  const caustic = pow(float(1).sub(min(ca, cb)), 14).mul(trans.g).mul(float(1).sub(smoothstep(0.2, 2.2, thickB))).mul(near);
  col = col.add(vec3(0.9, 1, 0.95).mul(caustic).mul(sunUp).mul(0.22).mul(u.day));
  // Reflection of the sky, stronger at grazing angles.
  const fres = pow(float(1).sub(max(dot(N, V), 0)), 4).mul(0.85).add(0.04);
  col = mix(col, rgb(u.sky).mul(light), fres.mul(0.7));
  // Sun glint.
  const H = normalize(L.add(V));
  const spec = pow(max(dot(N, H), 0), 300).mul(sunUp);
  const glint = vec3(1.0, 0.95, 0.86).mul(spec).mul(0.9);
  col = col.add(glint);
  // Foam where the water thins out at the shore, broken up and lapping.
  const lap = sin(thick.mul(10).sub(t.mul(1.8)).add(n1.mul(4))).mul(0.5).add(0.5);
  const edge = float(1).sub(smoothstep(0.0, 0.3, thick));
  const shoreFoam = edge.mul(lap.mul(0.5).add(0.5)).mul(smoothstep(-0.3, 0.4, n2));
  const foam = clamp(shoreFoam.add(o.foam ?? float(0)), 0, 1);
  col = mix(col, vec3(0.92, 0.95, 0.93).mul(mix(0.35, 1, sunUp)).mul(light), foam.mul(0.75));
  col = col.add(vec3(0.8, 0.85, 0.9).mul(rings).mul(0.35).mul(light));
  // Fog of war.
  if (o.fog) col = mix(col, col.mul(0.1).add(vec3(0.01, 0.015, 0.03)), smoothstep(0.55, 1, o.fog));
  return { color: col, glint };
}
