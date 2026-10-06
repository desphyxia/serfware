// Turns the `flow` field of balance-out/*.jsonl (soak/balance/probe.ts) into balance-out/flows.md: what is made
// and used, why workplaces idle, when and how fast things are built, how goods queue, people and food, and the
// war record. Games without a `flow` field are skipped.
// Usage: node scripts/balance-flows.mjs [--out balance-out] [--by <tag>]
//   --by splits every table by one tag of the suite (for example temper, level, size, mix).
// Days: "day d" is the window (startTick + d*dayTicks, startTick + (d+1)*dayTicks] (the world is already `startTick`
// ticks old when sampling starts, so the daily meal falls part way into a window, not at its end); "d0-9" is the
// first ten windows. Rates are per seat per window over seat-days where the seat was still standing, so fallen
// seats do not dilute them.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt("out", "balance-out");
const BY = opt("by", "");

const q = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (k - lo);
};
const num = (n) => (Number.isNaN(n) || n === undefined ? "-" : Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));
const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "-");
const div = (a, b) => (b > 0 ? a / b : NaN);
const sum = (xs) => xs.reduce((a, v) => a + v, 0);
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const get = (m, k) => m.get(k) ?? 0;

const CATS = [
  ["produced", "made"],
  ["usedInput", "inputs"],
  ["usedBuild", "building"],
  ["usedFood", "meals"],
  ["usedMine", "rations"],
  ["usedUpkeep", "upkeep"],
  ["usedGear", "arms given"],
  ["lost", "lost"],
];
const REASONS = ["working", "no_worker", "no_tool", "input", "output_blocked", "stranded", "exhausted", "no_target", "no_path", "other"];
const reasonClass = (r) => (r.startsWith("input:") ? "input" : r.startsWith("other:") ? "other" : r);
const siteClass = (r) => (r.startsWith("no_builder") ? r : r.split(":")[0]);
const SITE_REASONS = ["building", "no_builder:no_hammer", "no_builder:no_person", "no_builder:no_route", "dig", "finishing", "wait_transit", "wait_none"];

// Building types that only exist in colonies or are not placed by players are left out of "never built".
let colonyOnly = new Set();
try {
  const content = JSON.parse(readFileSync(new URL("../src/sim/data/content.json", import.meta.url), "utf8"));
  colonyOnly = new Set(content.buildings.filter((b) => b.buildable === false || b.terra || b.rail).map((b) => b.id));
} catch {
  // Without the content file every type is listed.
}

