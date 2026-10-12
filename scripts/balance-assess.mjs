// The standard assessment report: turns the games of the `assess` suite (scripts/balance-sweep.mjs assess) into one
// markdown report that covers growth, food, materials and mining, land, war, the armed-wardens rule, colonisation and
// terraforming, by world size. Give it two run directories to compare them side by side (for example the rule off and on).
// Usage: node scripts/balance-assess.mjs <dirA> [<dirB>] [--names A,B] [--suite assess] [--out report.md]
// Every cell is a mean over the rival seats (or the games, where the line says so) of that size. With two runs a cell reads
// "A / B" and, where both are numbers, a third column shows B against A. "-" means no data (for example a game shorter than
// the checkpoint). Checkpoint days d20, d60, d200 are the state at the end of that game day.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const SUITE = opt("suite", "assess");
const NAMES = opt("names", "").split(",").filter(Boolean);
const OUTFILE = opt("out", "");
const DIRS = args.filter((a) => !a.startsWith("--"));
if (!DIRS.length || DIRS.length > 2) {
  console.error("usage: node scripts/balance-assess.mjs <dirA> [<dirB>] [--names A,B] [--suite assess] [--out report.md]");
  process.exit(1);
}

const content = JSON.parse(readFileSync(new URL("../src/sim/data/content.json", import.meta.url), "utf8"));
const FOOD_IDS = new Set(content.goods.filter((g) => g.group === "food").map((g) => g.id));

const SIZES = ["tiny", "small", "medium", "large", "huge"];
const CPS = [20, 60, 200];

const load = (dir) => {
  const file = `${dir}/${SUITE}.jsonl`;
  if (!existsSync(file)) throw new Error(`no ${file}`);
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
};
const runs = DIRS.map((d, i) => ({ name: NAMES[i] ?? (DIRS.length === 1 ? "run" : i === 0 ? "A" : "B"), dir: d, games: load(d) }));

const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] / 2 + s[Math.ceil((s.length - 1) / 2)] / 2;
};
const num = (n) => (!Number.isFinite(n) ? "-" : Math.abs(n) >= 100 ? String(Math.round(n)) : Math.abs(n) >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100));
const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "-");
const rel = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) > 1e-9 ? `${b >= a ? "+" : ""}${Math.round(((b - a) / Math.abs(a)) * 100)}%` : "");

/** Per-game helpers. Seats are the rivals, seat r = player r + 1. */
const seatsOf = (g) => g.spec.personalities.length;
const sparseGet = (sp, i) => {
  for (let k = 0; k < sp.length; k += 2) if (sp[k] === i) return sp[k + 1];
  return 0;
};
const goodIndex = (g, id) => g.goods.indexOf(id);
const fieldIndex = (g) => {
  const m = {};
  g.flow?.seatDayFields.forEach((f, i) => (m[f] = i));
  return m;
};
/** The day-d value (1-based) of a seat-day field for each rival seat; skips seats that had fallen. */
const seatAt = (g, field, d, standingOnly = true) => {
  const f = fieldIndex(g)[field];
  if (f === undefined || !g.flow || g.flow.seatDay.length < d) return [];
  const out = [];
  for (const row of g.flow.seatDay[d - 1]) if (!standingOnly || row[0] === 1) out.push(row[f]);
  return out;
};
const lastDay = (g) => g.days.length;
/** Units of a good made by each rival over days [from, to) (0-based windows). */
const madeBy = (g, ids, from = 0, to = 1e9) => {
  const idx = ids.map((id) => goodIndex(g, id)).filter((i) => i >= 0);
  const out = new Array(seatsOf(g)).fill(0);
  const P = g.flow?.produced ?? [];
  for (let d = from; d < Math.min(P.length, to); d++) for (let r = 0; r < out.length; r++) for (const i of idx) out[r] += sparseGet(P[d][r] ?? [], i);
  return out;
};
const finalOf = (g, id) => g.finalBuildings.map((b) => b[id] ?? 0);

/** Each metric: a label and a function (game) -> array of numbers (pooled over games). */
const sections = [];
const section = (title, note, rows) => sections.push({ title, note, rows });
const atCp = (label, field, fn) => CPS.map((d) => [`${label} d${d}`, (g) => (lastDay(g) >= d ? fn(g, d) : [])]);
const seatField = (field, scale = 1) => (g, d) => seatAt(g, field, d).map((v) => v * scale);
const dayField = (key) => (g, d) => (g.days[d - 1] ?? []).map((s) => s[key]);

