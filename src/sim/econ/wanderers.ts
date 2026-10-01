import type { StateHasher } from "../hash";
import { hashString, mix32 } from "../rng";
import { goodId, GOODS } from "./defs";
import type { Economy } from "./economy";
import { Feature, Use } from "./landuse";

/**
 * Folk and beasts beyond the borders: nomad caravans that come to trade, hamlets out in the
 * wild that join a settlement once its light reaches them (if the people there look happy),
 * and herds of native creatures that roam the open land and trample fields they wander into.
 */

/** Goods a caravan will take, and what it brings. */
const WANTS = ["plank", "log", "stone", "bread", "fish", "meat", "grain"];
const BRINGS = ["salt", "honey", "glass", "fruit", "gold"];

export interface Caravan {
  id: number;
  owner: number;
  tile: number;
  /** Where it was before its last step, and when it stepped (for smooth drawing). */
  prev: number;
  movedAt: number;
  from: number;
  target: number;
  leaving: boolean;
  /** Gone (left the map). */
  done: boolean;
  until: number;
}

export interface Hamlet {
  tile: number;
  name: string;
  people: number;
  /** Player it joined, or -1. */
  joined: number;
  /** Told its would-be hosts it is waiting for a happier settlement. */
  waiting: boolean;
}

export interface Creature {
  id: number;
  tile: number;
  prev: number;
  movedAt: number;
  herd: number;
  alive: boolean;
}

/** Ticks between steps. */
export const CARAVAN_STEP = 30;
export const CREATURE_STEP = 60;
const HAMLET_NAMES = ["Brackenhold", "Thistledown", "Owlsend", "Marrowby", "Fennick", "Lark's Rest", "Cinderford", "Willowmere", "Stonesthwaite", "Hollin", "Mossgarth", "Tansy Cross"];

export class Wanderers {
  readonly caravans: Caravan[] = [];
  readonly hamlets: Hamlet[] = [];
  readonly creatures: Creature[] = [];
  /** What the creatures are called here (native beasts on other worlds). */
  creatureName = "mossback";
  /** Bumped when a hamlet is placed or joins (render rebuilds). */
  version = 0;
  private seed = 0;
  private trampleTold: number[] = [];

  constructor(private readonly eco: Economy) {}

  /** Place hamlets and herds at the start of a world (away from every starting keep). */
  setup(seed: string, opts: { hamlets: boolean; creatures: boolean; native: boolean }): void {
    const eco = this.eco;
    const land = eco.land;
    const grid = land.planet.grid;
    this.seed = hashString(`${seed}:wanderers`);
    if (opts.native) this.creatureName = "glassback";
    const keeps = eco.keeps.filter((k) => k !== undefined).map((k) => grid.centerOf(eco.buildings[k]!.tile));
    const farFromKeeps = (t: number, steps: number) => {
      const c = grid.centerOf(t);
      return keeps.every((k) => dist2(c, k) > (steps * land.spacing) ** 2);
    };
    const pick = (k: number) => (mix32(this.seed, k) >>> 0) % grid.count;
    if (opts.hamlets) {
      const want = Math.max(2, Math.min(6, Math.round(grid.count / 3000)));
      for (let k = 0; k < 4000 && this.hamlets.length < want; k++) {
        const t = pick(k);
        if (!land.isLand(t) || land.use[t] !== Use.Free || land.feature[t] !== Feature.None || land.slope(t) > 1 || grid.degree(t) === 5) continue;
        if (!farFromKeeps(t, 11) || this.hamlets.some((h) => dist2(grid.centerOf(h.tile), grid.centerOf(t)) < (10 * land.spacing) ** 2)) continue;
        land.use[t] = Use.Blocked;
        this.hamlets.push({ tile: t, name: HAMLET_NAMES[this.hamlets.length % HAMLET_NAMES.length]!, people: 3 + ((mix32(this.seed, t) >>> 0) % 4), joined: -1, waiting: false });
      }
    }
    if (opts.creatures) {
      const herds = Math.max(2, Math.min(8, Math.round(grid.count / 2000)));
      let h = 0;
      for (let k = 5000; k < 9000 && h < herds; k++) {
        const t = pick(k);
        if (!land.isLand(t) || land.use[t] !== Use.Free || !farFromKeeps(t, 9)) continue;
        const spots = [t, ...grid.neighborsOf(t)].filter((n) => land.isLand(n) && land.use[n] === Use.Free).slice(0, 3);
        for (const s of spots) this.creatures.push({ id: this.creatures.length, tile: s, prev: s, movedAt: -CREATURE_STEP, herd: h, alive: true });
        h++;
      }
    }
    this.version++;
  }

