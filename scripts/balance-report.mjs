// Turns balance-out/*.jsonl into balance-out/report.md: per suite, per group of tags, medians with p10 and p90
// over seeds. Usage: node scripts/balance-report.mjs [--out balance-out]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const i = process.argv.indexOf("--out");
const OUT = i >= 0 ? process.argv[i + 1] : "balance-out";
const q = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (k - lo);
};
const f = (n) => (Number.isNaN(n) ? "-" : Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
const stat = (xs) => `${f(q(xs, 0.5))} (${f(q(xs, 0.1))}–${f(q(xs, 0.9))})`;
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const files = existsSync(OUT) ? readdirSync(OUT).filter((n) => n.endsWith(".jsonl")) : [];
const md = ["# Balance report", "", "Each cell is the median over seeds with the 10th–90th percentile range in brackets. Rivals of the same group are pooled (3 seats per game).", ""];
let total = 0;
let wall = 0;

for (const file of files) {
  const recs = readFileSync(`${OUT}/${file}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (!recs.length) continue;
  total += recs.length;
  wall += recs.reduce((a, r) => a + r.wallMs, 0);
  const suite = recs[0].spec.suite;
  const groups = new Map();
  for (const r of recs) {
    const key = Object.entries(r.spec.tags).map(([k, v]) => `${k}=${v}`).join(", ");
    (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
  }
  md.push(`## ${suite}`, "", `${recs.length} games, ${[...new Set(recs.map((r) => r.spec.seed))].length} seeds, up to ${recs[0].spec.days} days.`, "");
  const rows = [];
  const goodStats = [];
  const broken = [];
  const kinds = {};
  let capped = 0;
  for (const [key, rs] of [...groups].sort()) {
    const days = rs[0].spec.days;
    const at = (d) => rs.flatMap((r) => (r.days[Math.min(d, r.days.length) - 1] ?? []));
    const checkpoints = [10, 20, 40, 60].filter((d) => d <= days);
    const end = rs.flatMap((r) => r.days[r.days.length - 1] ?? []);
    const ended = rs.filter((r) => r.winner >= 0);
    rows.push([
      key,
      String(rs.length),
      ...checkpoints.map((d) => stat(at(d).map((s) => s.built))),
      stat(end.map((s) => s.people)),
      stat(end.map((s) => s.glow)),
      stat(end.map((s) => s.idle * 100)) + "%",
      stat(rs.map((r) => r.captures)),
      stat(rs.map((r) => r.fallen)),
      `${ended.length}/${rs.length}` + (ended.length ? ` (day ${f(q(ended.map((r) => r.endDay), 0.5))})` : ""),
    ]);
    // Goods: share of rival-days with none in the warehouses, and the median stock at the end.
    const names = rs[0].goods;
    const zero = names.map((_, g) => {
      let n = 0;
      let all = 0;
      for (const r of rs) for (const day of r.days) for (const s of day) { all++; if ((s.stock[g] ?? 0) === 0) n++; }
      return all ? n / all : 0;
    });
    const worst = names.map((n, g) => ({ n, z: zero[g], end: q(end.map((s) => s.stock[g] ?? 0), 0.5) })).filter((x) => x.z > 0.5).sort((a, b) => b.z - a.z).slice(0, 8);
    goodStats.push(`- **${key}**: goods missing from the warehouses more than half the time: ` + (worst.length ? worst.map((x) => `${x.n} ${Math.round(x.z * 100)}%`).join(", ") : "none"));
    for (const r of rs) {
      for (const b of r.broken) broken.push(`${r.spec.id}: ${b}`);
      if (r.brokenTotal === undefined) capped++;
      if (!r.broken.length) continue;
      // Older records have only the capped list: count its kinds, the day prefix dropped.
      const own = r.brokenKinds ?? r.broken.reduce((m, b) => { const k = b.replace(/^day \d+: /, "").replace(/\d+/g, "#"); m[k] = (m[k] ?? 0) + 1; return m; }, {});
      for (const [kind, n] of Object.entries(own)) {
        const shown = r.broken.find((b) => b.replace(/^day \d+: /, "").replace(/\d+/g, "#") === kind) ?? r.broken[0];
        const k = (kinds[kind] ??= { n: 0, games: 0, example: `${r.spec.id}: ${shown}`.replaceAll("|", "\\|") });
        k.n += n;
        k.games++;
      }
    }
  }
  const cps = [10, 20, 40, 60].filter((d) => d <= recs[0].spec.days);
  md.push(table(["group", "games", ...cps.map((d) => `buildings d${d}`), "people end", "glow end", "idle workplaces", "captures", "seats fallen", "ended with winner"], rows), "");
  md.push("Goods with no stock:", "", ...goodStats, "");
  if (broken.length) {
    const pairs = Object.values(kinds).reduce((a, k) => a + k.n, 0);
    const games = new Set(broken.map((b) => b.split(": ")[0])).size;
    md.push(`Rule violations: ${games} games with at least one` + (pairs ? `, ${pairs} (day, message) pairs in all` : "") + (capped ? `; ${capped} records from an older harness keep only the first 10 per game, so their counts are lower bounds` : "") + ".", "");
    if (pairs) md.push(table(["rule (numbers replaced by #)", "pairs", "games", "first example"], Object.entries(kinds).sort((a, b) => b[1].n - a[1].n).map(([kind, k]) => [kind, k.n, k.games, k.example])), "");
    else md.push(...broken.slice(0, 10).map((b) => `- ${b}`), "");
  } else md.push("No rule violations in the daily checks.", "");
}
md.push("---", `${total} games, ${Math.round(wall / 60000)} CPU-minutes.`);
writeFileSync(`${OUT}/report.md`, md.join("\n") + "\n");
console.log(`${OUT}/report.md (${total} games)`);
