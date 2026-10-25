declare const __LATTICE_DEFAULT__: boolean;
declare const __BUILD_ID__: string;
declare const __BUILD_DATE__: string;

/** Build identity baked in by Vite at build time. Shown on the bug line and in every report. */
export const BUILD = {
  id: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev",
  date: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "unknown",
};

/** Preview builds (SEEDFALL_LATTICE=1): every new world starts on PREVIEW_SEED. */
export const LATTICE_DEFAULT: boolean = typeof __LATTICE_DEFAULT__ === "boolean" ? __LATTICE_DEFAULT__ : false;

/** Lattice preview builds always start on this seed, so what is on screen is known. */
export const PREVIEW_SEED: string | null = LATTICE_DEFAULT ? "quiet-cairn-171" : null;

/** New worlds have lattice roads unless the page is opened with `?lattice=0` (the tile-centre roads); on by default since #181. */
export function latticeRequested(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("lattice");
    return q !== "0";
  } catch {
    return false;
  }
}