  /** A caravan, a hamlet or a beast in sight of a tile (for the renderer). */
  liveCaravans(): Caravan[] {
    return this.caravans.filter((c) => !c.done);
  }

  step(tick: number): void {
    const eco = this.eco;
    if (tick % eco.dayTicks === 0) this.daily(tick);
    if (tick % CARAVAN_STEP === 0) for (const c of this.caravans) if (!c.done) this.moveCaravan(c, tick);
    if (tick % CREATURE_STEP === 0) for (const c of this.creatures) if (c.alive) this.moveCreature(c, tick);
  }

  private daily(tick: number): void {
    const eco = this.eco;
    const land = eco.land;
    const day = Math.floor(tick / eco.dayTicks);
    // Hamlets: join a settlement whose light reaches them, if its people look happy.
    for (const h of this.hamlets) {
      if (h.joined >= 0) continue;
      const owner = (land.territory[h.tile] as number) - 1;
      if (owner < 0 || eco.keeps[owner] === undefined || eco.defeated[owner]) continue;
      if ((eco.glow[owner] ?? 0) >= 50) {
        h.joined = owner;
        land.use[h.tile] = Use.Free;
        eco.welcome(owner, h.people, `Came from the hamlet of ${h.name}, which joined the settlement.`);
        eco.notify(owner, `The hamlet of ${h.name} has joined you: ${h.people} people come to the Hearthship.`);
        this.version++;
      } else if (!h.waiting) {
        h.waiting = true;
        eco.notify(owner, `The hamlet of ${h.name} lies in your light, but its folk will only join a happier settlement (Glow 50).`);
      }
    }
    // Caravans: now and then nomads come to a settlement to trade.
    if (eco.colony || day < 3) return;
    for (let p = 0; p < eco.keeps.length; p++) {
      const keep = eco.buildings[eco.keeps[p] ?? -1];
      if (!keep?.alive || keep.owner !== p || eco.defeated[p]) continue;
      if (this.caravans.some((c) => !c.done && c.owner === p)) continue;
      if ((mix32(this.seed ^ day, p + 77) >>> 0) % 7 !== 0) continue;
      const ring = land.ring(keep.tile, 13).filter((t) => land.isLand(t) && land.territory[t] !== p + 1);
      if (!ring.length) continue;
      const from = ring[(mix32(day, p) >>> 0) % ring.length]!;
      this.caravans.push({ id: this.caravans.length, owner: p, tile: from, prev: from, movedAt: tick, from, target: keep.tile, leaving: false, done: false, until: tick + 3 * eco.dayTicks });
      eco.notify(p, "A nomad caravan is coming to trade. It will take what you have most to spare and leave goods you can't make.");
    }
    // Drop caravans long gone.
    while (this.caravans.length > 32 && this.caravans[0]!.done) this.caravans.shift();
  }

  /** One step toward a tile over land (greedy; a hashed sidestep when blocked). */
  private stepToward(from: number, to: number, salt: number, avoidOwned = false): number {
    const land = this.eco.land;
    const grid = land.planet.grid;
    const goal = grid.centerOf(to);
    const d = (t: number) => {
      const c = grid.centerOf(t);
      return dist2(c, goal);
    };
    const open = [...grid.neighborsOf(from)].filter((n) => land.isLand(n) && land.use[n] !== Use.Building && land.feature[n] !== Feature.Hedge && (!avoidOwned || land.territory[n] === 0));
    if (!open.length) return from;
    let best = from;
    for (const n of open) if (d(n) < d(best) - 1e-15) best = n;
    if (best !== from) return best;
    return open[(mix32(salt, from) >>> 0) % open.length]!;
  }

