/**
 * The viewer's fog of war, shared by the views that hide things in unexplored land.
 * `explored` is undefined when fog is off; `version` changes whenever the mask does.
 */
export interface FogMask {
  explored: Uint8Array | undefined;
  visible: Uint8Array | undefined;
  version: number;
}

export function hiddenAt(mask: FogMask, t: number): boolean {
  return !!mask.explored && mask.explored[t] !== 1;
}
