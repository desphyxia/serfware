// What holds building sites up, from the records of one balance run: node scripts/balance-sites.mjs <dir> [--size tiny|small]
// Reads <dir>/economy.jsonl (soak/balance/probe.ts `flow` field) and prints Markdown tables: the state of building
// sites by block of ten days, the warehouse stock of log, stone and plank at the end of each day, what was made against
// what building, upkeep and inputs used, and the stone and planks the placed buildings cost. Read-only.
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "balance-out";
const only = args.includes("--size") ? args[args.indexOf("--size") + 1] : null;
const content = JSON.parse(readFileSync(new URL("../src/sim/data/content.json", import.meta.url), "utf8"));
const cost = Object.fromEntries(content.buildings.map((b) => [b.id, b.cost ?? {}]));
const recs = readFileSync(`${dir}/economy.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.flow && (!only || r.spec.size === only));
if (!recs.length) throw new Error("no records with a flow field");
const G = recs[0].goods;
const gi = (n) => G.indexOf(n);
const BUCKET = recs[0].flow.bucketDays;
const NB = Math.ceil(Math.min(...recs.map((r) => r.days.length)) / BUCKET);
const label = (b) => `d${b * BUCKET}-${b * BUCKET + BUCKET - 1}`;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const f1 = (x) => (Math.round(x * 10) / 10).toString();
console.log(`# Building sites: ${dir}${only ? ` (${only})` : ""}\n\n${recs.length} games.\n`);

// 1. Site states by block.
const states = [];
for (let b = 0; b < NB; b++) states[b] = new Map();
for (const r of recs) for (let b = 0; b < NB; b++) for (const [k, n] of Object.entries(r.flow.sites[b] ?? {})) {
  const reason = k.split("|")[1];
  const key = reason.startsWith("no_builder") ? "no_builder" : reason;
  states[b].set(key, (states[b].get(key) ?? 0) + n);
}
const all = new Map();
for (const m of states) for (const [k, n] of m) all.set(k, (all.get(k) ?? 0) + n);
const totals = states.map((m) => [...m.values()].reduce((a, v) => a + v, 0));
const rows = [...all].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k);
console.log("## Site snapshots by state (share of the block's snapshots)\n");
console.log(`| state | ${states.map((_, b) => label(b)).join(" | ")} | all |\n|---|${states.map(() => "---|").join("")}---|`);
for (const k of rows) console.log(`| ${k} | ${states.map((m, b) => pct(m.get(k) ?? 0, totals[b])).join(" | ")} | ${pct(all.get(k), totals.reduce((a, v) => a + v, 0))} |`);
const sum = (pred) => states.map((m, b) => pct([...m].filter(([k]) => pred(k)).reduce((a, [, n]) => a + n, 0), totals[b]));
console.log(`| **waiting for a material** | ${sum((k) => k.startsWith("wait_")).join(" | ")} | ${pct([...all].filter(([k]) => k.startsWith("wait_")).reduce((a, [, n]) => a + n, 0), totals.reduce((a, v) => a + v, 0))} |`);
console.log(`| **for stone** | ${sum((k) => k.endsWith(":stone")).join(" | ")} | |`);
console.log(`| **for plank** | ${sum((k) => k.endsWith(":plank")).join(" | ")} | |`);
console.log(`| **for log** | ${sum((k) => k.endsWith(":log")).join(" | ")} | |`);
console.log(`| snapshots | ${totals.join(" | ")} | ${totals.reduce((a, v) => a + v, 0)} |\n`);

// 2. Stock at the end of each day, per standing seat-day.
console.log("## Warehouse stock at the end of the day (per standing seat-day)\n");
console.log("| good | " + Array.from({ length: NB }, (_, b) => `${label(b)} mean / none`).join(" | ") + " |\n|---|" + "---|".repeat(NB));
for (const g of ["log", "stone", "plank"]) {
  const cells = [];
  for (let b = 0; b < NB; b++) {
    let n = 0, s = 0, z = 0;
    for (const r of recs) for (let d = b * BUCKET; d < Math.min(r.days.length, (b + 1) * BUCKET); d++) for (let p = 0; p < r.days[d].length; p++) {
      if (!r.flow.seatDay[d][p][0]) continue;
      const v = r.days[d][p].stock[gi(g)];
      n++; s += v; if (v < 1) z++;
    }
    cells.push(`${f1(s / n)} / ${pct(z, n)}`);
  }
  console.log(`| ${g} | ${cells.join(" | ")} |`);
}
console.log("");

