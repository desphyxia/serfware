import * as THREE from "three/webgpu";
import { attribute, mrt, normalize, positionLocal, vec4 } from "three/tsl";
import { waterNodes, type WaterUniforms } from "./waterShade";

export type { WaterUniforms } from "./waterShade";

/** The sea: still, wide water with large ripples. See `waterNodes` for the shading. */
export function makeWaterMaterial(u: WaterUniforms): THREE.MeshBasicNodeMaterial & { userData: { u: WaterUniforms } } {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const { color, glint } = waterNodes(u, { fog: attribute("aFog", "float"), scale: 1 });
  mat.colorNode = color;
  // Tides lift the sea near the Tidewater flats (aTide weights it, 0 on other coasts).
  // A terraformed world's seas rise everywhere.
  mat.positionNode = positionLocal.add(normalize(positionLocal).mul(u.tideLift.mul(attribute("aTide", "float")).add(u.seaRise)));
  // Sun glints sparkle through bloom.
  mat.mrtNode = mrt({ emissive: vec4(glint.mul(0.6), 1) });
  const out = mat as THREE.MeshBasicNodeMaterial & { userData: { u: WaterUniforms } };
  out.userData.u = u;
  return out;
}
