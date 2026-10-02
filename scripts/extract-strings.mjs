// Lists the interface texts in the code (t("…") and tr("…")) and how much of each language is done.
// Usage: node scripts/extract-strings.mjs [--write]   (--write refreshes src/locales/template.json)
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

export function extract() {
  const found = new Map();
  const re = /\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of walk("src")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) found.set(JSON.parse(`"${m[1]}"`), file);
  }
  // Texts that are shown through t(variable) at a place that cannot be seen here.
  for (const g of ["Game", "Camera", "Tools", "Panels", "spring", "summer", "autumn", "winter", "left", "right"]) if (!found.has(g)) found.set(g, "src/ui");
  return found;
}

if (process.argv[1]?.endsWith("extract-strings.mjs")) {
  const found = extract();
  const keys = [...found.keys()].sort();
  console.log(`${keys.length} texts in the code`);
  if (process.argv.includes("--write")) {
    mkdirSync("src/locales", { recursive: true });
    writeFileSync("src/locales/template.json", JSON.stringify(Object.fromEntries(keys.map((k) => [k, ""])), null, 1) + "\n");
    console.log("wrote src/locales/template.json");
  }
  for (const f of existsSync("src/locales") ? readdirSync("src/locales") : []) {
    if (f === "template.json" || !f.endsWith(".json")) continue;
    const cat = JSON.parse(readFileSync(join("src/locales", f), "utf8"));
    const done = keys.filter((k) => cat[k]).length;
    const stale = Object.keys(cat).filter((k) => !found.has(k));
    console.log(`${f}: ${done}/${keys.length} translated (${Math.round((done / keys.length) * 100)}%)${stale.length ? `, ${stale.length} no longer in the code` : ""}`);
  }
}