function analyse(recs, label, md) {
  const flow0 = recs[0].flow;
  const G = recs[0].goods;
  const B = flow0.buildingIds;
  const BD = flow0.bucketDays;
  const rivals = recs[0].spec.personalities.length;
  const seats = recs.length * rivals;
  const maxDays = Math.max(...recs.map((r) => r.flow.seatDay.length));
  const blocks = Math.ceil(maxDays / BD);
  const blockLabel = (b) => `d${b * BD}-${b * BD + BD - 1}`;
  const F = Object.fromEntries(flow0.seatDayFields.map((n, i) => [n, i]));

  // Seat-days where the seat stood, per block.
  const alive = new Array(blocks).fill(0);
  for (const r of recs) r.flow.seatDay.forEach((day, d) => day.forEach((s) => s[F.alive] && alive[Math.floor(d / BD)]++));

  md.push(`## ${label}`, "", `${recs.length} games, ${seats} rival seats, ${sum(alive)} standing seat-days.`, "");

  // 1. Production over time.
  const made = G.map(() => new Array(blocks).fill(0));
  const first = G.map(() => []);
  const ever = G.map(() => 0);
  for (const r of recs)
    for (let s = 0; s < rivals; s++) {
      const seen = new Array(G.length).fill(-1);
      r.flow.produced.forEach((day, d) => {
        const pairs = day[s];
        for (let i = 0; i < pairs.length; i += 2) {
          made[pairs[i]][Math.floor(d / BD)] += pairs[i + 1];
          if (seen[pairs[i]] < 0) seen[pairs[i]] = d;
        }
      });
      seen.forEach((d, g) => {
        if (d >= 0) {
          ever[g]++;
          first[g].push(d);
        }
      });
    }
  const madeGoods = G.map((_, g) => g).filter((g) => sum(made[g]) > 0).sort((a, b) => sum(made[b]) - sum(made[a]));
  const never = G.filter((_, g) => !sum(made[g]));
  md.push("### Units made per seat per day", "", table(["good", ...Array.from({ length: blocks }, (_, b) => blockLabel(b)), "seats that made it", "first made (median day)"], madeGoods.map((g) => [G[g], ...made[g].map((n, b) => num(div(n, alive[b]))), pct(ever[g] / seats), num(q(first[g], 0.5))])), "");
  md.push(`Never made by any seat: ${never.join(", ") || "none"}.`, "");

  // 2. Where goods go.
  const tot = Object.fromEntries(CATS.map(([k]) => [k, G.map(() => 0)]));
  for (const r of recs)
    for (const [k] of CATS)
      for (const day of r.flow[k] ?? [])
        for (const pairs of day) for (let i = 0; i < pairs.length; i += 2) tot[k][pairs[i]] += pairs[i + 1];
  const active = G.map((_, g) => g).filter((g) => CATS.some(([k]) => tot[k][g] > 0)).sort((a, b) => tot.produced[b] - tot.produced[a]);
  md.push("### Where goods go (mean units per seat over the whole game)", "", table(["good", ...CATS.map(([, n]) => n), "made - used - lost"], active.map((g) => [G[g], ...CATS.map(([k]) => num(tot[k][g] / seats)), num((tot.produced[g] - sum(CATS.slice(1, 7).map(([k]) => tot[k][g])) - tot.lost[g]) / seats)])), "");
  md.push("The last column is what piled up in stock or on the way; it can be negative for goods the seats started with (tools, building materials). Tools are not in this table: they are taken for a job and come back to the keep, so they are counted below.", "");

  // 2b. Tools: start, made, end, and how often they were taken.
  if (flow0.tools) {
    const start = G.map(() => 0);
    const end = G.map(() => 0);
    const taken = G.map(() => 0);
    for (const r of recs) {
      for (const day of r.flow.toolTaken) for (const pairs of day) for (let i = 0; i < pairs.length; i += 2) taken[pairs[i]] += pairs[i + 1];
      for (let s = 0; s < rivals; s++) {
        const p0 = r.flow.toolsStart[s] ?? [];
        for (let i = 0; i < p0.length; i += 2) start[p0[i]] += p0[i + 1];
        // The pool on the last day the seat stood.
        let last = -1;
        r.flow.seatDay.forEach((day, d) => day[s][F.alive] && (last = d));
        const p1 = last >= 0 ? r.flow.tools[last][s] : [];
        for (let i = 0; i < p1.length; i += 2) end[p1[i]] += p1[i + 1];
      }
    }
    const toolGoods = G.map((_, g) => g).filter((g) => start[g] + end[g] + taken[g] > 0);
    md.push("### Tools (mean per seat over the whole game)", "", table(["tool", "owned at the start", "made", "owned at the end", "wasted (start + made - end)", "taken for a job"], toolGoods.map((g) => [G[g], num(start[g] / seats), num(tot.produced[g] / seats), num(end[g] / seats), num((start[g] + tot.produced[g] - end[g]) / seats), num(taken[g] / seats)])), "");
    md.push("Owned means in a warehouse or in a worker's hand. A tool taken for a job returns to the keep when the worker goes home, so `taken` counts job starts (a builder takes a hammer for every building), not use-up. Where `wasted` is above zero, tools disappeared from the seat's pool (a worker's death, or a seat that fell).", "");
  }

  // 3. Producers.
  const units = new Map();
  const cycles = new Map();
  const finalN = new Map();
  const finalSeats = new Map();
  for (const r of recs) {
    r.flow.producedBy.forEach((m) => Object.entries(m).forEach(([k, n]) => bump(units, k, n)));
    r.flow.cycles.forEach((m) => Object.entries(m).forEach(([k, n]) => bump(cycles, k, n)));
    r.finalBuildings.forEach((m) => Object.entries(m).forEach(([k, n]) => (bump(finalN, k, n), bump(finalSeats, k))));
  }
  const producers = [...units.keys()].sort((a, b) => get(units, b) - get(units, a));
  md.push("### Producing buildings", "", table(["building", "seats with one at the end", "mean per seat at the end", "units made per seat", "craft cycles per seat"], producers.map((k) => [k, pct(get(finalSeats, k) / seats), num(get(finalN, k) / seats), num(get(units, k) / seats), get(cycles, k) ? num(get(cycles, k) / seats) : "-"])), "");
  const unbuilt = B.filter((k) => !finalSeats.has(k) && !colonyOnly.has(k));
  md.push(`Never standing at the end of any game (colony-only buildings left out): ${unbuilt.join(", ") || "none"}.`, "");

  // 4. Why workplaces idle.
  const idle = new Map();
  const inputKeys = new Map();
  const util = new Map();
  for (const r of recs) {
    for (const blk of r.flow.idle)
      for (const [key, n] of Object.entries(blk)) {
        const [type, reason] = key.split("|");
        if (!idle.has(type)) idle.set(type, new Map());
        bump(idle.get(type), reasonClass(reason), n);
        if (reason.startsWith("input:")) bump(inputKeys, key, n);
      }
    for (const blk of r.flow.util)
      for (const [type, [s, n]] of Object.entries(blk)) {
        const u = util.get(type) ?? [0, 0];
        util.set(type, [u[0] + s, u[1] + n]);
      }
  }
  const types = [...idle.keys()].sort((a, b) => sum([...idle.get(b).values()]) - sum([...idle.get(a).values()]));
  md.push("### Why workplaces stood idle (share of snapshots, four a day)", "", table(["workplace", "snapshots", "worked share of the day", ...REASONS], types.map((t) => {
    const m = idle.get(t);
    const n = sum([...m.values()]);
    const u = util.get(t);
    return [t, String(n), u ? pct(u[0] / u[1]) : "-", ...REASONS.map((r) => pct(get(m, r) / n))];
  })), "");
  md.push("`no_target`: a gatherer's search for something to work on (a tree, a rock, a field, fish, game) found nothing in reach and it is resting 60 ticks before trying again; `no_path`: it found a target but no walkable route. `other` is the rest between cycles, walking to work, and waits this probe does not see (cold bees, no daylight or tide, no sky island in reach). `worked share` is the time the worker was on the job (walking, working or hauling), from the day's own count.", "");
  if (flow0.search) {
    const searches = new Map();
    const perBlock = new Map();
    for (const r of recs)
      r.flow.search.forEach((blk, b) => {
        for (const [type, [n, miss]] of Object.entries(blk)) {
          const t = searches.get(type) ?? [0, 0];
          searches.set(type, [t[0] + n, t[1] + miss]);
          const row = perBlock.get(type) ?? Array.from({ length: blocks }, () => [0, 0]);
          row[b][0] += n;
          row[b][1] += miss;
          perBlock.set(type, row);
        }
      });
    const order = [...searches.keys()].sort((a, c) => searches.get(c)[1] - searches.get(a)[1]);
    md.push("Searches for something to work on (gatherers), and the share that found nothing:", "", table(["workplace", "searches per seat", "found nothing", ...Array.from({ length: blocks }, (_, b) => blockLabel(b))], order.map((t) => [t, num(searches.get(t)[0] / seats), pct(div(searches.get(t)[1], searches.get(t)[0])), ...perBlock.get(t).map(([n, miss]) => pct(div(miss, n)))])), "");
    md.push("A worker retries a failed search every 60 ticks and a successful one only after a whole work cycle, so the share of failed searches overstates the share of time spent looking; `no_target` in the table above is the time share.", "");
  }
  if (flow0.quarries) {
    // Per quarry: rock in reach when it was placed, and whether it later ran out. Rows from games played since the probe counted rock.
    const rows = recs.flatMap((r) => r.flow.quarries ?? []);
    if (rows.length) {
      const withRock = rows.filter((x) => x[2] > 0);
      const ranOut = rows.filter((x) => x[5] >= 0 && x[2] > 0);
      const neverHad = rows.filter((x) => x[2] === 0);
      const life = ranOut.map((x) => x[5] - x[1]).filter((d) => d >= 0);
      md.push(
        "Rock for the quarries (`Feature.Rock` with material left, within the quarry's radius):",
        "",
        table(["measure", "value"], [
          ["quarries placed per seat", num(rows.length / seats)],
          ["placed with no rock in reach", pct(neverHad.length / rows.length)],
          ["rock tiles in reach at placement (median, 10th-90th)", `${num(q(rows.map((x) => x[2]), 0.5))} (${num(q(rows.map((x) => x[2]), 0.1))}-${num(q(rows.map((x) => x[2]), 0.9))})`],
          ["material in reach at placement (median)", num(q(rows.map((x) => x[3]), 0.5))],
          ["rock tiles in the seat's territory at placement (median)", num(q(rows.map((x) => x[4]), 0.5))],
          ["placed with rock in reach that later ran out", pct(div(ranOut.length, withRock.length))],
          ["days from placement to running out (median, 10th-90th)", life.length ? `${num(q(life, 0.5))} (${num(q(life, 0.1))}-${num(q(life, 0.9))})` : "-"],
          ["quarries with no rock in reach at their last sample", pct(rows.filter((x) => x[6] === 0 && x[7] < 0).length / Math.max(1, rows.filter((x) => x[7] < 0).length))],
          ["quarries demolished or lost", pct(rows.filter((x) => x[7] >= 0).length / rows.length)],
        ]),
        "",
      );
    }
    if (recs.some((r) => r.flow.rockDay?.length)) {
      const by = Array.from({ length: blocks }, () => ({ tiles: [], amount: [] }));
      for (const r of recs)
        (r.flow.rockDay ?? []).forEach((day, d) =>
          day.forEach((v, s) => {
            if (!r.flow.seatDay[d]?.[s]?.[F.alive]) return;
            by[Math.floor(d / BD)].tiles.push(v[0]);
            by[Math.floor(d / BD)].amount.push(v[1]);
          }),
        );
      md.push(
        "Rock with material left inside a seat's territory (median seat, 10th-90th):",
        "",
        table(["days", "rock tiles", "material"], by.map((x, b) => [blockLabel(b), `${num(q(x.tiles, 0.5))} (${num(q(x.tiles, 0.1))}-${num(q(x.tiles, 0.9))})`, `${num(q(x.amount, 0.5))} (${num(q(x.amount, 0.1))}-${num(q(x.amount, 0.9))})`])),
        "",
      );
    }
  }
  const topInputs = [...inputKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  md.push("Inputs workplaces were waiting for (top 15):", "", table(["workplace", "missing", "snapshots", "share of that workplace's snapshots"], topInputs.map(([k, n]) => {
    const [type, missing] = k.split("|input:");
    return [type, missing, String(n), pct(n / sum([...idle.get(type).values()]))];
  })), "");

  // 5. Building timeline and construction.
  const per = new Map();
  for (const r of recs) {
    const seen = new Map();
    for (const [type, rv, placed, finished, ended, how] of r.flow.buildings) {
      const id = B[type];
      const e = per.get(id) ?? { placed: 0, done: 0, lost: 0, times: [], firsts: [], seats: 0 };
      per.set(id, e);
      e.placed++;
      if (finished >= 0) e.done++;
      if (how === 2) e.lost++;
      if (finished >= 0 && placed > 0) e.times.push(finished - placed);
      const k = `${id}|${rv}`;
      if (!seen.has(k) || placed < seen.get(k)) seen.set(k, placed);
    }
    for (const [k, p] of seen) {
      const e = per.get(k.split("|")[0]);
      e.seats++;
      e.firsts.push(p);
    }
  }
  const order = [...per.keys()].sort((a, b) => per.get(b).placed - per.get(a).placed);
  md.push("### Buildings: when placed and how long they take", "", table(["building", "placed per seat", "seats that placed one", "first placed (median day)", "finished", "build time in days (median, 10th-90th)", "captured"], order.map((id) => {
    const e = per.get(id);
    return [id, num(e.placed / seats), pct(e.seats / seats), num(q(e.firsts, 0.5)), pct(e.done / e.placed), e.times.length ? `${num(q(e.times, 0.5))} (${num(q(e.times, 0.1))}-${num(q(e.times, 0.9))})` : "-", pct(e.lost / e.placed)];
  })), "");
  const sites = new Map();
  const waits = new Map();
  for (const r of recs)
    for (const blk of r.flow.sites)
      for (const [key, n] of Object.entries(blk)) {
        const [type, reason] = key.split("|");
        if (!sites.has(type)) sites.set(type, new Map());
        bump(sites.get(type), siteClass(reason), n);
        if (reason.startsWith("wait_")) bump(waits, key, n);
      }
  const siteTypes = [...sites.keys()].sort((a, b) => sum([...sites.get(b).values()]) - sum([...sites.get(a).values()]));
  md.push("### What building sites were waiting for (share of site snapshots)", "", table(["building", "snapshots", ...SITE_REASONS], siteTypes.map((t) => {
    const m = sites.get(t);
    const n = sum([...m.values()]);
    return [t, String(n), ...SITE_REASONS.map((r) => pct(get(m, r) / n))];
  })), "");
  md.push("`wait_transit`: the biggest missing material is on its way; `wait_none`: nothing has been sent for it yet. `no_builder`: materials are on site but no builder was assigned, because there is no hammer in any warehouse (`no_hammer`), no adult free for a job (`no_person`), or otherwise no road from a home to the site (`no_route`).", "");
  const topWaits = [...waits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  md.push("Materials sites waited for most (top 12):", "", table(["building", "state", "material", "snapshots"], topWaits.map(([k, n]) => {
    const [type, reason] = k.split("|");
    const [state, good] = reason.split(":");
    return [type, state, good, String(n)];
  })), "");

  // 6. Logistics.
  const L = Array.from({ length: blocks }, () => ({ samples: 0, flags: 0, goods: 0, full: 0, noDest: 0, age: new Array(6).fill(0) }));
  const R = Array.from({ length: blocks }, () => new Array(4).fill(0));
  const stuck = G.map(() => 0);
  for (const r of recs) {
    r.flow.logistics.forEach((l, b) => {
      L[b].samples += l.samples;
      L[b].flags += l.flags;
      L[b].goods += l.goods;
      L[b].full += l.fullFlags;
      L[b].noDest += l.noDest;
      l.age.forEach((n, i) => (L[b].age[i] += n));
      l.stuck.forEach((n, g) => (stuck[g] += n));
    });
    r.flow.roads.forEach((row, b) => row.forEach((n, i) => (R[b][i] += n)));
  }
  md.push("### Goods waiting on flags and road load", "", table(["days", "goods waiting per seat", "flags full", "waiting 6 h or more", "waiting over a day", "no reachable destination", "roads under 25% loaded", "25-50%", "50-75%", "75% and over"], L.map((l, b) => [blockLabel(b), num(div(l.goods, l.samples)), pct(div(l.full, l.flags)), pct(div(l.age[3] + l.age[4] + l.age[5], l.goods)), pct(div(l.age[5], l.goods)), pct(div(l.noDest, l.goods)), ...R[b].map((n) => pct(n / sum(R[b])))])), "");
  const samples = sum(L.map((l) => l.samples));
  const topStuck = G.map((_, g) => g).filter((g) => stuck[g] > 0).sort((a, b) => stuck[b] - stuck[a]).slice(0, 8);
  md.push(`Goods that waited 6 hours or more on a flag, per seat snapshot (top 8): ${topStuck.map((g) => `${G[g]} ${num(stuck[g] / samples)}`).join(", ") || "none"}.`, "");

  // 7. People and food.
  const rows = [];
  for (let b = 0; b < blocks; b++) {
    const acc = { people: 0, cap: 0, idle: 0, noIdle: 0, unfilled: 0, jobs: 0, hungry: 0, food: 0, births: 0, deaths: 0, n: 0 };
    const idleSeats = [];
    const beforeMeal = [];
    const coverHungry = [];
    for (const r of recs)
      r.flow.seatDay.forEach((day, d) => {
        if (Math.floor(d / BD) !== b) return;
        for (const s of day) {
          if (!s[F.alive]) continue;
          acc.n++;
          acc.people += s[F.kids] + s[F.adults] + s[F.elders];
          acc.cap += s[F.capacity];
          acc.idle += s[F.idleAdults];
          idleSeats.push(s[F.idleAdults]);
          if (s[F.idleAdults] === 0) acc.noIdle++;
          acc.unfilled += s[F.unfilled];
          acc.jobs += s[F.jobs];
          acc.hungry += s[F.hungry];
          acc.food += s[F.foodStock];
          if (F.foodBefore !== undefined && s[F.mealNeed] > 0) {
            beforeMeal.push(s[F.foodBefore] / s[F.mealNeed]);
            if (s[F.hungry]) coverHungry.push(s[F.foodBefore] / s[F.mealNeed]);
          }
          acc.births += s[F.births];
          acc.deaths += s[F.deaths];
        }
      });
    rows.push([blockLabel(b), num(div(acc.people, acc.n)), num(div(acc.cap, acc.n)), num(q(idleSeats, 0.5)), `${num(div(acc.idle, acc.n))}`, pct(div(acc.noIdle, acc.n)), num(div(acc.jobs, acc.n)), pct(div(acc.unfilled, acc.jobs)), pct(div(acc.hungry, acc.n)), beforeMeal.length ? num(q(beforeMeal, 0.5)) : "-", coverHungry.length ? pct(q(coverHungry, 0.5)) : "-", num(div(acc.food, acc.n)), num(div(acc.births, acc.n)), num(div(acc.deaths, acc.n))]);
  }
  md.push("### People and food (per seat, mean over standing seat-days)", "", table(["days", "people", "room", "adults without a job (median seat)", "(mean)", "seat-days with no free adult", "workplaces", "workplaces with no worker", "meals short of food", "food before the meal, as a multiple of the need (median)", "share of the need met on short days (median)", "food in stock at window end", "births per day", "deaths per day"], rows), "");
  md.push("`meals short of food`: the share of seat-days on which the warehouses held less food than the people needed at the daily meal (0.45 units a head). Stock is read at the meal itself; `food in stock at window end` is read part way between two meals, so it can show food on days the meal was short, and it is a mean dominated by the well-fed seats.", "");

  // 8. War.
  const kinds = new Map();
  const firstDay = new Map();
  let wars = 0;
  for (const r of recs) {
    if (!r.flow.war.length) continue;
    wars++;
    const seen = new Set();
    // Player 0 is the steward seat, which only defends; it is told apart from the rivals.
    for (const [day, kind, a, b, x] of r.flow.war) {
      const who = kind === "attack" || kind === "capture" ? b : a;
      const side = who === 0 ? "the steward seat" : "a rival";
      const k = kind === "hurt" ? `${x === 1 ? "killed" : "wounded"} in a duel: warden of ${side}` : kind === "attack" ? `attack on ${side}` : kind === "capture" ? `capture from ${side}` : `fall of ${side}`;
      bump(kinds, k);
      if (!seen.has(k)) {
        seen.add(k);
        if (!firstDay.has(k)) firstDay.set(k, []);
        firstDay.get(k).push(day);
      }
    }
  }
  if (wars) {
    const dropped = sum(recs.map((r) => r.flow.warDropped));
    md.push("### War", "", table(["event", "per game", "games with one", "first one (median day)"], [...kinds.keys()].sort().map((k) => [k, num(get(kinds, k) / recs.length), pct(firstDay.get(k).length / recs.length), num(q(firstDay.get(k), 0.5))])), "");
    const w = Array.from({ length: blocks }, () => ({ n: 0, wardens: 0, attackers: 0, lit: 0, morale: 0, up: 0, all: 0 }));
    for (const r of recs)
      r.flow.seatDay.forEach((day, d) => {
        const b = Math.floor(d / BD);
        for (const s of day) {
          w[b].all++;
          if (!s[F.alive]) continue;
          w[b].n++;
          w[b].wardens += s[F.wardens];
          w[b].attackers += s[F.attackers];
          w[b].lit += s[F.lit];
          w[b].morale += s[F.morale];
        }
      });
    md.push(table(["days", "seats still standing", "wardens per seat", "wardens out attacking", "lit lanterns", "morale"], w.map((x, b) => [blockLabel(b), pct(div(x.n, x.all)), num(div(x.wardens, x.n)), num(div(x.attackers, x.n)), num(div(x.lit, x.n)), num(div(x.morale, x.n) / 100)])), "");
    md.push(`The steward seat (player 0) takes no initiative here, so events on it are listed apart from the rivals'. A wounded loser is the side whose warden lost a duel. ${dropped ? `${dropped} events beyond the per-game cap were not kept.` : ""}`, "");
  }
}

const md = ["# Flow report", "", "From the `flow` field of each game (soak/balance/probe.ts). A \"day\" is a 24-hour window starting where sampling began (see `startTick` in the data), so the daily meal falls part way into it; rates count only seats still standing.", ""];
const files = existsSync(OUT) ? readdirSync(OUT).filter((n) => n.endsWith(".jsonl")).sort() : [];
let used = 0;
for (const file of files) {
  const all = readFileSync(`${OUT}/${file}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const recs = all.filter((r) => r.flow);
  if (!recs.length) {
    md.push(`## ${all[0]?.spec.suite ?? file}`, "", `${all.length} games, none with flow data (played before the probe existed).`, "");
    continue;
  }
  used += recs.length;
  const suite = recs[0].spec.suite;
  if (recs.length < all.length) md.push(`> ${suite}: ${all.length - recs.length} of ${all.length} games have no flow data and are left out.`, "");
  const groups = new Map();
  for (const r of recs) {
    const label = BY ? `${suite}: ${BY}=${r.spec.tags[BY] ?? "-"}` : `${suite}: all games`;
    (groups.get(label) ?? groups.set(label, []).get(label)).push(r);
  }
  for (const [label, rs] of [...groups].sort()) analyse(rs, label, md);
}
writeFileSync(`${OUT}/flows.md`, md.join("\n") + "\n");
console.log(`${OUT}/flows.md (${used} games with flow data)`);