section("Games", "Per game.", [
  ["games", () => [1], "sum"],
  ["wall minutes", (g) => [g.wallMs / 60000]],
  ["days played", (g) => [lastDay(g)]],
  ["rule violations (games with any)", (g) => [g.brokenTotal > 0 ? 1 : 0], "pct"],
  ["games with a winner", (g) => [g.winner >= 0 ? 1 : 0], "pct"],
  ["day of the win (games with one)", (g) => (g.winner >= 0 ? [g.endDay] : [])],
]);

section("Growth and people", "Per rival seat.", [
  ...atCp("buildings", "built", dayField("built")),
  ...atCp("people", "people", dayField("people")),
  ...atCp("glow", "glow", dayField("glow")),
  ...atCp("workplaces idle (share)", "idle", dayField("idle")),
  ...atCp("workplaces with no worker", "unfilled", seatField("unfilled")),
  ...atCp("adults with no job", "idleAdults", seatField("idleAdults")),
  ...atCp("room for people", "capacity", seatField("capacity")),
]);

section("Food and hunger", "Per rival seat. Hunger is the share of seat-days from day 30 on when the meal was not covered.", [
  ["hungry seat-days from day 30", (g) => {
    const f = fieldIndex(g).hungry;
    if (f === undefined || !g.flow) return [];
    const out = [];
    for (let d = 30; d < g.flow.seatDay.length; d++) for (const row of g.flow.seatDay[d]) if (row[0] === 1) out.push(row[f]);
    return out;
  }, "pct"],
  ["food made per seat-day, days 0-59", (g) => madeBy(g, [...FOOD_IDS], 0, 60).map((v) => v / Math.min(60, lastDay(g)))],
  ["food made per seat-day, days 60+", (g) => (lastDay(g) > 60 ? madeBy(g, [...FOOD_IDS], 60).map((v) => v / (lastDay(g) - 60)) : [])],
  ...atCp("food in the warehouses", "foodStock", seatField("foodStock")),
  ...atCp("births to date, per seat", "births", (g, d) => {
    const f = fieldIndex(g).births;
    if (f === undefined || !g.flow) return [];
    return Array.from({ length: seatsOf(g) }, (_, r) => g.flow.seatDay.slice(0, d).reduce((a, day) => a + (day[r]?.[f] ?? 0), 0));
  }),
]);

section("Logistics", "Per rival seat, means of the day's snapshots. Roads and road tiles are standing roads; a flag is full at 8 goods; stuck goods have waited on a flag for 6 game hours or more.", [
  ...atCp("roads", "roads", seatField("roads")),
  ...atCp("road tiles per finished building", "roadTiles", (g, d) => {
    const roads = seatAt(g, "roadTiles", d);
    const built = g.days[d - 1] ?? [];
    return roads.map((v, i) => (built[i]?.built ? v / built[i].built : NaN)).filter(Number.isFinite);
  }),
  ...atCp("flags", "flags", seatField("flags")),
  ...atCp("full flags", "fullFlags", seatField("fullFlags")),
  ...atCp("goods lying on flags", "goodsOnFlags", seatField("goodsOnFlags")),
  ...atCp("goods stuck on flags", "stuckGoods", seatField("stuckGoods")),
  ...atCp("carriers out", "carriers", seatField("carriers")),
  ...atCp("builders out", "builders", seatField("builders")),
  ["sites waiting for a material on its way (share of site-samples)", (g) => siteShare(g, (k) => k.includes("|wait_transit:"))],
  ["sites waiting for a material nobody sent (share)", (g) => siteShare(g, (k) => k.includes("|wait_none:"))],
  ["workplaces with output blocked on a full flag (share)", (g) => idleShare(g, (k) => k.endsWith("|output_blocked"))],
]);
function siteShare(g, test) {
  let all = 0;
  let hit = 0;
  for (const bucket of g.flow?.sites ?? []) for (const [k, v] of Object.entries(bucket)) {
    all += v;
    if (test(k)) hit += v;
  }
  return all ? [hit / all] : [];
}
function idleShare(g, test) {
  let all = 0;
  let hit = 0;
  for (const bucket of g.flow?.idle ?? []) for (const [k, v] of Object.entries(bucket)) {
    all += v;
    if (test(k)) hit += v;
  }
  return all ? [hit / all] : [];
}

