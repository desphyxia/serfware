import type { StateHasher } from "../hash";
import { goodId } from "../econ/defs";
import type { AdversityKind } from "../econ/adversity";
import type { TreatyKind } from "../econ/diplomacy";
import type { World, WorldOptions } from "../world";

/**
 * Scenarios: a world with goals to reach, triggers that fire scripted events, and a story told
 * in notices. The tutorial, the chapters of The Long Voyage and the handmade scenarios are all
 * scenarios. Everything here runs inside the simulation (goals are checked on fixed ticks, events
 * are ordinary changes to the world), so co-op players see the same story at the same moment.
 */

/** Something that is true or not about the world, for the player (or team) the scenario follows. */
export type Condition =
  | { k: "build"; type: string; n?: number }
  | { k: "buildings"; n: number }
  | { k: "roads"; n: number }
  | { k: "flags"; n: number }
  | { k: "people"; n: number }
  | { k: "glow"; n: number }
  | { k: "stock"; good: string; n: number }
  | { k: "land"; n: number }
  | { k: "lit"; n: number }
  | { k: "page"; id: string }
  | { k: "pages"; n: number }
  | { k: "day"; n: number }
  | { k: "wardens"; rank: number; n: number }
  | { k: "probe" }
  | { k: "colony" }
  | { k: "rooted" }
  | { k: "bloom" }
  | { k: "defeated"; player: number }
  | { k: "wells"; n: number }
  | { k: "hamlet" }
  | { k: "treaty"; kind: TreatyKind }
  | { k: "all"; of: Condition[] };

/** What a trigger does when it fires. */
export type Action =
  | { a: "say"; text: string }
  | { a: "give"; good: string; n: number }
  | { a: "event"; kind: AdversityKind; hours?: number }
  | { a: "peace"; days: number };

export interface Goal {
  text: string;
  when: Condition;
  /** A pointer for the player (the tutorial highlights `tool` in the toolbar). */
  hint?: string;
  tool?: string;
}

export interface Trigger {
  when: Condition;
  do: Action[];
}

export interface ScenarioDef {
  id: string;
  kind: "tutorial" | "chapter" | "scenario" | "custom";
  /** Custom scenarios: who made it. */
  author?: string;
  /** Chapters: their number in The Long Voyage. */
  chapter?: number;
  title: string;
  /** One line for the menu. */
  blurb: string;
  seed: string;
  opts?: WorldOptions;
  /** Told when the scenario begins (a few short paragraphs). */
  intro: string;
  goals: Goal[];
  /** Goals one at a time (the tutorial), or all at once. */
  sequential?: boolean;
  triggers?: Trigger[];
  /** Lose if this becomes true first. */
  fail?: { when: Condition; text: string };
  /** Told when every goal is reached. */
  outro: string;
  /** Changes made to the world before the first tick (head starts for later chapters). */
  setup?: (w: World) => void;
}

/** A scenario in play: which goals are reached, which triggers have fired. */
export class ScenarioRun {
  /** Tick each goal was reached, or -1. */
  readonly reached: number[];
  readonly fired: boolean[];
  readonly start: number;
  completeAt = -1;
  failedAt = -1;
  /** Bumped when anything here changes (the UI redraws). */
  version = 0;

  constructor(
    readonly def: ScenarioDef,
    private readonly world: World,
    /** The player whose settlement the scenario follows (co-op: everyone builds player 0's). */
    readonly player = 0,
  ) {
    this.reached = def.goals.map(() => -1);
    this.fired = (def.triggers ?? []).map(() => false);
    this.start = world.tick;
  }

  get done(): boolean {
    return this.completeAt >= 0;
  }

  get failed(): boolean {
    return this.failedAt >= 0;
  }

  /** The goal being worked on (sequential scenarios), or -1. */
  get current(): number {
    return this.reached.findIndex((t) => t < 0);
  }

