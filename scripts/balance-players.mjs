// Turns <out>/players.jsonl (the `players` suite of balance-sweep.mjs) into <out>/players.md: per (size, players) cell, how
// the land is used and how much of the resources on the map the AI seats got out and used. Usage:
//   node scripts/balance-players.mjs [--out balance-out]
// Needs the `flow` data of soak/balance/probe.ts. Cells show the median over games, with the 10th to 90th percentile
// in brackets where it helps; "seat" figures pool the AI seats of the games (player 0, the steward seat, is not measured).
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "balance-out";
const games = readFileSync(`${OUT}/players.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (!games.length) throw new Error(`no games in ${OUT}/players.jsonl`);

const q = (a, p) => {
  const s = a.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.round((s.length - 1) * p)] : null;
};
const med = (a) => q(a, 0.5);
const num = (x, d = 0) => (x === null ? "–" : x.toFixed(d));
const pct = (x) => (x === null ? "–" : `${(x * 100).toFixed(0)}%`);
const range = (a, d = 0) => (q(a, 0.5) === null ? "–" : `${num(q(a, 0.5), d)} (${num(q(a, 0.1), d)}–${num(q(a, 0.9), d)})`);
const ratio = (a, b) => (a !== null && b > 0 ? a / b : null);

const SIZES = ["tiny", "small", "medium", "large", "huge"];
const cellOf = (g) => `${g.spec.size}-${g.spec.personalities.length + 1}`;
const cells = [...new Set(games.map(cellOf))].sort((a, b) => {
  const [sa, pa] = a.split("-");
  const [sb, pb] = b.split("-");
  return SIZES.indexOf(sa) - SIZES.indexOf(sb) || Number(pa) - Number(pb);
});
const label = (c) => `${c.split("-")[0]}, ${c.split("-")[1]} players`;

/** Per game and per seat figures; every figure is computed from the record alone. */
function measure(g) {
  const F = g.flow;
  const rivals = g.spec.personalities.length;
  const last = g.days.length - 1;
  const L = F.landDay.length - 1; // end of the last day
  const at = (d) => Math.min(d, last);
  const goodIx = (n) => g.goods.indexOf(n);
  const hi = F.seatDayFields.indexOf("hungry");
  const ai = F.seatDayFields.indexOf("alive");
  const seat = [];
  for (let s = 0; s < rivals; s++) {
    const built = g.days.map((d) => d[s].built);
    const final = built[last];
    let plateau = last;
    for (let d = 0; d <= last; d++) if (built[d] >= 0.9 * final) { plateau = d; break; }
    let hungry = 0;
    let n = 0;
    for (let d = 30; d <= last; d++) {
      const row = F.seatDay[d]?.[s];
      if (!row || !row[ai]) continue;
      hungry += row[hi];
      n++;
    }
    const lu = F.landDay[L][s];
    seat.push({
      b20: built[at(20)], b40: built[at(40)], b60: built[at(60)], bEnd: final,
      p20: g.days[at(20)][s].people, p60: g.days[at(60)][s].people, pEnd: g.days[last][s].people,
      plateau, hungry: n ? hungry / n : null, hungryDays: hungry, standingDays: n,
      t10: F.landDay[Math.min(11, L)][s][0], t30: F.landDay[Math.min(31, L)][s][0], tEnd: lu[0],
      use: lu.slice(1).map((v) => ratio(v, lu[0])),
    });
  }
  // Land: every player's land at the end against the land on the map.
  const claimed = F.landDay[L].reduce((n, r) => n + r[0], 0);
  const free = F.landTiles - claimed;
  // Resources over the whole map and inside the AI seats' borders.
  const R = F.resourceFields;
  const ri = (n) => R.indexOf(n);
  const mapStart = F.mapDay[0];
  const inAi = (day, name) => {
    let v = 0;
    for (let s = 0; s < rivals; s++) v += F.resDay[day][s][ri(name)];
    return v;
  };
  const made = (building) => F.producedBy.reduce((n, p) => n + (p[building] ?? 0), 0);
  const sumGood = (key, name) => {
    const i = goodIx(name);
    let v = 0;
    for (const day of F[key]) for (let s = 0; s < rivals; s++) {
      const p = day[s] ?? [];
      for (let k = 0; k < p.length; k += 2) if (p[k] === i) v += p[k + 1];
    }
    return v;
  };
  const stockOf = (name) => {
    let v = 0;
    for (let s = 0; s < rivals; s++) v += g.days[last][s].stock[goodIx(name)];
    return v;
  };
  /**
   * One resource: what lay on the map (the sum of `fields`), what the AI seats took out (units made by `buildings`) and
   * what became of the good they made. `uses` is false where several resources make one good, so its fate is read once.
   */
  const resource = (name, fields, buildings, good, uses = true) => {
    const channel = (key) => sumGood(key, good);
    const sum = (f) => fields.reduce((n, x) => n + f(x), 0);
    return {
      name,
      onMap: sum((f) => mapStart[ri(f)]),
      aiStart: sum((f) => inAi(0, f)),
      aiEnd: sum((f) => inAi(L, f)),
      taken: buildings.reduce((n, b) => n + made(b), 0),
      used: uses ? channel("usedBuild") + channel("usedInput") + channel("usedFood") + channel("usedUpkeep") + channel("usedGear") + channel("usedMine") : null,
      lost: uses ? sumGood("lost", good) : null,
      stock: uses ? stockOf(good) : null,
    };
  };
  const resources = [
    resource("stone, all (rock and granite)", ["rockUnits", "granite"], ["quarry", "granitemine"], "stone"),
    resource("  of it, rock (quarries)", ["rockUnits"], ["quarry"], "stone", false),
    resource("  of it, granite (granite mines)", ["granite"], ["granitemine"], "stone", false),
    resource("logs (trees fit to fell)", ["fellable"], ["woodcutter"], "log"),
    resource("coal", ["coal"], ["coalmine"], "coal"),
    resource("iron ore", ["ironore"], ["ironmine"], "ironore"),
    resource("gold ore", ["goldore"], ["goldmine"], "goldore"),
    resource("fish", ["fish"], ["fisher"], "fish"),
  ];
  return { g, rivals, players: rivals + 1, landTiles: F.landTiles, claimed, free, seat, resources, ai: g.ai ?? [] };
}

const byCell = new Map(cells.map((c) => [c, []]));
for (const g of games) {
  if (!g.flow || !g.flow.landDay) throw new Error(`${g.spec.id} has no land data: it was made before the probe recorded it`);
  byCell.get(cellOf(g)).push(measure(g));
}

const md = [];
const out = (s = "") => md.push(s);
const ai = games[0].ai?.length ? games[0].ai.join(",") : "none";
out("# Players and land");
out("");
out(`${games.length} games, AI switches on: ${ai}. Medians over games, with the 10th–90th percentile in brackets; per-seat figures pool the AI seats. Player 0 (the steward seat) counts as a player and is not measured.`);
out("");

// 1. The cells.
out("## Cells");
out("");
out("| Cell | Games | AI seats | Days | Land tiles on the map | Land per player |");
out("|---|---|---|---|---|---|");
for (const c of cells) {
  const m = byCell.get(c);
  out(`| ${label(c)} | ${m.length} | ${m[0].rivals} | ${m[0].g.days.length} | ${range(m.map((x) => x.landTiles))} | ${range(m.map((x) => x.landTiles / x.players))} |`);
}
out("");

// 2. Growth.
out("## Growth, per AI seat");
out("");
out("Hungry is pooled over the seat-days from day 30 on (a seat-day is hungry when the stores held less food than the people need at the daily meal); a median of per-seat shares hides the seats that starve.");
out("");
out("| Cell | Buildings d20 | d40 | d60 | end | People d20 | d60 | end | Day buildings reach 90% of final | Hungry seat-days, days 30+ |");
out("|---|---|---|---|---|---|---|---|---|---|");
for (const c of cells) {
  const s = byCell.get(c).flatMap((x) => x.seat);
  out(`| ${label(c)} | ${range(s.map((x) => x.b20))} | ${range(s.map((x) => x.b40))} | ${range(s.map((x) => x.b60))} | ${range(s.map((x) => x.bEnd))} | ${range(s.map((x) => x.p20))} | ${range(s.map((x) => x.p60))} | ${range(s.map((x) => x.pEnd))} | ${range(s.map((x) => x.plateau))} | ${pct(ratio(s.reduce((n, x) => n + x.hungryDays, 0), s.reduce((n, x) => n + x.standingDays, 0)))} |`);
}
out("");

// 3. Land use.
out("## Land");
out("");
out("The map's land at the end of the game, claimed by everyone (players 0 and the AI seats) and left free; and each AI seat's own land by day and by use.");
out("");
out("| Cell | Claimed by all | Free on the map | Territory d10 | d30 | end | Built on (buildings, roads, flags) | Blocked | Field | Tree | Rock | Other growth | Too steep | Open |");
out("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const LF = ["building", "road", "flag", "blocked", "field", "tree", "rock", "other", "steep", "open"];
for (const c of cells) {
  const m = byCell.get(c);
  const s = m.flatMap((x) => x.seat);
  const share = (...names) => med(s.map((x) => names.reduce((n, k) => n + (x.use[LF.indexOf(k)] ?? 0), 0)));
  out(`| ${label(c)} | ${pct(med(m.map((x) => x.claimed / x.landTiles)))} | ${pct(med(m.map((x) => x.free / x.landTiles)))} | ${range(s.map((x) => x.t10))} | ${range(s.map((x) => x.t30))} | ${range(s.map((x) => x.tEnd))} | ${pct(share("building", "road", "flag"))} | ${pct(share("blocked"))} | ${pct(share("field"))} | ${pct(share("tree"))} | ${pct(share("rock"))} | ${pct(share("other"))} | ${pct(share("steep"))} | ${pct(share("open"))} |`);
}
out("");

// 4. Resources.
out("## Resources");
out("");
out("For each resource: what lay on the whole map at the start, what lay inside the AI seats' borders at the end, what the AI seats took out (units made by the gathering building), and what became of it. `Of the map` is taken ÷ on the map at the start; `of what lay in reach` is taken ÷ (taken + what still lay inside the AI seats' borders at the end), so it ignores land they never claimed. Used is the part spent on building, as inputs to other buildings, as meals, as upkeep or as tools and mine rations; lost is destroyed or left on the road; stock is what was in the warehouses at the end. Rock, ore and fish are used up as they are taken (fish may be restocked by the engine; trees grow back), so the share for logs can pass 100%, and for logs `of what lay in reach` shows regrowth, not running out. Every seat also starts with some goods in its stores, so Used can pass 100% of what was taken. The ore deposits count every load under the ground in a border, found by a geologist or not.");
out("");
const names = byCell.get(cells[0])[0].resources.map((r) => r.name);
names.forEach((name, i) => {
  out(`### ${name.trim()}`);
  out("");
  out("| Cell | On the map at the start | In AI borders at the end | Taken by the AI seats | Of the map | Of what lay in reach | Used | Lost | In stock at the end |");
  out("|---|---|---|---|---|---|---|---|---|");
  for (const c of cells) {
    const r = byCell.get(c).map((x) => x.resources[i]);
    out(`| ${label(c)} | ${range(r.map((x) => x.onMap))} | ${range(r.map((x) => x.aiEnd))} | ${range(r.map((x) => x.taken))} | ${pct(med(r.map((x) => ratio(x.taken, x.onMap))))} | ${pct(med(r.map((x) => ratio(x.taken, x.taken + x.aiEnd))))} | ${pct(med(r.map((x) => ratio(x.used, x.taken))))} | ${pct(med(r.map((x) => ratio(x.lost, x.taken))))} | ${pct(med(r.map((x) => ratio(x.stock, x.taken))))} |`);
  }
  out("");
});
out("Rock and granite both make stone, so the use of stone is read once, on the combined row; the two rows under it show only what lay there and what was taken.");
out("");

const text = md.join("\n") + "\n";
writeFileSync(`${OUT}/players.md`, text);
console.log(text);
console.log(`written ${OUT}/players.md`);