// 3. Made against used, per standing seat-day.
const spread = (sparse, g, out) => { for (let i = 0; i < sparse.length; i += 2) if (sparse[i] === g) out.v += sparse[i + 1]; };
console.log("## Made and used per standing seat-day\n");
console.log("| good | what | " + Array.from({ length: NB }, (_, b) => label(b)).join(" | ") + " |\n|---|---|" + "---|".repeat(NB));
for (const g of ["log", "plank", "stone"]) {
  for (const [what, field] of [["made", "produced"], ["building", "usedBuild"], ["upkeep", "usedUpkeep"], ["inputs", "usedInput"], ["lost", "lost"]]) {
    const cells = [];
    for (let b = 0; b < NB; b++) {
      let n = 0;
      const acc = { v: 0 };
      for (const r of recs) for (let d = b * BUCKET; d < Math.min(r.days.length, (b + 1) * BUCKET); d++) for (let p = 0; p < r.days[d].length; p++) {
        if (!r.flow.seatDay[d][p][0]) continue;
        n++;
        spread(r.flow[field][d][p], gi(g), acc);
      }
      cells.push(f1(acc.v / n));
    }
    console.log(`| ${g} | ${what} | ${cells.join(" | ")} |`);
  }
}
console.log("");

// 4. What the placed buildings cost, by type: units of stone and plank per seat over the game, and when.
const types = recs[0].flow.buildingIds;
const need = new Map();
let seats = 0;
const byBlock = { stone: Array(NB).fill(0), plank: Array(NB).fill(0) };
for (const r of recs) {
  const nSeats = r.days[0].length;
  seats += nSeats;
  for (const [t, , placed] of r.flow.buildings) {
    const id = types[t];
    const c = cost[id] ?? {};
    const e = need.get(id) ?? { n: 0, stone: 0, plank: 0, log: 0 };
    e.n++; e.stone += c.stone ?? 0; e.plank += c.plank ?? 0; e.log += c.log ?? 0;
    need.set(id, e);
    const b = Math.min(NB - 1, Math.floor(placed / BUCKET));
    byBlock.stone[b] += c.stone ?? 0;
    byBlock.plank[b] += c.plank ?? 0;
  }
}
console.log("## What the placed buildings cost (per seat over the game, from `cost` in content.json)\n");
console.log("| building | placed | stone | plank | log |\n|---|---|---|---|---|");
for (const [id, e] of [...need].sort((a, b) => b[1].stone - a[1].stone).slice(0, 12)) console.log(`| ${id} | ${f1(e.n / seats)} | ${f1(e.stone / seats)} | ${f1(e.plank / seats)} | ${f1(e.log / seats)} |`);
console.log(`\nStone the buildings placed in each block cost, per seat: ${byBlock.stone.map((v, b) => `${label(b)} ${f1(v / seats)}`).join(", ")}. Planks: ${byBlock.plank.map((v, b) => `${label(b)} ${f1(v / seats)}`).join(", ")}.`);

// 5. How much the AI places, and how much of its thinking is stopped at the sites cap (running counters, so per-day differences).
const F = recs[0].flow.seatDayFields;
const iT = F.indexOf("aiThoughts");
const iC = F.indexOf("aiCapped");
const iN = F.indexOf("aiNoIdle");
console.log("\n## Placements, and thoughts stopped at the sites cap (per block)\n");
console.log("| block | buildings placed per seat | thoughts | stopped at the sites cap | with no idle hands |\n|---|---|---|---|---|");
const placedBy = Array.from({ length: NB }, () => 0);
for (const r of recs) for (const [, , placed] of r.flow.buildings) placedBy[Math.min(NB - 1, Math.floor(placed / BUCKET))]++;
for (let b = 0; b < NB; b++) {
  let t = 0, c = 0, ni = 0;
  for (const r of recs) for (let p = 0; p < r.days[0].length; p++) for (let d = b * BUCKET; d < Math.min(r.days.length, (b + 1) * BUCKET); d++) {
    if (!r.flow.seatDay[d][p][0]) continue;
    const prev = d > 0 ? r.flow.seatDay[d - 1][p] : null;
    t += r.flow.seatDay[d][p][iT] - (prev ? prev[iT] : 0);
    c += r.flow.seatDay[d][p][iC] - (prev ? prev[iC] : 0);
    ni += r.flow.seatDay[d][p][iN] - (prev ? prev[iN] : 0);
  }
  console.log(`| ${label(b)} | ${f1(placedBy[b] / seats)} | ${t} | ${pct(c, t)} | ${pct(ni, t)} |`);
}

