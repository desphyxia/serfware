import type { StateHasher } from "../hash";
import { mix32 } from "../rng";
import { goodId, GOODS } from "./defs";
import type { Economy } from "./economy";

/**
 * Diplomacy between settlements: truces, trade pacts, shared roads and prisoner exchanges.
 * Treaties are enforced by the game itself (no attacks during a truce, roads allowed on a
 * partner's land, goods moving daily under a pact). Breaking one is possible but costs: the
 * breaker's people feel the shame (Glow falls for days) and their reputation drops, so others
 * are slower to trust them.
 */

export type TreatyKind = "truce" | "trade" | "roads" | "prisoners";

export const TREATIES: Record<TreatyKind, { name: string; days: number; note: string }> = {
  truce: { name: "Truce", days: 12, note: "No attacks either way while it holds." },
  trade: { name: "Trade pact", days: 16, note: "Each morning, each side sends the other a few of what it has most to spare." },
  roads: { name: "Shared roads", days: 20, note: "Each may lay flags and roads on the other's land." },
  prisoners: { name: "Prisoner exchange", days: 1, note: "All prisoners on both sides go home at once." },
};

export interface Treaty {
  id: number;
  kind: TreatyKind;
  a: number;
  b: number;
  /** In force until this tick. */
  until: number;
  broken: boolean;
}

export interface Proposal {
  id: number;
  kind: TreatyKind;
  from: number;
  to: number;
  at: number;
  open: boolean;
}

export type DiplomacyCommand = (
  | { t: "propose"; to: number; kind: TreatyKind }
  | { t: "answer"; proposal: number; accept: boolean }
  | { t: "break"; with: number }
) & { player?: number };

export const DIPLOMACY_COMMANDS = new Set(["propose", "answer", "break"]);

/** Goods that trade pacts carry. */
const TRADE_GOODS = ["plank", "stone", "log", "bread", "fish", "meat", "coal", "iron", "grain"];

export class Diplomacy {
  readonly treaties: Treaty[] = [];
  readonly proposals: Proposal[] = [];
  /** Per player: 0..100; 50 to start. Broken treaties cost 25. */
  readonly reputation: number[] = [];
  /** Per player: shamed (Glow lower) until this tick. */
  readonly shameUntil: number[] = [];
  /**
   * Answering for AI players: set by the world (the AI's personality decides). Returns accept or
   * decline. Humans answer with commands.
   */
  aiAnswer: ((p: number, proposal: Proposal) => boolean) | null = null;

  constructor(private readonly eco: Economy) {}

  rep(p: number): number {
    return this.reputation[p] ?? 50;
  }

  /** Treaties in force between two players (optionally of one kind). */
  between(p: number, q: number, kind?: TreatyKind): Treaty[] {
    const t = this.eco.tick;
    return this.treaties.filter((x) => !x.broken && x.until > t && ((x.a === p && x.b === q) || (x.a === q && x.b === p)) && (!kind || x.kind === kind));
  }

  truce(p: number, q: number): boolean {
    return this.between(p, q, "truce").length > 0;
  }

  apply(cmd: DiplomacyCommand): { ok: boolean; reason?: string } {
    const eco = this.eco;
    const p = cmd.player ?? 0;
    if (eco.keeps[p] === undefined) return { ok: false, reason: "Unknown player." };
    switch (cmd.t) {
      case "propose": {
        const q = cmd.to;
        if (q === p || eco.keeps[q] === undefined || eco.defeated[q]) return { ok: false, reason: "There is no one there to talk to." };
        if (eco.allied(p, q)) return { ok: false, reason: "You are on the same team: allies need no treaties." };
        if (!TREATIES[cmd.kind]) return { ok: false, reason: "Unknown treaty." };
        if (cmd.kind !== "prisoners" && this.between(p, q, cmd.kind).length) return { ok: false, reason: `You already have a ${TREATIES[cmd.kind].name.toLowerCase()}.` };
        if (this.proposals.some((x) => x.open && x.from === p && x.to === q && x.kind === cmd.kind)) return { ok: false, reason: "That offer is already on the table." };
        const prop: Proposal = { id: this.proposals.length, kind: cmd.kind, from: p, to: q, at: eco.tick, open: true };
        this.proposals.push(prop);
        // AI settlements answer at once; people get a notice and answer when they like.
        const ai = this.aiAnswer;
        if (ai && this.isAi(q)) this.answer(prop, ai(q, prop));
        else eco.notify(q, `${this.name(p)} offers a ${TREATIES[cmd.kind].name.toLowerCase()}. (Diplomacy, J)`);
        return { ok: true };
      }
      case "answer": {
        const prop = this.proposals[cmd.proposal];
        if (!prop || !prop.open || prop.to !== p) return { ok: false, reason: "No such offer." };
        this.answer(prop, cmd.accept);
        return { ok: true };
      }
      case "break": {
        const live = this.between(p, cmd.with);
        if (!live.length) return { ok: false, reason: "No treaty to break." };
        this.breakAll(p, cmd.with);
        return { ok: true };
      }
    }
  }

  /** Is a player an AI rival (they answer for themselves)? */
  isAi(p: number): boolean {
    return this.eco.aiPlayers.has(p);
  }

  name(p: number): string {
    return this.eco.playerName(p);
  }

