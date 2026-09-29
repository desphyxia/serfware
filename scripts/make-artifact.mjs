// Turns the single-file Vite build into a page body for publishing as a claude.ai artifact:
// the artifact host supplies <!doctype>, <html>, <head> and <body>, so we keep only the title,
// styles, the app root and the inlined scripts. Output: artifacts/seedfall.html
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("dist-single/index.html", "utf8");
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);

const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? "<title>Seedfall</title>";
const styles = pick(/<style[\s\S]*?<\/style>/g);
const scripts = pick(/<script[\s\S]*?<\/script>/g);
const page = [
  title,
  ...styles,
  "<style>html,body{height:100%;margin:0;background:#10141e;overflow:hidden}</style>",
  '<div id="app"></div>',
  ...scripts,
].join("\n");

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/seedfall.html", page);
console.log(`artifacts/seedfall.html ${(page.length / 1024).toFixed(0)} KB`);
