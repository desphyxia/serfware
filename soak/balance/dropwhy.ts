import { AiBuilder, aiOptions } from "../../src/sim/ai/builder";
import { Economy } from "../../src/sim/econ/economy";
import { Feature, fellable, Use } from "../../src/sim/econ/landuse";
import { feedingForesters } from "../../src/sim/econ/planner";
import { World } from "../../src/sim/world";

/**
 * What `dropIdleWoodcutters` pulls down and what takes the ground: `node dropwhy.mjs <size> <seed> <days>` plays the assess game with
 * the switch on (DROP=0 plays without it; CUTTREES=1 adds `woodcutterTrees`) and prints one JSON line: per rival seat, the woodcutters pulled down while the seat stood
 * (day, flags taken with it), and at the end what stands on each freed tile and how many buildings placed after it stand within 2
 * steps (by kind). Read-only apart from the switch.
 */
const [size, seed, daysArg] = process.argv.slice(2) as ["tiny" | "small" | "medium", string, string];
aiOptions.dropIdleWoodcutters = process.env.DROP !== "0";
aiOptions.woodcutterTrees = process.env.CUTTREES === "1";
type Ev = { tick: number; owner: number; tile: number; flags: number; nextId: number };
const drops: Ev[] = [];
const proto = Economy.prototype as unknown as Record<string, (this: Economy, x: never) => void>;
const removeBuilding = proto.removeBuilding as (this: Economy, b: never) => void;
const removeFlag = proto.removeFlag as (this: Economy, f: never) => void;
let flagsAt = { tick: -1, owner: -1, n: 0 };
proto.removeFlag = function (f: never) {
  const fl = f as { alive: boolean; owner: number };
  if (fl.alive) {
    if (flagsAt.tick !== this.tick || flagsAt.owner !== fl.owner) flagsAt = { tick: this.tick, owner: fl.owner, n: 0 };
    flagsAt.n++;
    const last = drops[drops.length - 1];
    if (last && last.tick === this.tick && last.owner === fl.owner) last.flags = flagsAt.n;
  }
  removeFlag.call(this, f);
};
proto.removeBuilding = function (b: never) {
  const bb = b as { alive: boolean; owner: number; tile: number; def: { id: string } };
  if (bb.alive && bb.def.id === "woodcutter" && !this.defeated[bb.owner] && bb.owner > 0) {
    drops.push({ tick: this.tick, owner: bb.owner, tile: bb.tile, flags: flagsAt.tick === this.tick && flagsAt.owner === bb.owner ? flagsAt.n : 0, nextId: this.buildings.length });
  }
  removeBuilding.call(this, b);
};
const w = new World(seed, {
  size,
  rivals: 3,
  personalities: ["builder", "trader", "warden"],
  aiLevel: "normal",
  difficulty: "honest",
  peaceDays: 5,
  latticeRoads: true,
  brain: (s: { player: number; rng: never; personality: never; level: never }) => new AiBuilder(s.player, s.rng, s.personality, s.level),
} as never);
w.command({ t: "steward", of: 0, on: true });
const eco = w.economy;
const land = w.land;
/** Every 10 days: the rival seats' finished woodcutters, by which of `woodcutterSpent`'s conditions hold. */
const census: Record<string, number | string>[] = [];
const look = (): void => {
  const c: Record<string, number | string> = { day: Math.round(w.tick / eco.dayTicks) };
  const add = (k: string) => (c[k] = ((c[k] as number) ?? 0) + 1);
  for (const b of eco.buildings) {
    if (!b.alive || !b.built || b.owner < 1 || b.def.id !== "woodcutter") continue;
    add("cutters");
    const reach = land.ring(b.tile, b.def.radius ?? 5);
    const ripe = reach.some((t) => fellable(land, t));
    const young = reach.some((t) => land.feature[t] === Feature.Tree && (land.variety[t] as number) <= 3 && !fellable(land, t));
    const inReach = new Set(reach);
    const planted = eco.buildings.some((f) => f.alive && f.owner === b.owner && f.def.id === "forester" && land.ring(f.tile, f.def.radius ?? 5).some((t) => inReach.has(t)));
    const feeding = feedingForesters(w, b) > 0;
    const idle = b.busyPrev === 0;
    if (idle) add("idleYesterday");
    if (idle && !ripe) add("idleNoRipeTree");
    if (idle && !ripe && young) add("idleNoRipeButSapling");
    if (idle && !ripe && planted) add("idleNoRipeButForesterTouching");
    if (idle && !ripe && feeding) add("idleNoRipeButForesterFeeding");
    if (idle && !ripe && !young && !feeding) add("idleSpent");
    if (b.worker < 0) add("noWorker");
  }
  census.push(c);
};
while (w.tick < Number(daysArg) * eco.dayTicks && eco.winner < 0) {
  w.step();
  if (w.tick % (10 * eco.dayTicks) === 0) look();
}
const seats = [1, 2, 3].map((p) => {
  const mine = drops.filter((d) => d.owner === p);
  const onTile: Record<string, number> = {};
  const nearby: Record<string, number> = {};
  let reused = 0;
  for (const d of mine) {
    const use = land.use[d.tile];
    const what = use === Use.Building ? `building:${eco.buildings[land.ref[d.tile] as number]?.def.id}` : use === Use.Flag ? "flag" : use === Use.Road ? "road" : use === Use.Free ? "free" : `use${use}`;
    onTile[what] = (onTile[what] ?? 0) + 1;
    const ring = new Set(land.ring(d.tile, 2));
    const later = eco.buildings.filter((b) => b.alive && b.owner === p && b.id >= d.nextId && ring.has(land.pt(b.tile)));
    if (later.length) reused++;
    for (const b of later) nearby[b.def.id] = (nearby[b.def.id] ?? 0) + 1;
  }
  const cutters = eco.buildings.filter((b) => b.alive && b.owner === p && b.def.id === "woodcutter").length;
  return {
    seat: p,
    fallen: !!eco.defeated[p],
    dropped: mine.length,
    days: mine.map((d) => Math.round((d.tick / eco.dayTicks) * 10) / 10),
    flagsWith: mine.map((d) => d.flags),
    onTileAtEnd: onTile,
    withNewBuildingWithin2: reused,
    newNearbyByKind: nearby,
    woodcuttersAtEnd: cutters,
  };
});
console.log(JSON.stringify({ size, seed, day: Math.round((w.tick / eco.dayTicks) * 10) / 10, winner: eco.winner, drop: aiOptions.dropIdleWoodcutters, cuttrees: aiOptions.woodcutterTrees, seats, census }));
