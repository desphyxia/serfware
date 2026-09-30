import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nonDeterministicMath = ["random", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "log", "log2", "log10", "pow", "sinh", "cosh", "tanh", "cbrt", "expm1", "log1p", "hypot"].map(
  (property) => ({
    object: "Math",
    property,
    message: "Not deterministic across engines. Use src/sim/dmath.ts (or Rng for randomness).",
  }),
);

export default tseslint.config(
  { ignores: ["dist", "dist-single", "node_modules", "proposal", "artifacts", "desktop/dist", "desktop/app", "desktop/node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        performance: "readonly",
        location: "readonly",
        history: "readonly",
        screen: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // The simulation must stay deterministic and engine-agnostic (portable to other engines).
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["three", "three/*"], message: "src/sim must not depend on the renderer." },
            { group: ["../render/*", "../ui/*", "../core/*", "../game*", "../net/*"], message: "src/sim must not import outside src/sim." },
          ],
        },
      ],
      "no-restricted-properties": ["error", ...nonDeterministicMath, { object: "Date", property: "now", message: "Use simulation ticks." }],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "No browser APIs in src/sim." },
        { name: "document", message: "No browser APIs in src/sim." },
        { name: "performance", message: "Use simulation ticks." },
        { name: "localStorage", message: "No browser APIs in src/sim." },
      ],
    },
  },
  {
    // The Electron shell (desktop/): Node scripts, CommonJS in the main process and preload.
    files: ["desktop/**/*.cjs", "desktop/**/*.mjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable", __dirname: "readonly", Buffer: "readonly", process: "readonly", console: "readonly", setInterval: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  { files: ["desktop/**/*.mjs"], languageOptions: { sourceType: "module" } },
);