const made = (label, ids, from, to) => [label, (g) => madeBy(g, ids, from, to)];
section("Materials and mining", "Units made per rival seat. Mines are standing at the end of the game.", [
  made("logs, days 0-59", ["log"], 0, 60),
  made("planks, days 0-59", ["plank"], 0, 60),
  made("stone, days 0-59", ["stone"], 0, 60),
  made("coal, days 0-59", ["coal"], 0, 60),
  made("iron ore, days 0-59", ["ironore"], 0, 60),
  made("iron, days 0-59", ["iron"], 0, 60),
  made("gold ore, days 0-59", ["goldore"], 0, 60),
  made("gold, days 0-59", ["gold"], 0, 60),
  made("stone, whole game", ["stone"]),
  made("coal, whole game", ["coal"]),
  made("iron ore, whole game", ["ironore"]),
  made("iron, whole game", ["iron"]),
  made("gold, whole game", ["gold"]),
  made("tools, whole game", ["axe", "saw", "pick", "hammer", "shovel", "scythe", "rod", "cleaver", "crook", "tongs"]),
  ["granite mines standing", (g) => finalOf(g, "granitemine")],
  ["coal mines standing", (g) => finalOf(g, "coalmine")],
  ["iron mines standing", (g) => finalOf(g, "ironmine")],
  ["gold mines standing", (g) => finalOf(g, "goldmine")],
  ["seats with a smelter", (g) => finalOf(g, "smelter").map((n) => (n > 0 ? 1 : 0)), "pct"],
  ["seats with a toolsmith", (g) => finalOf(g, "toolsmith").map((n) => (n > 0 ? 1 : 0)), "pct"],
  ["workplace-samples working", (g) => {
    let work = 0;
    let all = 0;
    for (const bucket of g.flow?.idle ?? []) for (const [k, v] of Object.entries(bucket)) {
      all += v;
      if (k.endsWith("|working")) work += v;
    }
    return all ? [work / all] : [];
  }, "pct"],
  ["workplace-samples with no tool", (g) => {
    let tool = 0;
    let all = 0;
    for (const bucket of g.flow?.idle ?? []) for (const [k, v] of Object.entries(bucket)) {
      all += v;
      if (k.endsWith("|no_tool")) tool += v;
    }
    return all ? [tool / all] : [];
  }, "pct"],
]);

section("Land", "Per rival seat. Land held is tiles inside the border; open is free and flat land inside it at the end.", [
  ...atCp("land held", "territory", seatField("territory")),
  ...atCp("tiles a new lantern could be put on", "frontier", seatField("frontier")),
  ...atCp("lit lantern buildings", "lit", seatField("lit")),
  ["share of the map's land held by rivals at the end", (g) => {
    const land = g.flow?.landTiles;
    const f = fieldIndex(g).territory;
    if (!land || f === undefined) return [];
    const last = g.flow.seatDay[g.flow.seatDay.length - 1];
    return [last.reduce((a, row) => a + row[f], 0) / land];
  }, "pct"],
  ["land under buildings at the end (share of held)", (g) => landShare(g, 1)],
  ["land under fields at the end (share of held)", (g) => landShare(g, 5)],
  ["land under trees at the end (share of held)", (g) => landShare(g, 6)],
  ["open land at the end (share of held)", (g) => landShare(g, 10)],
]);
function landShare(g, k) {
  const L = g.flow?.landDay;
  if (!L?.length) return [];
  const last = L[L.length - 1];
  const out = [];
  for (let r = 0; r < seatsOf(g); r++) if (last[r]?.[0] > 0) out.push(last[r][k] / last[r][0]);
  return out;
}

const warCount = (kind) => (g) => [(g.flow?.war ?? []).filter((e) => e[1] === kind).length];
section("War", "Per game, except wardens and morale (per rival seat). Attack and capture counts are events kept in the record (up to 2000 a game).", [
  ["attacks ordered", warCount("attack")],
  ["buildings captured", warCount("capture")],
  ["rivals fallen", warCount("fall")],
  ["wardens hurt", warCount("hurt")],
  ["day of the first attack", (g) => {
    const e = (g.flow?.war ?? []).find((x) => x[1] === "attack");
    return e ? [e[0]] : [];
  }],
  ["attacks after day 40", (g) => [(g.flow?.war ?? []).filter((e) => e[1] === "attack" && e[0] >= 40).length]],
  ["seats still standing at the end", (g) => {
    const f = fieldIndex(g).alive;
    if (f === undefined || !g.flow?.seatDay.length) return [];
    return g.flow.seatDay[g.flow.seatDay.length - 1].map((row) => row[f]);
  }, "pct"],
  ...atCp("wardens", "wardens", seatField("wardens")),
  ...atCp("morale", "morale", seatField("morale", 0.01)),
  ...atCp("resolve", "resolve", seatField("resolve", 0.01)),
]);

section("Arms and the armed-wardens rule", "Per rival seat. Dark = finished lantern buildings that are not lit.", [
  ...atCp("lantern buildings dark", "dark", seatField("dark")),
  ...atCp("blades in the warehouses", "blades", seatField("blades")),
  ...atCp("shields in the warehouses", "shields", seatField("shields")),
  ...atCp("people carrying a blade and a shield", "armedWardens", seatField("armedWardens")),
  made("blades made, whole game", ["blade"]),
  made("shields made, whole game", ["shield"]),
  made("bows made, whole game", ["bow"]),
  ["seats with a weaponsmith", (g) => finalOf(g, "weaponsmith").map((n) => (n > 0 ? 1 : 0)), "pct"],
]);

