import * as THREE from "three/webgpu";
import { palette, PALETTES, playerHex } from "../core/access";

/** Player colours: flags, borders and lantern light. Player 0 keeps the warm amber. */
export const PLAYER_HEX: string[] = PALETTES.default.players.slice();
export const PLAYER_COLORS = PLAYER_HEX.map((h) => new THREE.Color(h));

/** Put the colours of the chosen palette in place (once, at start-up: the colours are shared objects). */
export function applyPlayerPalette(): void {
  PLAYER_HEX.forEach((_, i) => {
    PLAYER_HEX[i] = playerHex(i);
    (PLAYER_COLORS[i] as THREE.Color).set(PLAYER_HEX[i] as string);
  });
  void palette;
}

export function playerColor(owner: number): THREE.Color {
  return PLAYER_COLORS[owner % PLAYER_COLORS.length] as THREE.Color;
}
