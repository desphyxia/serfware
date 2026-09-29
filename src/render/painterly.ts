import * as THREE from "three/webgpu";
import {
  BRDF_Lambert,
  clamp,
  cos,
  diffuseColor,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  materialColor,
  max,
  mix,
  mx_noise_float,
  normalView,
  positionGeometry,
  positionLocal,
  cross,
  normalize,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  vec3,
  vertexColor,
} from "three/tsl";

/**
 * The painterly look shared by every lit surface: terrain, buildings, trees, settlers, props.
 *
 * - Diffuse light is wrapped and gently banded, so forms read as painted planes.
 * - The shaded side takes a cool tint (sky bounce) while light stays warm.
 * - A thin warm rim separates silhouettes from the ground.
 * - World-anchored brush noise breaks up flat albedo.
 */

/** Look controls, shared by all painterly materials; the renderer tunes them per time of day. */
export const PAINT = {
  /** 0 smooth .. 1 hard bands. */
  banding: uniform(0.45),
  /** Colour of the light that fills shaded sides. */
  coolFill: uniform(new THREE.Color(0.42, 0.5, 0.85)),
  coolFillStrength: uniform(0.22),
  rimColor: uniform(new THREE.Color(1.0, 0.86, 0.66)),
  rimStrength: uniform(0.28),
  /** Night factor 0..1 for window glow. */
  night: uniform(0),
};

/** Shared wind, animated by the world view. */
export const WIND = {
  uTime: uniform(0),
  /** 0 calm .. 1 stormy. */
  uStrength: uniform(0.35),
};

type V3 = THREE.Node<"vec3">;

/** A colour uniform used as a vec3 in node maths. */
export function rgb(u: THREE.UniformNode<"color", THREE.Color>): V3 {
  return u as unknown as V3;
}

class PainterlyLightingModel extends THREE.PhysicalLightingModel {
  override direct(data: { lightDirection: THREE.Node; lightColor: THREE.Node; reflectedLight: { directDiffuse: THREE.Node } }): void {
    const lightDirection = data.lightDirection as V3;
    const lightColor = data.lightColor as V3;
    const ndl = dot(normalView, lightDirection);
    // Wrapped diffuse, then a soft three-band quantisation blended in.
    const wrap = clamp(ndl.add(0.3).div(1.3), 0, 1);
    const bands = float(3);
    const stair = floor(wrap.mul(bands)).add(smoothstep(0.35, 0.65, fract(wrap.mul(bands)))).div(bands);
    const ramp = mix(wrap, stair, PAINT.banding);
    const albedo = BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as V3;
    const lit = lightColor.mul(ramp);
    // Cool light in the shade: sky bounce, as painters do it.
    const cool = lightColor.mul(float(1).sub(ramp)).mul(rgb(PAINT.coolFill)).mul(PAINT.coolFillStrength);
    // Rim: grazing view angles on the lit side.
    const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
    const rim = pow(float(1).sub(facing), 3).mul(clamp(ndl.mul(0.5).add(0.55), 0, 1)).mul(PAINT.rimStrength);
    const rimLight = lightColor.mul(rgb(PAINT.rimColor)).mul(rim);
    (data.reflectedLight.directDiffuse as V3).addAssign(lit.add(cool).add(rimLight).mul(albedo));
  }

  override indirect(builder: THREE.NodeBuilder): void {
    const ctx = builder.context as unknown as { ambientOcclusion: V3; irradiance: V3; reflectedLight: { indirectDiffuse: V3 } };
    ctx.reflectedLight.indirectDiffuse.addAssign(ctx.irradiance.mul(BRDF_Lambert({ diffuseColor }) as unknown as V3));
    ctx.reflectedLight.indirectDiffuse.mulAssign(ctx.ambientOcclusion);
  }
}

export interface PainterlyOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  flatShading?: boolean;
  side?: THREE.Side;
  /** Brush noise strength (0 off). */
  brush?: number;
  /** Sway instanced geometry in the wind: higher is stiffer (0 = no wind). */
  wind?: number;
  /** Warm window glow at night on vertex colours matching the window colour. */
  windows?: boolean;
  emissive?: THREE.ColorRepresentation;
  transparent?: boolean;
  opacity?: number;
}

/** A lit surface in the painterly style. */
export class PainterlyMaterial extends THREE.MeshStandardNodeMaterial {
  constructor(o: PainterlyOptions = {}) {
    super({
      color: o.color ?? "#ffffff",
      vertexColors: o.vertexColors ?? false,
      flatShading: o.flatShading ?? false,
      side: o.side ?? THREE.FrontSide,
      roughness: 1,
      metalness: 0,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
    });
    if (o.emissive) this.emissive = new THREE.Color(o.emissive);
    const brush = o.brush ?? 1;
    if (brush > 0) {
      // Two octaves of world-anchored noise: large soft patches and finer strokes.
      const p = positionWorld;
      const big = mx_noise_float(p.mul(0.35));
      const fine = mx_noise_float(p.mul(2.7));
      const n = big.mul(0.6).add(fine.mul(0.4));
      this.colorNode = materialColor.mul(float(1).add(n.mul(0.09 * brush)));
    }
    if (o.wind) {
      // positionNode runs after the instance transform, so positions here are in the planet's
      // frame: sway along the local surface tangents, by the model's own height above its base.
      const stiff = 0.07 / o.wind;
      const ph = hash(instanceIndex).mul(6.283);
      const h = max(positionGeometry.y, 0);
      const t = WIND.uTime;
      const gust = sin(t.mul(0.35).add(ph.mul(0.2))).mul(0.4).add(0.6);
      const sway = sin(t.mul(1.7).add(ph)).mul(0.6).add(sin(t.mul(3.1).add(ph.mul(1.7))).mul(0.25)).mul(gust);
      const amt = WIND.uStrength.mul(h).mul(h).mul(stiff);
      const up = normalize(positionLocal);
      const t1 = normalize(cross(up, vec3(0, 1, 0)).add(vec3(1e-4, 0, 0)));
      const t2 = cross(up, t1);
      this.positionNode = positionLocal.add(t1.mul(sway.mul(amt))).add(t2.mul(cos(t.mul(1.3).add(ph)).mul(amt).mul(0.5)));
    }
    if (o.windows) {
      const c = vertexColor();
      const win = step(0.95, c.r).mul(step(0.55, c.g)).mul(step(c.g, 0.8)).mul(step(0.15, c.b)).mul(step(c.b, 0.4));
      this.emissiveNode = vec3(1.0, 0.68, 0.32).mul(win).mul(PAINT.night.mul(2.2).add(0.15));
    }
  }

  override setupLightingModel(): THREE.PhysicalLightingModel {
    return new PainterlyLightingModel();
  }
}