const voyageCount = (g, kind, state) => {
  const v = g.system?.voyages;
  if (!v) return null;
  return v.filter((x) => x[0] === kind && (state ? state.includes(x[3]) : true)).length;
};
const perGame = (fn) => (g) => {
  const v = fn(g);
  return v === null || v === undefined ? [] : [v];
};
section("Colonisation", "Per game. A colony is founded when a Hearthship of one seat lands; people and buildings are summed over the rival seats.", [
  ["seats with a launch rail", (g) => finalOf(g, "launchrail").map((n) => (n > 0 ? 1 : 0)), "pct"],
  ["probes sent", perGame((g) => voyageCount(g, "probe"))],
  ["Hearthships sent", perGame((g) => voyageCount(g, "hearthship"))],
  ["Hearthships that landed", perGame((g) => voyageCount(g, "hearthship", ["done"]))],
  ["skyships sent", perGame((g) => voyageCount(g, "skyship"))],
  ["games with a colony", (g) => (g.system ? [g.system.colonies.length > 0 ? 1 : 0] : []), "pct"],
  ["colony worlds founded", perGame((g) => g.system?.colonies.length ?? null)],
  ["day the first colony was founded (games with one)", (g) => (g.system?.colonies.length ? [Math.min(...g.system.colonies.map((c) => c.foundedDay))] : [])],
  ["colonists at the end (all colonies, all rivals)", perGame((g) => colonyTotal(g, 0))],
  ["colony buildings at the end", perGame((g) => colonyTotal(g, 1))],
  ["colony land held at the end (tiles)", perGame((g) => colonyTotal(g, 3))],
  ["colonies where a seat has taken root", perGame((g) => (g.system ? g.system.colonies.reduce((a, c) => a + (c.seatDays.length && c.seatDays[c.seatDays.length - 1].some((s, i) => i > 0 && s[5]) ? 1 : 0), 0) : null))],
]);
function colonyTotal(g, field) {
  if (!g.system) return null;
  let total = 0;
  for (const c of g.system.colonies) {
    const last = c.seatDays[c.seatDays.length - 1];
    if (last) for (let i = 1; i < last.length; i++) total += last[i][field];
  }
  return total;
}

const air = (field) => (g) => {
  const out = [];
  const k = g.system?.colonyFields.indexOf(field);
  for (const c of g.system?.colonies ?? []) if (c.days.length > 1) out.push(c.days[c.days.length - 1][k] - c.days[0][k]);
  return out;
};
section("Terraforming", "Per colony world, except where the line says games. Air figures are the change from the first day after founding to the last.", [
  ["terraforming works standing (per colony world)", (g) => (g.system?.colonies ?? []).map((c) => c.terraWorks.reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0))],
  ["colony worlds with at least one work", (g) => (g.system?.colonies ?? []).map((c) => (c.terraWorks.some((m) => Object.keys(m).length) ? 1 : 0)), "pct"],
  ["pressure change (bar)", air("pressure")],
  ["oxygen change", air("oxygen")],
  ["water change", air("water")],
  ["warming change (°C)", air("warming")],
  ["life cover change (share of land)", air("cover")],
  ["planetary years passed", (g) => {
    const k = g.system?.colonyFields.indexOf("years");
    return (g.system?.colonies ?? []).map((c) => (c.days.length ? c.days[c.days.length - 1][k] : 0));
  }],
  ["worlds that bloomed", (g) => (g.system?.colonies ?? []).map((c) => (c.bloomDay >= 0 ? 1 : 0)), "pct"],
]);

