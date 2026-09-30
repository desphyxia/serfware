import * as THREE from "three/webgpu";
import {
  BRDF_Lambert,
  Discard,
  Fn,
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
  normalWorld,
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
  vec4,
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
const WHITE = new THREE.Color(1, 1, 1);

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
  /** Snow lying where the view is, 0..1: settles on roofs and other upward faces. */
  snow: uniform(0),
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

const ZERO3 = new THREE.Vector3();

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
  /** Snow settles on upward faces (roofs) as PAINT.snow rises. */
  snowy?: boolean;
  /** Parts in the kit's player marker colour take the object's `userData.tint`. */
  playerTint?: boolean;
  /** Left behind: dark, faded, with moss and creepers growing over it. */
  overgrown?: boolean;
  /** Construction: nothing above the object's `userData.clip` height (model space) is drawn. */
  clip?: boolean;
  /**
   * Weathering from the object's `userData.weather` (wear, moss, soot; 0..1 each): streaked,
   * faded walls, moss on roofs and plinths, soot high on forge walls. Windows and the owner's
   * colour stay clean.
   */
  weathered?: boolean;
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
    if (o.snowy || o.playerTint || o.overgrown || o.clip || o.weathered) {
      // Fold the vertex colour in here (so the material doesn't multiply it again), then apply
      // the per-object touches.
      const raw = vec3(vertexColor());
      let col: THREE.Node<"vec3"> = vec3((this.colorNode ?? materialColor) as THREE.Node<"vec3">).mul(o.vertexColors ? raw : vec3(1, 1, 1));
      const wUp = dot(normalize(normalWorld), normalize(positionWorld));
      const patch = mx_noise_float(positionWorld.mul(3.1)).mul(0.25);
      if (o.playerTint) {
        const tint = uniform(new THREE.Color(1, 1, 1)).onObjectUpdate(({ object }) => (object?.userData.tint as THREE.Color | undefined) ?? WHITE);
        const isPlayer = step(0.95, raw.x).mul(step(raw.y, 0.05)).mul(step(0.95, raw.z));
        col = mix(col, rgb(tint).mul(float(0.92).add(patch.mul(0.2))), isPlayer);
      }
      if (o.overgrown) {
        const grey = dot(col, vec3(0.3, 0.59, 0.11));
        col = mix(col, vec3(grey), 0.55).mul(0.55);
        const moss = smoothstep(0.1, 0.45, mx_noise_float(positionWorld.mul(1.7)).add(float(0.35).sub(positionGeometry.y.mul(0.3))).add(wUp.mul(0.2)));
        col = mix(col, vec3(0.16, 0.24, 0.1).mul(float(0.8).add(patch)), moss.mul(0.8));
      }
      if (o.weathered) {
        const w = uniform(new THREE.Vector3()).onObjectUpdate(({ object }) => (object?.userData.weather as THREE.Vector3 | undefined) ?? ZERO3);
        const isWindow = step(0.95, raw.x).mul(step(0.55, raw.y)).mul(step(raw.y, 0.8)).mul(step(0.15, raw.z)).mul(step(raw.z, 0.4));
        const isPlayer = step(0.95, raw.x).mul(step(raw.y, 0.05)).mul(step(0.95, raw.z));
        const clean = float(1).sub(isWindow).sub(isPlayer).max(0);
        const y = positionGeometry.y;
        // Wear: rain streaks down the walls and a greyer, flatter tone.
        const streak = smoothstep(0.35, 0.7, mx_noise_float(vec3(positionWorld.x.mul(9), positionWorld.y.mul(0.8), positionWorld.z.mul(9)))).mul(float(1).sub(wUp.max(0)));
        const grey = dot(col, vec3(0.3, 0.59, 0.11));
        const worn = mix(col, vec3(grey).mul(0.95), w.x.mul(0.35)).mul(float(1).sub(streak.mul(w.x).mul(0.3)));
        // Moss: on roofs and low on the walls, in patches.
        const mossy = smoothstep(0.2, 0.6, mx_noise_float(positionWorld.mul(2.3)).add(wUp.max(0).mul(0.4)).add(float(0.3).sub(y.mul(0.4)).max(0)))
          .mul(w.y);
        const withMoss = mix(worn, vec3(0.2, 0.3, 0.12).mul(float(0.85).add(patch)), mossy.mul(0.75));
        // Soot: darkest high up, in drifts.
        const sooty = smoothstep(0.4, 1.6, y.add(mx_noise_float(positionWorld.mul(1.9)).mul(0.6))).mul(w.z);
        col = mix(col, withMoss.mul(float(1).sub(sooty.mul(0.7))), clean);
      }
      if (o.snowy) {
        const cover = smoothstep(0.5, 0.8, wUp.add(patch)).mul(smoothstep(0.05, 0.6, PAINT.snow.add(patch.mul(0.5))));
        col = mix(col, vec3(0.9, 0.93, 0.97), cover);
      }
      if (o.clip) {
        const clipAt = uniform(1e9).onObjectUpdate(({ object }) => (object?.userData.clip as number | undefined) ?? 1e9);
        const body = col;
        this.colorNode = Fn(() => {
          Discard(positionGeometry.y.greaterThan(clipAt));
          return vec4(body, 1);
        })();
      } else this.colorNode = vec4(col, 1);
      this.vertexColors = false;
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
