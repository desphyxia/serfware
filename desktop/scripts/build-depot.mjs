// Build depot-ready folders for Steam: the web game (single file) inside an Electron shell with
// steamworks.js, one folder per platform under desktop/dist/depot-<platform>.
// Usage: node scripts/build-depot.mjs [--skip-web] [--platforms=linux,win32] [--dev]
// --dev also writes steam_appid.txt (480) beside the executable so it runs outside Steam.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const platforms = (flag("platforms")?.split("=")[1] ?? "linux,win32").split(",");

// 1. The game: one self-contained HTML file.
if (!flag("skip-web")) execSync("npm run build:single", { cwd: root, stdio: "inherit" });
const web = join(root, "dist-single", "index.html");
if (!existsSync(web)) throw new Error("dist-single/index.html is missing: run npm run build:single in the repository root.");
mkdirSync(join(here, "app"), { recursive: true });
copyFileSync(web, join(here, "app", "index.html"));

// 2. The shell, per platform. steamworks.js ships native modules: keep them outside the asar.
const { packager } = await import("@electron/packager");
const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;
for (const platform of platforms) {
  const out = join(here, "dist", "build");
  const [dir] = await packager({
    dir: here,
    out,
    name: "Seedfall",
    executableName: "seedfall",
    platform,
    arch: "x64",
    appVersion: version,
    overwrite: true,
    prune: true,
    asar: { unpack: "**/*.node" },
    ignore: [/^\/dist($|\/)/, /^\/scripts($|\/)/, /^\/steam($|\/)/, /^\/steam_appid\.txt$/, /^\/\.gitignore$/],
  });
  const depot = join(here, "dist", `depot-${platform}`);
  rmSync(depot, { recursive: true, force: true });
  execSync(`cp -R "${dir}" "${depot}"`);
  if (flag("dev")) writeFileSync(join(depot, "steam_appid.txt"), "480\n");
  console.log(`Depot ready: ${depot}`);
}