  private answer(prop: Proposal, accept: boolean): void {
    const eco = this.eco;
    prop.open = false;
    if (!accept) {
      eco.notify(prop.from, `${this.name(prop.to)} declines the ${TREATIES[prop.kind].name.toLowerCase()}.`);
      return;
    }
    if (prop.kind === "prisoners") {
      const n = this.exchange(prop.from, prop.to);
      eco.notify(prop.from, `Prisoners exchanged with ${this.name(prop.to)}: ${n} people come home.`);
      eco.notify(prop.to, `Prisoners exchanged with ${this.name(prop.from)}: ${n} people come home.`);
      return;
    }
    const t: Treaty = { id: this.treaties.length, kind: prop.kind, a: prop.from, b: prop.to, until: eco.tick + TREATIES[prop.kind].days * eco.dayTicks, broken: false };
    this.treaties.push(t);
    this.sync();
    for (const [x, y] of [
      [prop.from, prop.to],
      [prop.to, prop.from],
    ] as const)
      eco.notify(x, `A ${TREATIES[prop.kind].name.toLowerCase()} with ${this.name(y)} for ${TREATIES[prop.kind].days} days: ${TREATIES[prop.kind].note}`);
  }

  /** Free every prisoner held between two players. */
  exchange(p: number, q: number): number {
    const eco = this.eco;
    let n = 0;
    for (const person of eco.people) {
      if (!person.alive || person.captive === undefined) continue;
      if ((person.owner === p && person.captive === q) || (person.owner === q && person.captive === p)) {
        person.captive = undefined;
        person.woundedUntil = eco.tick;
        n++;
      }
    }
    return n;
  }

  /** Break every treaty with another: shame at home, and a name others remember. */
  breakAll(p: number, q: number): void {
    const eco = this.eco;
    for (const t of this.between(p, q)) t.broken = true;
    this.reputation[p] = Math.max(0, this.rep(p) - 25);
    this.shameUntil[p] = eco.tick + 4 * eco.dayTicks;
    this.sync();
    eco.notify(p, `You have broken your word to ${this.name(q)}. Your people are ashamed, and others will remember.`);
    eco.notify(q, `${this.name(p)} has broken their treaties with you!`);
  }

  /** Shared roads: who may lay roads on whose land (kept on the land for road checks). Allies always may. */
  sync(): void {
    const eco = this.eco;
    const land = eco.land;
    const before = land.roadShare.slice();
    land.roadShare.length = 0;
    for (let p = 0; p < eco.keeps.length; p++) for (let q = 0; q < eco.keeps.length; q++) if (p !== q && eco.allied(p, q)) land.roadShare[p] = (land.roadShare[p] ?? 0) | (1 << q);
    for (const t of this.treaties) {
      if (t.broken || t.until <= this.eco.tick || t.kind !== "roads") continue;
      land.roadShare[t.a] = (land.roadShare[t.a] ?? 0) | (1 << t.b);
      land.roadShare[t.b] = (land.roadShare[t.b] ?? 0) | (1 << t.a);
    }
    if (before.some((m, p) => ((m ?? 0) & ~(land.roadShare[p] ?? 0)) !== 0)) this.eco.dropForeignRoads();
  }

  /** Daily: trade pacts move goods, treaties run out, reputation slowly mends. */
  daily(): void {
    const eco = this.eco;
    const tick = eco.tick;
    for (const t of this.treaties) {
      if (t.broken || t.until <= tick) continue;
      if (t.kind === "trade") {
        this.ship(t.a, t.b);
        this.ship(t.b, t.a);
      }
    }
    for (const t of this.treaties) {
      if (!t.broken && t.until <= tick && t.until > tick - eco.dayTicks) {
        eco.notify(t.a, `The ${TREATIES[t.kind].name.toLowerCase()} with ${this.name(t.b)} has run its course.`);
        eco.notify(t.b, `The ${TREATIES[t.kind].name.toLowerCase()} with ${this.name(t.a)} has run its course.`);
      }
    }
    for (let p = 0; p < eco.keeps.length; p++) if (eco.keeps[p] !== undefined) this.reputation[p] = Math.min(100, this.rep(p) + 1);
    this.sync();
  }

  /** Under a trade pact: send up to three of the good one has most to spare (and the other lacks). */
  private ship(from: number, to: number): void {
    const eco = this.eco;
    const src = eco.buildings[eco.keeps[from] ?? -1];
    const dst = eco.buildings[eco.keeps[to] ?? -1];
    if (!src?.alive || !dst?.alive) return;
    let best = -1;
    let gap = 4;
    for (const id of TRADE_GOODS) {
      const g = goodId(id);
      const d = (src.stock[g] as number) - (dst.stock[g] as number);
      if ((src.stock[g] as number) > 8 && d > gap) {
        best = g;
        gap = d;
      }
    }
    if (best < 0) return;
    const n = Math.min(3, (src.stock[best] as number) - 8);
    src.stock[best] = (src.stock[best] as number) - n;
    dst.stock[best] = (dst.stock[best] as number) + n;
    if (mix32(eco.tick, from) % 4 === 0) eco.notify(to, `Traders from ${this.name(from)} bring ${n} ${GOODS[best]!.name.toLowerCase()}.`);
  }

  /** Glow's shame after breaking a treaty. */
  shamed(p: number): boolean {
    return (this.shameUntil[p] ?? -1) > this.eco.tick;
  }

  hash(h: StateHasher): void {
    h.int(this.treaties.length).int(this.proposals.length);
    for (const t of this.treaties) h.int(t.until).int(t.broken ? 1 : 0);
    for (const r of this.reputation) h.int(r ?? 50);
    for (const p of this.proposals) h.int(p.open ? 1 : 0);
    for (const p of this.eco.people) if (p.alive && p.captive !== undefined) h.int(p.id).int(p.captive);
  }
}
