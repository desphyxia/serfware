import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(({ mode }) => {
  const single = mode === "single";
  const dirty = (() => {
    try {
      return execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() ? "+" : "";
    } catch {
      return "";
    }
  })();
  return {
    base: "./",
    define: {
      __BUILD_ID__: JSON.stringify(gitSha() + dirty),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? "dist-single" : "dist",
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    server: { host: true },
  };
});