// ---- growth stalls
// A seat is stalled on day D (from day 15) when its finished buildings are no more than they were 10 days before. For every
// seat-day the report evaluates the conditions below from the daily record, then compares how often each holds on stalled
// days against growing days, and classifies the cause at the start of each stall (a run of 10 or more stalled days) in a
// fixed order. A condition that is common on stalled days and rare on growing days points at the cause; one that is common on
// both is not it. The order of the classification is a judgement; the shares for every condition are all in the tables.
const STALL_FROM = 15;
const STALL_SPAN = 10;
const STALL_RUN = 10;
const CONDS = [
  ["people", "no adult free for a job", (c) => c.idleAdults < 1],
  ["people", "people at the room limit", (c) => c.people >= c.capacity - 1],
  ["people", "no births in 5 days", (c) => c.births5 === 0],
  ["people", "hungry in the last 5 days", (c) => c.hungry5 > 0],
  ["land", "no tile a new lantern could go on", (c) => c.frontier === 0],
  ["land", "free open land under 15 tiles", (c) => c.open < 15],
  ["land", "rock in the border under 10 units", (c) => c.rock < 10],
  ["land", "fellable trees in the border under 10", (c) => c.trees < 10],
  ["border", "lantern buildings dark", (c) => c.dark > 0],
  ["border", "AI found no border tile (5 days)", (c) => c.aiNoFrontier5 > 0],
  ["AI", "AI at its site cap (5 days)", (c) => c.aiCapped5 > 0],
  ["AI", "AI had no idle hands (5 days)", (c) => c.aiNoIdle5 > 0],
  ["AI", "no building site standing", (c) => c.sites < 0.5],
  ["materials", "half the sites or more wait for planks", (c) => c.sites >= 1 && c.sitesWaitPlank >= c.sites / 2],
  ["materials", "half the sites or more wait for stone", (c) => c.sites >= 1 && c.sitesWaitStone >= c.sites / 2],
  ["materials", "half the sites or more wait for logs", (c) => c.sites >= 1 && c.sitesWaitLog >= c.sites / 2],
  ["materials", "half the sites or more wait for another material", (c) => c.sites >= 1 && c.sitesWaitOther >= c.sites / 2],
  ["materials", "planks in the stores under 3", (c) => c.plankStock < 3],
  ["materials", "stone in the stores under 3", (c) => c.stoneStock < 3],
  ["builders", "a site with materials and no hammer", (c) => c.sitesNoHammer >= 0.5],
  ["builders", "a site with materials and no free adult", (c) => c.sitesNoPerson >= 0.5],
  ["builders", "a site with materials and no road from a home", (c) => c.sitesNoRoute >= 0.5],
  ["workplaces", "20% or more of workplaces without a worker", (c) => c.wp > 0 && c.wpNoWorker / c.wp >= 0.2],
  ["workplaces", "a workplace without a worker for want of a tool", (c) => c.wpNoTool >= 0.5],
  ["workplaces", "20% or more of workplaces short of an input", (c) => c.wp > 0 && c.wpInput / c.wp >= 0.2],
  ["workplaces", "20% or more of gatherers find nothing to gather", (c) => c.wp > 0 && c.wpNoTarget / c.wp >= 0.2],
  ["workplaces", "a workplace cut off from the roads", (c) => c.wpStranded >= 0.5],
  ["workplaces", "20% or more of workplaces used up", (c) => c.wp > 0 && c.wpExhausted / c.wp >= 0.2],
  ["workplaces", "a workplace with its output blocked", (c) => c.wpBlocked >= 0.5],
  ["logistics", "10% or more of the flags full", (c) => c.flags > 0 && c.fullFlags / c.flags >= 0.1],
  ["logistics", "10 or more goods stuck on flags", (c) => c.stuckGoods >= 10],
  ["war", "attacked or lost a building (5 days)", (c) => c.war5 > 0],
  ["economy", "iron in the stores under 3", (c) => c.ironStock < 3],
];
/** The cause given to the start of a stall: the first test that holds, in this order. */
const CAUSES = [
  ["attacked or lost a building", (c) => c.war5 > 0],
  ["no free land (no lantern tile, little open land)", (c) => c.frontier === 0 && c.open < 15],
  ["no free adult and no room for more people", (c) => c.idleAdults < 1 && c.people >= c.capacity - 1],
  ["no free adult for a job", (c) => c.idleAdults < 1],
  ["sites wait for stone", (c) => c.sites >= 1 && c.sitesWaitStone >= c.sites / 2],
  ["sites wait for planks", (c) => c.sites >= 1 && c.sitesWaitPlank >= c.sites / 2],
  ["sites wait for logs or another material", (c) => c.sites >= 1 && c.sitesWaitPlank + c.sitesWaitStone + c.sitesWaitLog + c.sitesWaitOther >= c.sites / 2],
  ["sites with materials but no builder", (c) => c.sitesNoHammer + c.sitesNoPerson + c.sitesNoRoute >= 0.5],
  ["workplaces without a worker or a tool", (c) => c.wp > 0 && (c.wpNoWorker + c.wpNoTool) / c.wp >= 0.25],
  ["workplaces short of an input", (c) => c.wp > 0 && c.wpInput / c.wp >= 0.25],
  ["flags full or goods stuck", (c) => (c.flags > 0 && c.fullFlags / c.flags >= 0.1) || c.stuckGoods >= 10],
  ["hunger", (c) => c.hungry5 > 0],
  ["lantern buildings dark", (c) => c.dark > 0],
  ["AI placed nothing (no site, free hands and land)", (c) => c.sites < 0.5],
  ["none of the above", () => true],
];
const fieldCache = new WeakMap();
const fields = (g) => {
  let f = fieldCache.get(g);
  if (!f) fieldCache.set(g, (f = fieldIndex(g)));
  return f;
};
/** The conditions' inputs for rival seat r on day D (1-based), or null if the record cannot tell. */
function seatDayState(g, r, D) {
  const f = fields(g);
  const row = g.flow?.seatDay[D - 1]?.[r];
  if (!row || f.sites === undefined) return null;
  const v = (name, back = 0) => g.flow.seatDay[Math.max(0, D - 1 - back)]?.[r]?.[f[name]] ?? 0;
  const wp = v("wpWorking") + v("wpNoWorker") + v("wpNoTool") + v("wpInput") + v("wpNoTarget") + v("wpStranded") + v("wpExhausted") + v("wpBlocked") + v("wpOther");
  const stock = g.days[D - 1]?.[r]?.stock ?? [];
  const land = g.flow.landDay?.[D]?.[r];
  const res = g.flow.resDay?.[D]?.[r];
  const rock = g.flow.rockDay?.[D - 1]?.[r];
  let births5 = 0;
  let hungry5 = 0;
  for (let k = 0; k < 5; k++) {
    births5 += v("births", k);
    hungry5 += v("hungry", k);
  }
  const war5 = (g._war?.[r + 1] ?? []).some((t) => t >= D - 5 && t < D + 1) ? 1 : 0;
  const state = {
    people: v("kids") + v("adults") + v("elders"),
    wp,
    births5,
    hungry5,
    war5,
    open: land ? land[10] : 0,
    rock: rock ? rock[1] : 0,
    trees: res ? res[3] : 0,
    aiNoFrontier5: v("aiNoFrontier") - v("aiNoFrontier", 5),
    aiCapped5: v("aiCapped") - v("aiCapped", 5),
    aiNoIdle5: v("aiNoIdle") - v("aiNoIdle", 5),
    plankStock: stock[goodIndex(g, "plank")] ?? 0,
    stoneStock: stock[goodIndex(g, "stone")] ?? 0,
    ironStock: stock[goodIndex(g, "iron")] ?? 0,
  };
  for (const name of ["idleAdults", "capacity", "frontier", "dark", "sites", "sitesWaitPlank", "sitesWaitStone", "sitesWaitLog", "sitesWaitOther", "sitesNoHammer", "sitesNoPerson", "sitesNoRoute", "wpNoWorker", "wpNoTool", "wpInput", "wpNoTarget", "wpStranded", "wpExhausted", "wpBlocked", "flags", "fullFlags", "stuckGoods"]) state[name] = v(name);
  return state;
}
/** Index each game's war events by the player who was attacked or lost a building (days, absolute). */
function indexWar(g) {
  if (g._war) return;
  g._war = {};
  for (const e of g.flow?.war ?? []) if (e[1] === "attack" || e[1] === "capture") (g._war[e[3]] ??= []).push(Math.floor(e[0]));
}
function stallsOf(run, size) {
  const out = { games: 0, seatDays: 0, stalled: 0, seats: 0, seatsStalled: 0, onsets: [], onsetBuildings: [], causes: new Map(), stalledHold: CONDS.map(() => 0), growingHold: CONDS.map(() => 0), growing: 0, grow2060: [], grow60end: [] };
  for (const g of run.games) {
    if (g.spec.size !== size || !g.flow?.seatDayFields.includes("sites")) continue;
    indexWar(g);
    out.games++;
    for (let r = 0; r < seatsOf(g); r++) {
      const alive = (D) => g.flow.seatDay[D - 1]?.[r]?.[0] === 1;
      const built = (D) => g.days[D - 1]?.[r]?.built ?? 0;
      const L = Math.min(lastDay(g), g.flow.seatDay.length);
      out.seats++;
      if (L >= 60 && built(20) > 0) out.grow2060.push(built(60) / built(20) - 1);
      if (L >= 200 && built(60) > 0) out.grow60end.push(built(L) / built(60) - 1);
      let run0 = 0;
      let counted = false;
      let stalledAny = false;
      for (let D = STALL_FROM; D <= L; D++) {
        if (!alive(D)) break;
        const stalled = built(D) <= built(D - STALL_SPAN);
        out.seatDays++;
        if (stalled) {
          out.stalled++;
          stalledAny = true;
        } else out.growing++;
        const state = seatDayState(g, r, D);
        if (state) CONDS.forEach(([, , test], i) => {
          if (test(state)) (stalled ? out.stalledHold : out.growingHold)[i]++;
        });
        run0 = stalled ? run0 + 1 : 0;
        if (stalled && run0 === STALL_RUN && !counted) {
          counted = true;
          const start = D - STALL_RUN + 1;
          const at = seatDayState(g, r, Math.min(L, start + 5));
          out.onsets.push(start);
          out.onsetBuildings.push(built(start));
          if (at) {
            const cause = CAUSES.find(([, test]) => test(at))[0];
            out.causes.set(cause, (out.causes.get(cause) ?? 0) + 1);
          }
        }
      }
      if (stalledAny) out.seatsStalled++;
    }
  }
  return out;
}
function stallSections(runs, sizes) {
  const L = [];
  const stats = runs.map((r) => Object.fromEntries(sizes.map((s) => [s, stallsOf(r, s)])));
  const two = (a, b, f = num) => (runs.length === 1 ? f(a) : `${f(a)} / ${f(b)}`);
  const cols = (fn) => sizes.map((s) => two(fn(stats[0][s]), runs.length > 1 ? fn(stats[1][s]) : NaN));
  L.push("## Growth stalls", "");
  L.push(`A seat is stalled on a day (from day ${STALL_FROM}) when its finished buildings are no more than they were ${STALL_SPAN} days before. A stall starts when ${STALL_RUN} stalled days in a row begin. Per rival seat; seats stop counting when they fall.`, "");
  L.push(`| | ${sizes.join(" | ")} |`, `|---|${sizes.map(() => "---").join("|")}|`);
  L.push(`| seat-days measured | ${cols((x) => x.seatDays).join(" | ")} |`);
  L.push(`| stalled seat-days | ${sizes.map((s) => two(div(stats[0][s].stalled, stats[0][s].seatDays), runs.length > 1 ? div(stats[1][s].stalled, stats[1][s].seatDays) : NaN, pct)).join(" | ")} |`);
  L.push(`| seats with a stall | ${sizes.map((s) => two(div(stats[0][s].onsets.length, stats[0][s].seats), runs.length > 1 ? div(stats[1][s].onsets.length, stats[1][s].seats) : NaN, pct)).join(" | ")} |`);
  L.push(`| day the stall starts (median) | ${cols((x) => median(x.onsets)).join(" | ")} |`);
  L.push(`| buildings when it starts (mean) | ${cols((x) => mean(x.onsetBuildings)).join(" | ")} |`);
  L.push(`| buildings grow, day 20 to 60 | ${sizes.map((s) => two(mean(stats[0][s].grow2060), runs.length > 1 ? mean(stats[1][s].grow2060) : NaN, pct)).join(" | ")} |`);
  L.push(`| buildings grow, day 60 to the end (200-day games) | ${sizes.map((s) => two(mean(stats[0][s].grow60end), runs.length > 1 ? mean(stats[1][s].grow60end) : NaN, pct)).join(" | ")} |`);
  L.push("");
  L.push("### What a stall starts with", "");
  L.push("The first cause that holds five days into the stall, in this order (a judgement; the next tables give every condition). Share of the stalls that were classified.", "");
  L.push(`| | ${sizes.join(" | ")} |`, `|---|${sizes.map(() => "---").join("|")}|`);
  for (const [name] of CAUSES) {
    const share = (st) => {
      const total = [...st.causes.values()].reduce((a, b) => a + b, 0);
      return total ? (st.causes.get(name) ?? 0) / total : NaN;
    };
    L.push(`| ${name} | ${sizes.map((s) => two(share(stats[0][s]), runs.length > 1 ? share(stats[1][s]) : NaN, pct)).join(" | ")} |`);
  }
  L.push("");
  L.push("### Which conditions hold on stalled days", "");
  L.push("Share of stalled seat-days where the condition holds, against share of growing seat-days. A condition that is far more common on stalled days is a candidate cause; one that is as common on growing days is not. Sizes with fewer than 30 stalled seat-days are left out.", "");
  for (const size of sizes) {
    if (stats.every((st) => st[size].stalled < 30)) continue;
    L.push(`**${size}**`, "");
    const head = runs.flatMap((r) => [`${r.name} stalled`, `${r.name} growing`]);
    L.push(`| group | condition | ${head.join(" | ")} |`, `|---|---|${head.map(() => "---").join("|")}|`);
    CONDS.forEach(([group, name], i) => {
      const cells = stats.flatMap((st) => [pct(div(st[size].stalledHold[i], st[size].stalled)), pct(div(st[size].growingHold[i], st[size].growing))]);
      L.push(`| ${group} | ${name} | ${cells.join(" | ")} |`);
    });
    L.push("");
  }
  return L;
}
const div = (a, b) => (b > 0 ? a / b : NaN);

