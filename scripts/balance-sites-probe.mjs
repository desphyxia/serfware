// Sums the JSON lines of soak/balance/sites.ts (one file per game) and prints Markdown: node scripts/balance-sites-probe.mjs <file>...
// What building sites waited for and why nothing was sent, where goods on their way sat, and the AI's house want. Read-only.
import { readFileSync } from "node:fs";

const games = process.argv
  .slice(2)
  .filter((f) => {
    try {
      return readFileSync(f, "utf8").trim().startsWith("{");
    } catch {
      return false;
    }
  })
  .map((f) => JSON.parse(readFileSync(f, "utf8")));
if (!games.length) throw new Error("no probe output");
console.log(`${games.length} games: ${games.map((g) => `${g.size}/${g.seed}`).join(", ")}\n`);
const sum = {};
for (const g of games) for (const [k, v] of Object.entries(g.counts)) sum[k] = (sum[k] ?? 0) + v;
const label = (b) => `d${b * 10}-${b * 10 + 9}`;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const blocks = [0, 1, 2, 3, 4, 5];
const table = (re, bs) => {
  const t = {};
  for (const b of bs) for (const [k, v] of Object.entries(sum)) {
    const m = k.match(new RegExp(`^${b}\\|${re}:(\\w+)\\|(.+)$`));
    if (m) {
      t[m[1]] ??= {};
      t[m[1]][m[2]] = (t[m[1]][m[2]] ?? 0) + v;
    }
  }
  return t;
};
const show = (t) => {
  for (const [good, why] of Object.entries(t)) {
    const total = Object.values(why).reduce((a, v) => a + v, 0);
    console.log(`- ${good} (${total} site-samples): ` + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([w, v]) => `${w} ${pct(v, total)}`).join(", "));
  }
};
console.log("## Seat-samples and the share at the AI's sites cap\n");
for (const b of blocks) console.log(`- ${label(b)}: ${sum[`${b}|seat-samples`] ?? 0} samples, at the cap ${pct(sum[`${b}|seat-at-cap`] ?? 0, sum[`${b}|seat-samples`])}`);
for (const [name, bs] of [["d0-9", [0]], ["d10-19", [1]], ["d20-59", [2, 3, 4, 5]]]) {
  console.log(`\n## Sites nothing was sent to, ${name}: material and why\n`);
  show(table("none", bs));
}
console.log("\n## Sites with the material on its way, d10-59: age of the oldest good\n");
show(table("transit", [1, 2, 3, 4, 5]));
console.log("\n## Of those, the ones over a day old: where the oldest good is\n");
show(table("transit-old", [1, 2, 3, 4, 5]));
console.log("\n## Of those lying on the site's own flag: whole days the oldest one had waited (site-samples, d10-59)\n");
const stuck = {};
for (const b of [1, 2, 3, 4, 5]) for (const [k, v] of Object.entries(sum)) {
  const m = k.match(new RegExp(`^${b}\\|stuck-days:(\\w+)\\|(\\d+)$`));
  if (m) {
    stuck[m[1]] ??= {};
    stuck[m[1]][m[2]] = (stuck[m[1]][m[2]] ?? 0) + v;
  }
}
for (const [good, byDays] of Object.entries(stuck)) console.log(`- ${good}: ` + Object.entries(byDays).sort((a, c) => Number(a[0]) - Number(c[0])).map(([d, v]) => `${d}${d === "6" ? "+" : ""} d: ${v}`).join(", "));
console.log("\n## Goods the supply loop re-aimed from a store to a building while they lay on a flag (whole game)\n");
for (const kind of ["redirected", "redirected-onto-own-flag"]) {
  const row = {};
  for (const [k, v] of Object.entries(sum)) {
    const m = k.match(new RegExp(`^${kind}:(\\w+)\\|(.+)$`));
    if (m) row[`${m[1]} ${m[2]}`] = v;
  }
  console.log(`- ${kind}: ` + (Object.entries(row).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"));
}
console.log("\n## Sites nothing was sent to, d10-59, by building type\n");
const bt = {};
for (const b of [1, 2, 3, 4, 5]) for (const [k, v] of Object.entries(sum)) {
  const m = k.match(new RegExp(`^${b}\\|none-by-type:(\\w+)\\|(.+)$`));
  if (m) bt[`${m[1]} / ${m[2]}`] = (bt[`${m[1]} / ${m[2]}`] ?? 0) + v;
}
for (const [k, v] of Object.entries(bt).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`- ${k}: ${v}`);
console.log("\n## A seat that wants a house with none open: is there a tile for one? (once a day)\n");
for (const b of blocks) {
  const yes = sum[`${b}|house-room:a house could be placed`] ?? 0;
  const no = sum[`${b}|house-room:no tile found`] ?? 0;
  const why = {};
  for (const [k, v] of Object.entries(sum)) {
    const m = k.match(new RegExp(`^${b}\\|house-room-no:(.+)$`));
    if (m) why[m[1]] = v;
  }
  const wt = Object.values(why).reduce((a, v) => a + v, 0);
  console.log(`- ${label(b)}: tile found ${yes}, none found ${no} (search stopped at 400 tiles ${sum[`${b}|house-room-stopped-at-400`] ?? 0} times)` + (no ? `; tiles examined in the seats with none: ` + Object.entries(why).sort((a, c) => c[1] - a[1]).map(([w, v]) => `${w} ${pct(v, wt)}`).join(", ") : ""));
}
console.log("\n## The AI's house want, per seat-sample\n");
for (const b of blocks) {
  const row = {};
  for (const [k, v] of Object.entries(sum)) {
    const m = k.match(new RegExp(`^${b}\\|house:(.+)$`));
    if (m) row[m[1]] = v;
  }
  const total = Object.values(row).reduce((a, v) => a + v, 0);
  console.log(`- ${label(b)} (${total}): ` + Object.entries(row).sort((a, c) => c[1] - a[1]).map(([w, v]) => `${w} ${pct(v, total)}`).join("; "));
}