  /** Check goals and triggers (every 50 ticks, inside the simulation step). */
  step(tick: number): void {
    if (tick % 50 !== 0 || this.done || this.failed) return;
    const w = this.world;
    const eco = w.economy;
    const p = this.player;
    for (let i = 0; i < this.def.goals.length; i++) {
      if (this.reached[i]! >= 0) continue;
      if (this.def.sequential && i !== this.current) break;
      if (!this.holds(this.def.goals[i]!.when)) continue;
      this.reached[i] = tick;
      this.version++;
      eco.notify(p, `✓ ${this.def.goals[i]!.text}`);
      const next = this.def.sequential ? this.def.goals[i + 1] : undefined;
      if (next?.hint) eco.notify(p, next.hint);
    }
    (this.def.triggers ?? []).forEach((t, i) => {
      if (this.fired[i] || !this.holds(t.when)) return;
      this.fired[i] = true;
      this.version++;
      for (const a of t.do) this.act(a);
    });
    if (this.reached.every((t) => t >= 0)) {
      this.completeAt = tick;
      this.version++;
      eco.notify(p, this.def.outro);
    } else if (this.def.fail && this.holds(this.def.fail.when)) {
      this.failedAt = tick;
      this.version++;
      eco.notify(p, this.def.fail.text);
    }
  }

  private act(a: Action): void {
    const w = this.world;
    const eco = w.economy;
    const p = this.player;
    const keep = eco.buildings[eco.keeps[p] ?? -1];
    switch (a.a) {
      case "say":
        eco.notify(p, a.text);
        break;
      case "give":
        if (keep) keep.stock[goodId(a.good)] = (keep.stock[goodId(a.good)] as number) + a.n;
        break;
      case "event":
        if (keep) {
          const e = eco.adversity.foretell(a.kind, p, keep.tile, w.tick);
          if (a.hours !== undefined) {
            const hour = Math.max(1, Math.round(eco.dayTicks / 24));
            const shift = w.tick + a.hours * hour - e.at;
            e.at += shift;
            e.until += shift;
          }
        }
        break;
      case "peace":
        eco.peaceUntil = Math.max(eco.peaceUntil, w.tick + a.days * eco.dayTicks);
        break;
    }
  }

  /** Is a condition true now? */
  holds(c: Condition): boolean {
    const w = this.world;
    const eco = w.economy;
    const p = this.player;
    const mine = () => eco.buildings.filter((b) => b.alive && b.built && b.owner === p);
    switch (c.k) {
      case "build":
        return mine().filter((b) => b.def.id === c.type).length >= (c.n ?? 1);
      case "buildings":
        return mine().length >= c.n;
      case "flags":
        return eco.flags.filter((f) => f.alive && f.owner === p).length >= c.n;
      case "roads":
        return eco.roads.filter((r) => r.alive && r.owner === p).length >= c.n;
      case "people":
        return eco.peopleOf(p).length >= c.n;
      case "glow":
        return (eco.glow[p] ?? 0) >= c.n;
      case "stock":
        return (eco.storageTotals(p)[goodId(c.good)] ?? 0) >= c.n;
      case "land": {
        let n = 0;
        for (let t = 0; t < w.land.territory.length; t++) if (w.land.territory[t] === p + 1) n++;
        return n >= c.n;
      }
      case "lit":
        return mine().filter((b) => b.def.slots && b.lit).length >= c.n;
      case "page":
        return eco.culture.has(p, c.id);
      case "pages":
        return (eco.culture.pages[p]?.length ?? 0) >= c.n;
      case "day":
        return w.tick - this.start >= c.n * eco.dayTicks;
      case "wardens":
        return eco.people.filter((x) => x.alive && x.owner === p && x.rank >= c.rank).length >= c.n;
      case "probe":
        return ((w.voyages?.surveyed[p] ?? 0) & ~(1 << w.system.home)) !== 0;
      case "colony":
        return w.colonies.some((c2) => c2 && c2.economy.keeps[p] !== undefined);
      case "rooted":
        return w.colonies.some((c2) => c2?.economy.rooted[p]);
      case "bloom":
        return w.colonies.some((c2) => c2?.atmosphere.bloom);
      case "defeated":
        return !!eco.defeated[c.player];
      case "wells": {
        const grid = w.planet.grid;
        let n = 0;
        for (let t = 0; t < grid.count; t++) if (grid.degree(t) === 5 && w.land.territory[t] === p + 1) n++;
        return n >= c.n;
      }
      case "hamlet":
        return eco.wanderers.hamlets.some((h) => h.joined === p);
      case "treaty":
        return eco.keeps.some((_, q) => q !== p && eco.diplomacy.between(p, q, c.kind).length > 0);
      case "all":
        return c.of.every((x) => this.holds(x));
    }
  }

  hash(h: StateHasher): void {
    h.str(this.def.id).int(this.completeAt).int(this.failedAt);
    for (const t of this.reached) h.int(t);
    for (const f of this.fired) h.int(f ? 1 : 0);
  }
}
