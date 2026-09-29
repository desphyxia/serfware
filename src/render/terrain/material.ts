import * as THREE from "three/webgpu";
import {
  attribute,
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
  positionWorld,
  sin,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
  vertexColor,
} from "three/tsl";
import { PainterlyMaterial } from "../painterly";
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
  const wear = A.x;
  const fog = A.y;
  const snow = A.z;
  const autumn = A.w;
  const mud = B.x;

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
  const rockMix = smoothstep(0.22, 0.42, slope.add(fine.mul(0.06)));
  c = mix(c, rock, rockMix);

  // Beaches: wet dark sand at the waterline, dry pale sand just above.
  const beach = float(1).sub(smoothstep(0.15, 0.45, height)).mul(float(1).sub(rockMix));
  const sand = mix(vec3(0.62, 0.55, 0.4), vec3(0.85, 0.78, 0.6), smoothstep(0.02, 0.2, height));
  c = mix(c, sand, beach.mul(0.85));

  // Footpaths worn by settlers.
  c = mix(c, vec3(0.5, 0.4, 0.27), smoothstep(0.04, 1, wear).mul(0.7));
  // Build-mode hex grid.
  const w = fwidth(edge).mul(1.4);
  const line = float(1).sub(smoothstep(0, w.add(0.02), edge));
  c = mix(c, c.mul(0.55).add(vec3(0.06, 0.05, 0.02)), line.mul(uGrid).mul(0.85));
  // Seasons: grass goes gold in autumn; mud darkens; snow lies white on the flatter ground.
  const luma = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, vec3(0.62, 0.48, 0.22).mul(luma.mul(1.9).add(0.1)), autumn.mul(green).mul(0.9));
  c = c.mul(float(1).sub(mud.mul(0.28)));
  const snowCover = smoothstep(0.08, 0.55, snow).mul(float(1).sub(smoothstep(0.35, 0.6, slope)));
  c = mix(c, vec3(0.9, 0.93, 0.97), snowCover.mul(0.95));
  // Fog of war: remembered land a little faded, unexplored land dark and grey.
  const grey = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, mix(vec3(grey), c, 0.7).mul(0.86), smoothstep(0.1, 0.5, fog));
  c = mix(c, mix(vec3(grey), c, 0.3).mul(0.1).add(vec3(0.008, 0.011, 0.02)), smoothstep(0.55, 1, fog));
  mat.vertexColors = false;
  mat.colorNode = vec4(c, 1);
  const out = mat as PainterlyMaterial & { userData: { uniforms: { uGrid: THREE.UniformNode<"float", number> } } };
  out.userData.uniforms = { uGrid };
  return out;
}
