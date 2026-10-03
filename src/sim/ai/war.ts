import { goodId } from "../econ/defs";
import type { Building } from "../econ/economy";
import { ARM_MOUNT } from "../econ/people";
import { AI_LEVELS } from "./personality";
import type { AiLevel, Personality } from "./personality";
import type { AiContext } from "./brain";

/** Odds a Warden wants before it will break a truce to strike. */
const BREAK_ODDS = 0.85;
/** Enemy flags tried in one raid thought. */
const RAID_TRIES = 2;

/**
 * The scripted AI's preparations for and acts of war beyond ordinary attacks: palisades round lanterns on a
 * threatened border, a field camp at the lantern an attack will start from, outriders to cut bare enemy flags,
 * and (Wardens only) breaking a truce when the odds are overwhelming. Each step gives at most one order.
 */
export class WarPlanner {
  constructor(
    private readonly player: number,
    private readonly personality: Personality,
    private readonly level: AiLevel,
  ) {}

  private readonly rest = new Map<string, number>();
  private thoughts = 0;

  private can(key: string): boolean {
    return (this.rest.get(key) ?? 0) <= this.thoughts;
  }

  private wait(key: string, thoughts: number): void {
    this.rest.set(key, this.thoughts + thoughts);
  }

  step(ctx: AiContext, thoughts: number): boolean {
    this.thoughts = thoughts;
    const eco = ctx.eco;
    const pl = this.player;
    // Preparing starts a day before the peace ends.
    if (ctx.tick < eco.peaceUntil - eco.dayTicks || eco.defeated[pl]) return false;
    const stock = eco.storageTotals(pl);
    const plank = stock[goodId("plank")] ?? 0;
    const log = stock[goodId("log")] ?? 0;
    const border = eco.buildings.filter((b) => b.alive && b.owner === pl && b.built && b.lit && b.def.slots && b.threat >= 2 && !eco.keeps.includes(b.id));

    // A palisade round a lantern on the front, once there is timber to spare.
    if (this.can("palisade") && plank >= 10 && log >= 4) {
      const open = border.find((b) => !b.palisade);
      if (open) {
        this.wait("palisade", 6);
        if (ctx.act({ t: "palisade", building: open.id }).ok) return true;
      }
    }
    // A Warden pitches a field camp at the front lantern the attack will start from.
    if (this.personality === "warden" && this.can("camp") && plank >= 6 && log >= 4) {
      const open = border.find((b) => b.camp === 0);
      if (open) {
        this.wait("camp", 5);
        if (ctx.act({ t: "camp", building: open.id }).ok) return true;
      }
    }
    if (ctx.tick < eco.peaceUntil) return false;
    if (this.can("raid") && this.personality !== "builder" && this.raid(ctx)) return true;
    if (this.personality === "warden" && this.can("break") && this.breakTruce(ctx)) return true;
    return false;
  }

  /** Outriders at the nearest bare, unwatched enemy flags. */
  private raid(ctx: AiContext): boolean {
    const eco = ctx.eco;
    const pl = this.player;
    const keep = eco.buildings[eco.keeps[pl] ?? -1];
    if (!keep) return false;
    // Outriders need a mounted warden on a lantern's watch (a stable makes the mounts).
    if (!eco.settlers.some((x) => x.alive && x.owner === pl && x.role === "warden" && ((eco.people[x.person]?.arms ?? 0) & ARM_MOUNT) !== 0)) return false;
    const c = ctx.world.planet.grid.center;
    const away = (t: number) => (c[t * 3]! - c[keep.tile * 3]!) ** 2 + (c[t * 3 + 1]! - c[keep.tile * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - c[keep.tile * 3 + 2]!) ** 2;
    const flags = eco.flags
      .filter((f) => f.alive && f.owner !== pl && f.building < 0 && !eco.allied(pl, f.owner) && !eco.diplomacy.truce(pl, f.owner) && !eco.defeated[f.owner])
      .sort((a, b) => away(a.tile) - away(b.tile) || a.id - b.id)
      .slice(0, RAID_TRIES);
    for (const f of flags) {
      if (ctx.act({ t: "raid", flag: f.id }).ok) {
        this.wait("raid", 8);
        return true;
      }
    }
    this.wait("raid", 30);
    return false;
  }

  /** A truce in the way of a sure thing: break it, at the cost in Glow and reputation. */
  private breakTruce(ctx: AiContext): boolean {
    const eco = ctx.eco;
    const pl = this.player;
    this.wait("break", 20);
    const need = Math.max(BREAK_ODDS, AI_LEVELS[this.level].odds + 0.1);
    for (const t of eco.buildings) {
      if (!t.alive || !t.built || t.owner === pl || !t.def.light || eco.defeated[t.owner] || !eco.diplomacy.truce(pl, t.owner) || eco.allied(pl, t.owner)) continue;
      const pool = eco.attackersFor(pl, t).length;
      if (pool < 3 || !this.sure(ctx, t, pool, need)) continue;
      return ctx.act({ t: "break", with: t.owner }).ok;
    }
    return false;
  }

  private sure(ctx: AiContext, target: Building, pool: number, need: number): boolean {
    return ctx.eco.attackOdds(this.player, target, pool) >= need;
  }
}