  private moveCaravan(c: Caravan, tick: number): void {
    const eco = this.eco;
    const grid = eco.land.planet.grid;
    if (tick > c.until) {
      c.done = true;
      return;
    }
    const arrived = c.tile === c.target || grid.neighborsOf(c.target).includes(c.tile);
    if (arrived) {
      if (c.leaving) {
        c.done = true;
        return;
      }
      this.trade(c);
      c.leaving = true;
      c.target = c.from;
      return;
    }
    c.prev = c.tile;
    c.tile = this.stepToward(c.tile, c.target, tick ^ c.id);
    c.movedAt = tick;
  }

  private trade(c: Caravan): void {
    const eco = this.eco;
    const keep = eco.buildings[eco.keeps[c.owner] ?? -1];
    if (!keep?.alive) return;
    let best = -1;
    for (const id of WANTS) {
      const g = goodId(id);
      if ((keep.stock[g] as number) > 6 && (best < 0 || (keep.stock[g] as number) > (keep.stock[best] as number))) best = g;
    }
    if (best < 0) {
      eco.notify(c.owner, "The nomads found nothing to spare in your stores, and move on.");
      return;
    }
    const give = goodId(BRINGS[(mix32(this.seed, c.id) >>> 0) % BRINGS.length]!);
    keep.stock[best] = (keep.stock[best] as number) - 5;
    keep.stock[give] = (keep.stock[give] as number) + 3;
    eco.notify(c.owner, `The nomads trade 3 ${GOODS[give]!.name.toLowerCase()} for 5 ${GOODS[best]!.name.toLowerCase()}, tell tales by the fire, and move on.`);
  }

  private moveCreature(c: Creature, tick: number): void {
    const eco = this.eco;
    const land = eco.land;
    const grid = land.planet.grid;
    // Wander, keeping near the herd's first beast, and shy of settled land.
    const lead = this.creatures.find((x) => x.alive && x.herd === c.herd)!;
    const r = mix32(tick ^ this.seed, c.id) >>> 0;
    if (r % 3 === 0) return;
    const open = [...grid.neighborsOf(c.tile)].filter((n) => land.isLand(n) && land.use[n] !== Use.Building && land.use[n] !== Use.Flag && land.feature[n] !== Feature.Hedge);
    if (!open.length) return;
    const wild = open.filter((n) => land.territory[n] === 0);
    let next = (wild.length && r % 4 !== 0 ? wild : open)[(r >>> 4) % (wild.length && r % 4 !== 0 ? wild : open).length]!;
    if (lead !== c && dist2(grid.centerOf(c.tile), grid.centerOf(lead.tile)) > (3 * land.spacing) ** 2) next = this.stepToward(c.tile, lead.tile, r);
    c.prev = c.tile;
    c.tile = next;
    c.movedAt = tick;
    // Trampling: a beast in a field sets the crop back.
    if (land.feature[next] === Feature.Field && (land.amount[next] as number) > 0) {
      land.amount[next] = (land.amount[next] as number) - 1;
      const owner = (land.territory[next] as number) - 1;
      const day = Math.floor(tick / eco.dayTicks);
      if (owner >= 0 && (this.trampleTold[owner] ?? -9) < day - 2) {
        this.trampleTold[owner] = day;
        eco.notify(owner, `Wild ${this.creatureName}s are trampling your fields. Hedges keep them out.`);
      }
    }
  }

  hash(h: StateHasher): void {
    h.int(this.caravans.length).int(this.creatures.length);
    for (const c of this.caravans) if (!c.done) h.int(c.tile).int(c.leaving ? 1 : 0);
    for (const c of this.creatures) h.int(c.tile);
    for (const x of this.hamlets) h.int(x.joined);
  }
}

function dist2(a: readonly number[], b: readonly number[]): number {
  const x = (a[0] as number) - (b[0] as number);
  const y = (a[1] as number) - (b[1] as number);
  const z = (a[2] as number) - (b[2] as number);
  return x * x + y * y + z * z;
}