/** The biggest holders-up from day 20 on: workplace-samples by "building|reason" (idle) and site-samples (sites), as a share of all. */
function blockers(run, size, kind, top = 8) {
  const total = new Map();
  let all = 0;
  for (const g of run.games) {
    if (g.spec.size !== size) continue;
    const buckets = g.flow?.[kind] ?? [];
    buckets.forEach((bucket, i) => {
      if (i < 2) return;
      for (const [k, v] of Object.entries(bucket)) {
        if (kind === "idle" && k.endsWith("|working")) {
          all += v;
          continue;
        }
        all += v;
        total.set(k, (total.get(k) ?? 0) + v);
      }
    });
  }
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => [k, v / all]);
}
function blockerSections(runs, sizes) {
  const L = [];
  L.push("## What holds workplaces and building sites up", "");
  L.push("From day 20 on, pooled over the rival seats and games of a size: workplace-samples (idle) or site-samples (sites) by building and reason, as a share of all samples of that kind, largest first. Idle reasons: no_worker, no_tool, input:<good>, no_target and no_path (a gatherer finds nothing, or no way to it), stranded, exhausted, output_blocked, other:<state>. Site reasons: dig, building, no_builder:<cause>, wait_transit:<good> (on its way), wait_none:<good> (nothing sent yet), finishing.", "");
  for (const [kind, label] of [["idle", "Workplaces not working"], ["sites", "Building sites not being built"]]) {
    for (const r of runs) {
      L.push(`**${label}: ${r.name}**`, "");
      L.push(`| rank | ${sizes.join(" | ")} |`, `|---|${sizes.map(() => "---").join("|")}|`);
      const cols = sizes.map((s) => blockers(r, s, kind));
      for (let i = 0; i < 8; i++) L.push(`| ${i + 1} | ${cols.map((c) => (c[i] ? `${c[i][0]} ${pct(c[i][1])}` : "-")).join(" | ")} |`);
      L.push("");
    }
  }
  return L;
}

