import { defineConfig } from "vitest/config";

/** The soak run: long all-AI games, kept out of the normal test run (npm run soak). */
export default defineConfig({
  test: {
    include: ["soak/**/*.soak.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
  },
});
