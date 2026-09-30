import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  fwidth,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  step,
  uniform,
  varying,
  vec3,
  vec4,
  vertexColor,
} from "three/tsl";
import { PainterlyMaterial } from "../painterly";
import { ROAD_HALF } from "./field";
import type { TileData } from "./tileData";

/**
 * Ground material. Colour starts from the biome blend baked into the vertices, then:
 * procedural surface detail (grass tufts and soil patches, rock strata on steep slopes, wet
 * sand at the shore), footpath wear, the build-mode grid, seasons (autumn, mud, snow) and
 * fog of war. Per-tile data comes from the shared tile texture, looked up per vertex.
 */
export function makeGroundMaterial(tiles: TileData, radius: number): PainterlyMaterial & { userData: { uniforms: { uGrid: THREE.UniformNode<"float", number> } } } {
  const mat = new PainterlyMaterial({ vertexColors: true, brush: 0 });
  const uGrid = uniform(0);
  const tile = attribute("aTile", "float");
  const edge = attribute("aEdge", "float");
  const A = varying(tiles.lookup(tiles.a, tile));
  const B = varying(tiles.lookup(tiles.b, tile));
  const blown = varying(tiles.lookup(tiles.c, tile).x);
  const wear = A.x;
  const fog = A.y;
  const snow = A.z;
  const autumn = A.w;
  const mud = B.x;
  const shore = B.z;
  const soil = B.y;
  const scorch = B.w;

  const p = positionWorld;
  const up = normalize(p);
  const height = length(p).sub(radius);
  const slope = float(1).sub(clamp(dot(normalWorld, up), 0, 1));
  let c: THREE.Node<"vec3"> = vec3(vertexColor());

  // Large soft variation, then fine painterly detail: tufts of lighter and darker grass, soil.
  const big = mx_noise_float(p.mul(0.09));
  const mid = mx_noise_float(p.mul(0.45));
  const fine = mx_noise_float(p.mul(2.4));
  const tuft = mx_noise_float(p.mul(6.5));
  c = c.mul(float(1).add(big.mul(0.1)).add(mid.mul(0.07)));
  const green = clamp(c.g.sub(max(c.r, c.b)).mul(5), 0, 1);
  c = mix(c, c.mul(vec3(1.08, 1.1, 0.92)), smoothstep(0.35, 0.7, tuft).mul(green).mul(0.6));
  c = mix(c, c.mul(vec3(0.82, 0.86, 0.74)), smoothstep(0.3, 0.75, fine.negate()).mul(green).mul(0.45));
  // Bare soil patches in grass.
  const soilPatch = smoothstep(0.45, 0.7, mid.add(fine.mul(0.35)));
  c = mix(c, vec3(0.48, 0.38, 0.26), soilPatch.mul(green).mul(0.35));

  // Rock on steep slopes, with warm strata along the height.
  const strata = sin(height.mul(5.5).add(mid.mul(2.5))).mul(0.5).add(0.5);
  const rock = mix(vec3(0.52, 0.49, 0.45), vec3(0.64, 0.58, 0.5), strata).mul(float(0.85).add(fine.mul(0.15)));
  // Distances to the nearest road centreline and to the river's water edge (world units).
  const roadD = attribute("aRoad", "float");
  const riverD = attribute("aRiver", "float");
  // Riverbanks are grassy and damp, not bare rock.
  const bank = smoothstep(1.8, 0.0, riverD);
  const rockMix = smoothstep(0.2, 0.48, slope.add(fine.mul(0.04))).mul(float(1).sub(bank.mul(0.9)));
  c = mix(c, rock, rockMix);

  // Beaches: wet dark sand at the waterline, dry pale sand just above.
  const beach = float(1).sub(smoothstep(0.15, 0.55, height)).mul(float(1).sub(rockMix)).mul(smoothstep(0.2, 0.8, shore));
  const sand = mix(vec3(0.62, 0.55, 0.4), vec3(0.85, 0.78, 0.6), smoothstep(0.02, 0.2, height));
  c = mix(c, sand, beach.mul(0.85));

  // Footpaths worn by settlers.
  c = mix(c, vec3(0.5, 0.4, 0.27), smoothstep(0.04, 1, wear).mul(0.7));
  // Riverbanks: damp ground, and a dark wet band right at the waterline.
  c = c.mul(float(1).sub(bank.mul(0.1)));
  const wetEdge = smoothstep(0.6, 0.0, abs(riverD.sub(0.08)));
  c = mix(c, c.mul(0.5).add(vec3(0.05, 0.04, 0.02)), wetEdge.mul(0.75));

  // Roads, part of the ground: a packed-earth surface with a worn grass shoulder, cart ruts and
  // edge stones on busy roads, and puddles in the ruts when the ground is muddy.
  const W = ROAD_HALF;
  const onRoad = smoothstep(W + 0.04, W - 0.03, roadD);
  const shoulder = smoothstep(W + 0.22, W, roadD).mul(float(1).sub(onRoad));
  c = c.mul(float(1).sub(shoulder.mul(0.14))).add(vec3(0.03, 0.02, 0).mul(shoulder));
  const busy = smoothstep(0.15, 0.7, wear);
  let road: THREE.Node<"vec3"> = mix(vec3(0.571, 0.407, 0.216), vec3(0.451, 0.305, 0.171), smoothstep(W * 0.3, W, roadD));
  road = road.mul(float(0.9).add(fine.mul(0.08)).add(mid.mul(0.04)));
  const wob = mx_noise_float(p.mul(0.9)).mul(0.03);
  const ruts = smoothstep(0.05, 0.0, abs(roadD.sub(W * 0.45).add(wob))).mul(float(0.25).add(busy.mul(0.55)));
  road = road.mul(float(1).sub(ruts.mul(0.3)));
  const stones = smoothstep(W * 0.76, W * 0.94, roadD).mul(busy).mul(step(0.05, mx_noise_float(p.mul(7))));
  road = mix(road, vec3(0.42, 0.4, 0.37).mul(float(0.85).add(fine.mul(0.15))), stones.mul(0.9));
  const puddle = smoothstep(0.2, 0.6, mud).mul(smoothstep(0.1, 0.35, mx_noise_float(p.mul(1.6)))).mul(ruts.add(0.3).min(1));
  road = mix(road, mix(road.mul(0.3), vec3(0.3, 0.37, 0.45), 0.4), puddle.mul(0.9));
  c = mix(c, road, onRoad);
  // Build-mode hex grid.
  const w = fwidth(edge).mul(1.4);
  const line = float(1).sub(smoothstep(0, w.add(0.02), edge));
  c = mix(c, c.mul(0.55).add(vec3(0.06, 0.05, 0.02)), line.mul(uGrid).mul(0.85));
  // Seasons: grass goes gold in autumn; mud darkens; snow lies white on the flatter ground.
  const luma = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, vec3(0.62, 0.48, 0.22).mul(luma.mul(1.9).add(0.1)), autumn.mul(green).mul(0.9));
  c = c.mul(float(1).sub(mud.mul(0.28)));
  // Washed-out, thin soil on eroded slopes: pale and stony in patches.
  const thin = smoothstep(0.3, 0.1, soil).mul(step(0.01, soil)).mul(smoothstep(0.35, 0.6, mid.add(fine.mul(0.3)).add(0.3)));
  c = mix(c, vec3(0.62, 0.55, 0.44).mul(fine.mul(0.15).add(0.95)), thin.mul(0.55).mul(green.add(0.3).min(1)));
  // Burnt ground: charcoal black in patches, greening again from the edges as scorch fades.
  const charred = smoothstep(0.2, 0.55, scorch.add(mid.mul(0.3)).add(fine.mul(0.15)));
  c = mix(c, vec3(0.035, 0.032, 0.03).add(vec3(0.09, 0.08, 0.07).mul(smoothstep(0.3, 0.8, fine))), charred.mul(0.94));
  // Volcanic ash (negative scorch): a soft grey blanket, drifted and speckled with cinders.
  const ash = clamp(scorch.negate(), 0, 1);
  const ashCover = smoothstep(0.05, 0.45, ash.add(mid.mul(0.25)).add(fine.mul(0.12)));
  const cinders = smoothstep(0.55, 0.75, tuft).mul(0.35);
  c = mix(c, mix(vec3(0.6, 0.58, 0.55), vec3(0.2, 0.18, 0.17), cinders).mul(float(0.9).add(fine.mul(0.12))), ashCover.mul(0.9));
  // Blown sand from Saltglass storms: pale drifts with wind ripples, over roads too.
  const drift = smoothstep(0.08, 0.5, blown.add(mid.mul(0.2)).add(fine.mul(0.1)));
  const ripple = sin(p.x.mul(9).add(p.z.mul(5)).add(mid.mul(6))).mul(0.5).add(0.5);
  c = mix(c, mix(vec3(0.86, 0.76, 0.56), vec3(0.74, 0.62, 0.44), ripple.mul(0.5)), drift.mul(0.9));
  // Snow drifts: patchy edges, deeper in hollows, sliding off steep ground.
  const snowCover = smoothstep(0.08, 0.55, snow.add(mid.mul(0.22)).add(fine.mul(0.08)))
    .mul(float(1).sub(smoothstep(0.35, 0.6, slope)))
    // Roads are trodden clear.
    .mul(float(1).sub(onRoad.mul(0.6)));
  c = mix(c, vec3(0.9, 0.93, 0.97), snowCover.mul(0.95));
  // Fog of war: remembered land a little faded, unexplored land dark and grey.
  const grey = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, mix(vec3(grey), c, 0.7).mul(0.86), smoothstep(0.1, 0.5, fog));
  c = mix(c, mix(vec3(grey), c, 0.3).mul(0.1).add(vec3(0.008, 0.011, 0.02)), smoothstep(0.55, 1, fog));
  // Geomorphing: each chunk blends from its coarser shape to full detail (see ChunkedTerrain).
  const morph = uniform(1).onObjectUpdate(({ object }) => (object?.userData.morph as number | undefined) ?? 1);
  mat.positionNode = mix(attribute("aCoarse", "vec3"), positionLocal, morph);
  // Fine relief: bend the normal along a procedural height's gradient. Rock is rough, grass
  // tufty, sand rippled, snow smooth.
  const bumpAt = (q: THREE.Node<"vec3">) =>
    mx_noise_float(q.mul(3.1))
      .mul(mix(float(0.35), float(1), rockMix))
      .add(mx_noise_float(q.mul(9)).mul(0.35))
      .add(sin(q.x.mul(14).add(q.z.mul(9)).add(mx_noise_float(q.mul(0.8)).mul(4))).mul(beach).mul(0.4));
  const eps = 0.04;
  const h0 = bumpAt(p);
  const grad = vec3(bumpAt(p.add(vec3(eps, 0, 0))).sub(h0), bumpAt(p.add(vec3(0, eps, 0))).sub(h0), bumpAt(p.add(vec3(0, 0, eps))).sub(h0)).div(eps);
  const nW = normalize(normalWorld);
  const tangential = grad.sub(nW.mul(dot(grad, nW)));
  const strength = mix(float(0.03), float(0.14), rockMix).mul(float(1).sub(snowCover.mul(0.8))).mul(float(1).sub(onRoad.mul(0.6)));
  const bumped = normalize(nW.sub(tangential.mul(strength)));
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(bumped, 0)).xyz);
  mat.vertexColors = false;
  mat.colorNode = vec4(c, 1);
  const out = mat as PainterlyMaterial & { userData: { uniforms: { uGrid: THREE.UniformNode<"float", number> } } };
  out.userData.uniforms = { uGrid };
  return out;
}