// 6. Days a building takes from placing to finishing, by placing block.
console.log("\n## Days from placing to finishing (median / 90th percentile), and sites never finished\n");
const quant = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
console.log("| building | " + Array.from({ length: NB }, (_, b) => `placed ${label(b)}`).join(" | ") + " |\n|---|" + "---|".repeat(NB));
for (const kind of ["house", "farm", "woodcutter", "flowerbed"]) {
  const cells = [];
  for (let b = 0; b < NB; b++) {
    const t = [];
    let n = 0;
    for (const r of recs) for (const [ty, , placed, finished] of r.flow.buildings) {
      if (types[ty] !== kind || Math.floor(placed / BUCKET) !== b) continue;
      n++;
      if (finished >= placed) t.push(finished - placed);
    }
    cells.push(n ? `${f1(quant(t, 0.5))} / ${f1(quant(t, 0.9))} (${n - t.length} of ${n} unfinished)` : "-");
  }
  console.log(`| ${kind} | ${cells.join(" | ")} |`);
}

// 7. Seat by seat at the end: what goes with how much a seat built.
const G2 = recs[0].goods;
const sparse = (arr, g) => {
  let v = 0;
  for (let i = 0; i < arr.length; i += 2) if (arr[i] === g) v += arr[i + 1];
  return v;
};
const iTerr = F.indexOf("territory");
const seatRows = [];
for (const r of recs) {
  const last = r.days.length - 1;
  for (let p = 0; p < r.days[0].length; p++) {
    if (!r.flow.seatDay[last][p][0]) continue;
    let stone = 0, plank = 0, log = 0;
    for (let d = 0; d <= last; d++) {
      stone += sparse(r.flow.produced[d][p], G2.indexOf("stone"));
      plank += sparse(r.flow.produced[d][p], G2.indexOf("plank"));
      log += sparse(r.flow.produced[d][p], G2.indexOf("log"));
    }
    const rock = r.flow.rockDay[0][p];
    seatRows.push({ built: r.days[last][p].built, people: r.days[last][p].people, stone, plank, log, rockMat0: rock ? rock[1] : 0, terr0: r.flow.seatDay[0][p][iTerr], terr: r.flow.seatDay[last][p][iTerr] });
  }
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const corr = (xs, ys) => {
  const mx = avg(xs), my = avg(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
console.log(`\n## Seats standing at the end (${seatRows.length}): correlation with buildings and people at the end\n`);
console.log("| per seat | mean | r with buildings | r with people |\n|---|---|---|---|");
for (const [name, k] of [["stone made", "stone"], ["planks made", "plank"], ["logs made", "log"], ["rock material in the border at the start", "rockMat0"], ["territory at the start", "terr0"], ["territory at the end", "terr"]])
  console.log(`| ${name} | ${f1(avg(seatRows.map((s) => s[k])))} | ${corr(seatRows.map((s) => s[k]), seatRows.map((s) => s.built)).toFixed(2)} | ${corr(seatRows.map((s) => s[k]), seatRows.map((s) => s.people)).toFixed(2)} |`);
const byStone = seatRows.slice().sort((a, b) => a.stone - b.stone);
const qn = Math.floor(byStone.length / 4);
console.log("\nSeats by quarter of stone made:\n\n| quarter | stone made (mean) | buildings | people |\n|---|---|---|---|");
for (let i = 0; i < 4; i++) {
  const part = byStone.slice(i * qn, i === 3 ? undefined : (i + 1) * qn);
  console.log(`| ${i + 1} | ${f1(avg(part.map((s) => s.stone)))} | ${f1(avg(part.map((s) => s.built)))} | ${f1(avg(part.map((s) => s.people)))} |`);
}
