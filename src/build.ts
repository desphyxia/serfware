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
