declare const __BUILD_ID__: string;
declare const __BUILD_DATE__: string;

/** Build identity baked in by Vite at build time. Shown on the bug line and in every report. */
export const BUILD = {
  id: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev",
  date: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "unknown",
};
