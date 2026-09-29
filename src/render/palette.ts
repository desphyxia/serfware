import * as THREE from "three/webgpu";
import { Biome } from "../sim/planet/terrain";

/** Ground colours per placeholder biome: [base, variation]. Tuned for warm, painterly light. */
const BIOME_COLORS: Record<Biome, [string, string]> = {
  [Biome.DeepSea]: ["#1f3b4a", "#243f52"],
  [Biome.Sea]: ["#3c5f5e", "#46695f"],
  [Biome.Shallows]: ["#8f8a66", "#a39b72"],
  [Biome.Beach]: ["#dccb95", "#e8d9a6"],
  [Biome.Meadow]: ["#7fa653", "#98b85e"],
  [Biome.Forest]: ["#557f3f", "#6b9148"],
  [Biome.DeepForest]: ["#3c6436", "#4a7340"],
  [Biome.Steppe]: ["#b3a76a", "#c4b577"],
  [Biome.Marsh]: ["#5f7a4c", "#6f8a57"],
  [Biome.Rock]: ["#8d8479", "#a0978a"],
  [Biome.Snow]: ["#eef2f4", "#ffffff"],
  [Biome.Tundra]: ["#9a9f86", "#aeb199"],
  [Biome.Desert]: ["#d9b27a", "#e6c28b"],
};

const cache = new Map<Biome, [THREE.Color, THREE.Color]>();

export function biomeColor(b: Biome, variation: number, out: THREE.Color): THREE.Color {
  let pair = cache.get(b);
  if (!pair) {
    const [a, v] = BIOME_COLORS[b];
    pair = [new THREE.Color(a), new THREE.Color(v)];
    cache.set(b, pair);
  }
  return out.copy(pair[0]).lerp(pair[1], variation);
}

/** Cheap per-tile hash in [0, 1) for colour variation. */
export function tileHash(t: number): number {
  let h = Math.imul(t ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
