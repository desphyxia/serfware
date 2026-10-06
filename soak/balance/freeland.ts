import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { Feature } from "../../src/sim/econ/landuse";
import { frontierTiles, landmassOf } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * Where the free land is, round each rival's border after some days: `node freeland.mjs <size> <seed> <days>` prints one
 * JSON line per seat. It plays the pilot-6 AI (all four switches), then looks at the unowned land of the Hearthship's land.
 */
const [size, seed, days] = process.argv.slice(2) as ["tiny" | "small", string, string];
aiOptions.relocateQuarries = aiOptions.stoneFallback = aiOptions.foodByNeed = aiOptions.stonePriority = true;
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 999,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
const grid = land.planet.grid;
const stop = w.tick + Number(days) * eco.dayTicks;
while (w.tick < stop && eco.winner < 0) w.step();

const n = land.territory.length;
for (let p = 1; p <= 3; p++) {
  const keep = eco.buildings[eco.keeps[p] ?? -1];
  if (!keep) continue;
  const home = landmassOf(w, keep.tile);
  const mine = (t: number) => land.territory[t] === p + 1 && land.isLand(t);
  const free = (t: number) => land.territory[t] === 0 && land.isLand(t) && home.has(t);
  let own = 0;
  let freeHome = 0;
  let foreign = 0;
  for (let t = 0; t < n; t++) {
    if (mine(t)) own++;
    else if (free(t)) freeHome++;
    else if (land.isLand(t) && land.territory[t] !== 0 && home.has(t)) foreign++;
  }
  // Land steps from our border to the nearest free tile, through anything (a), and through free or own land only (b).
  const walk = (through: (t: number) => boolean) => {
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (let t = 0; t < n; t++) if (mine(t)) { dist.set(t, 0); queue.push(t); }
    const reach = [0, 0, 0, 0]; // free tiles within 2, 5, 10 and 20 steps
    let nearest = -1;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i] as number;
      const d = dist.get(t) as number;
      if (d > 20) break;
      if (free(t)) {
        if (nearest < 0) nearest = d;
        [2, 5, 10, 20].forEach((r, k) => { if (d <= r) reach[k]!++; });
      }
      for (const x of grid.neighborsOf(t)) if (!dist.has(x) && land.isLand(x) && through(x)) { dist.set(x, d + 1); queue.push(x); }
    }
    return { nearest, reach };
  };
  const anyWay = walk(() => true);
  const notForeign = walk((t) => land.territory[t] === 0 || land.territory[t] === p + 1);
  // The border's own tiles by free land within 5 (what `frontierTiles` looks at), and what the free land near it is made of.
  const edge = { none: 0, thin: 0, enough: 0, notOwn12: 0 };
  const near = new Set<number>();
  for (let t = 0; t < n; t++) {
    if (!mine(t)) continue;
    let f = 0;
    let o = 0;
    for (const x of land.ring(t, 5)) {
      if (land.territory[x] === 0 && land.isLand(x)) { f++; if (home.has(x)) near.add(x); }
      else if (land.territory[x] === p + 1) o++;
    }
    if (f === 0) edge.none++;
    else if (f < 8) edge.thin++;
    else if (o < 12) edge.notOwn12++;
    else edge.enough++;
  }
  const make = { tree: 0, rock: 0, steep: 0, other: 0 };
  for (const t of near) {
    const f = land.feature[t];
    if (f === Feature.Tree) make.tree++;
    else if (f === Feature.Rock) make.rock++;
    else if (land.slope(t) >= 2.2) make.steep++;
    else make.other++;
  }
  console.log(JSON.stringify({ seed, size, seat: p, days: Number(days), own, freeHome, foreign, frontier: frontierTiles(w, p).length, nearestAny: anyWay.nearest, withinAny: anyWay.reach, nearestNoForeign: notForeign.nearest, withinNoForeign: notForeign.reach, edge, freeWithin5Made: make }));
}
