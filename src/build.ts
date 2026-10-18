declare const __LATTICE_DEFAULT__: boolean;
declare const __BUILD_ID__: string;
declare const __BUILD_DATE__: string;

/** Build identity baked in by Vite at build time. Shown on the bug line and in every report. */
export const BUILD = {
  id: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev",
  date: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "unknown",
};

/** Preview builds (SEEDFALL_LATTICE=1) start every solo world with lattice roads. */
export const LATTICE_DEFAULT: boolean = typeof __LATTICE_DEFAULT__ === "boolean" ? __LATTICE_DEFAULT__ : false;

/** Lattice preview builds always start on this seed, so what is on screen is known. */
export const PREVIEW_SEED: string | null = LATTICE_DEFAULT ? "quiet-cairn-171" : null;

/** Lattice roads are asked for with `?lattice=1`, or by default in preview builds (`?lattice=0` opts out). */
export function latticeRequested(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("lattice");
    return q === "1" || (LATTICE_DEFAULT && q !== "0");
  } catch {
    return false;
  }
}
