import * as THREE from "three";

/** Player colours: flags, borders and lantern light. Player 0 keeps the warm amber. */
export const PLAYER_HEX = ["#f0b25a", "#6fc3e0", "#e57a9a", "#a4d86a", "#b58ae8", "#e8e070", "#ff8c5a", "#7ae0b8"];
export const PLAYER_COLORS = PLAYER_HEX.map((h) => new THREE.Color(h));

export function playerColor(owner: number): THREE.Color {
  return PLAYER_COLORS[owner % PLAYER_COLORS.length] as THREE.Color;
}
