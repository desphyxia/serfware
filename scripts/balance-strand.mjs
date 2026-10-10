// Sums the output of soak/balance/strand.ts (one JSON line per game): node scripts/balance-strand.mjs <file>...
// Goods lying on the flag of the building they are bound for: how they got there, how long, and what became of the sites.
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
if (!games.length) throw new Error("no strand output");
const tot = (a) => a.reduce((x, y) => x + y, 0);
console.log(`${games.length} games${games[0].none ? " (every AI switch off)" : ""}: ${games.map((g) => `${g.size}/${g.seed}`).join(", ")}\n`);
console.log("| game | redirects onto the own flag | goods that lay there 1500+ ticks | how they got their destination | how they ended | sites | sites finished | sites demolished | sites still open at the end |\n|---|---|---|---|---|---|---|---|---|");
for (const g of games) {
  const count = (arr, f) => {
    const m = {};
    for (const x of arr) m[f(x)] = (m[f(x)] ?? 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
  };
  const open = g.sites.filter((s) => s.finishedTick < 0 && s.goneTick < 0).length;
  console.log(
    `| ${g.size}/${g.seed} | ${g.redirectsOntoOwnFlag.length ? count(g.redirectsOntoOwnFlag, (r) => `${r.type}->${r.to.built ? "built" : "site"}`) : "0"} | ${g.long.length} (${count(g.long, (x) => x.type)}) | ${count(g.long, (x) => (x.viaRedirect ? "supply redirect" : x.prev ? `earlier dest ${x.prev.storage ? "was a store" : "was a building"}` : "no earlier dest seen"))} | ${count(g.long, (x) => x.endedAs)} | ${g.sites.length} | ${g.sites.filter((s) => s.finishedTick >= 0).length} | ${g.sites.filter((s) => s.goneTick >= 0 && s.finishedTick < 0).length} | ${open} |`,
  );
}
console.log("\nLong-lying goods, all games, by how long they lay (days):\n");
const days = [];
for (const g of games) for (const x of g.long) days.push(x.ticks / g.dayTicks);
days.sort((a, b) => a - b);
const q = (p) => (days.length ? days[Math.min(days.length - 1, Math.floor(days.length * p))].toFixed(1) : "-");
console.log(`${days.length} goods; days lain: median ${q(0.5)}, 90th percentile ${q(0.9)}, longest ${days.length ? days[days.length - 1].toFixed(1) : "-"}; ${tot(games.map((g) => g.shortCount))} more lay on their destination's flag for under 1500 ticks and moved on.`);
console.log("\nSites that held a long-lying good, all games: " + tot(games.map((g) => g.sites.length)) + ", of which finished " + tot(games.map((g) => g.sites.filter((s) => s.finishedTick >= 0).length)) + ", gone " + tot(games.map((g) => g.sites.filter((s) => s.goneTick >= 0 && s.finishedTick < 0).length)) + ".");
console.log("\nSites holding a stranded good (1500+ ticks) at the end of days, all games summed:\n");
console.log("| day | " + [10, 20, 30, 40, 50, 60].join(" | ") + " |\n|---|" + "---|".repeat(6));
console.log("| sites with a stranded good | " + [10, 20, 30, 40, 50, 60].map((d) => tot(games.map((g) => g.daily.find((x) => x.day === d)?.sitesWithAStrandedGood ?? 0))).join(" | ") + " |");
// Goods lying on their destination's flag at the end of a day, from the records of the goods that lay there 1500+ ticks.
const lying = (d, pred) => tot(games.map((g) => g.long.filter((x) => pred(x) && x.first + 1500 <= d * g.dayTicks && (x.endedAs === "still there at the end" || x.last >= d * g.dayTicks)).length));
console.log("| stranded goods bound for a finished building | " + [10, 20, 30, 40, 50, 60].map((d) => lying(d, (x) => x.dest.built)).join(" | ") + " |");
console.log("| stranded goods bound for a site | " + [10, 20, 30, 40, 50, 60].map((d) => lying(d, (x) => !x.dest.built)).join(" | ") + " |");
console.log("\nThe long-lying goods by the path that gave them their destination (read from the stack of a traced good of each kind):\n");
const kind = (x) => (x.viaRedirect ? "a store-bound good re-aimed by `supply` onto the flag it lay on" : x.type === "plank" && x.dest.building === "sawmill" ? "a sawmill's own plank, given to the sawmill by `assignDestination`" : x.prev && !x.prev.storage ? "destination was already a building (one such good was traced to a road split, `dropCarriedGoodAt`; the others are untraced)" : "untraced");
const paths = {};
for (const g of games) for (const x of g.long) paths[kind(x)] = (paths[kind(x)] ?? 0) + 1;
for (const [k, v] of Object.entries(paths).sort((a, b) => b[1] - a[1])) console.log(`- ${v}: ${k}`);