// ---- output
const cell =(rowDef, size, run) => {
  const [, fn, how] = rowDef;
  const vals = [];
  for (const g of run.games) if (g.spec.size === size) vals.push(...fn(g));
  if (!vals.length) return { v: NaN, n: 0 };
  return { v: how === "sum" ? vals.reduce((a, b) => a + b, 0) : mean(vals), n: vals.length, how };
};
const fmt = (c) => (c.how === "pct" ? pct(c.v) : num(c.v));

const sizes = SIZES.filter((s) => runs.some((r) => r.games.some((g) => g.spec.size === s)));
const lines = [];
lines.push(`# Standard assessment (${SUITE})`);
lines.push("");
for (const r of runs) {
  const ai = [...new Set(r.games.flatMap((g) => g.ai ?? []))];
  const rules = r.games.some((g) => g.rules?.armedWardens) ? "armedWardens" : "none";
  const bySize = sizes.map((s) => `${s} ${r.games.filter((g) => g.spec.size === s).length}`).join(", ");
  lines.push(`- **${r.name}** (\`${r.dir}\`): ${r.games.length} games (${bySize}); AI switches: ${ai.length ? ai.join(",") : "none"}; match rules: ${rules}.`);
}
lines.push("");
lines.push(`Sizes: ${sizes.join(", ")}. ${runs.length === 2 ? `Cells read "${runs[0].name} / ${runs[1].name}" with ${runs[1].name} against ${runs[0].name} in brackets.` : ""}`);
lines.push("");
for (const s of sections) {
  lines.push(`## ${s.title}`);
  lines.push("");
  lines.push(s.note);
  lines.push("");
  lines.push(`| | ${sizes.join(" | ")} |`);
  lines.push(`|---|${sizes.map(() => "---").join("|")}|`);
  for (const row of s.rows) {
    const cells = sizes.map((size) => {
      const cs = runs.map((r) => cell(row, size, r));
      if (runs.length === 1) return fmt(cs[0]);
      const change = row[2] === "pct" ? "" : rel(cs[0].v, cs[1].v);
      return `${fmt(cs[0])} / ${fmt(cs[1])}${change ? ` (${change})` : ""}`;
    });
    lines.push(`| ${row[0]} | ${cells.join(" | ")} |`);
  }
  lines.push("");
}
lines.push(...stallSections(runs, sizes));
lines.push(...blockerSections(runs, sizes));
lines.push("## Reading this");
lines.push("");
lines.push("- Cells are means pooled over the rival seats (or colony worlds, or games) of that size. Few games per size means a wide error: read differences under about 15% as noise unless many games agree.");
lines.push("- The steward seat (player 0) is not measured, as in the other balance reports. Colony figures sum the rival seats.");
lines.push("- Stats that need long games (colonisation, terraforming, late war) are empty when games are shorter than the checkpoint.");
const text = lines.join("\n") + "\n";
if (OUTFILE) writeFileSync(OUTFILE, text);
else process.stdout.write(text);
void median;
