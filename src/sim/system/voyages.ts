import { ticksPerDay } from "../clock";
import { pow } from "../dmath";
import { GOODS, goodsArray } from "../econ/defs";
import type { Building, CommandResult, Economy, Founder } from "../econ/economy";
import { note } from "../econ/people";
import type { StateHasher } from "../hash";
import { Rng } from "../rng";
import { launchWindow, type StarSystem, type SystemPlanet } from "./system";

/**
 * Colonisation: voyages between the planets of the star system.
 *
 * Every voyage starts at a launch rail, which asks carriers for its cargo like any building
 * asks for inputs. Probes fly as soon as they are loaded and reveal a planet. Hearthships and
 * skyships wait for the launch window. A Hearthship arriving at a surveyed planet waits in
 * orbit for its owner to choose where to land; there it unpacks into a keep and a colony
 * begins: a world of its own, stepped in lockstep with home. Skyships run trade routes.
 */

/** System days (orbits) that pass per home-world day: the planets wheel round quickly enough to play. */
export const ORBIT_SPEED = 12;
/** A window counts as open for this many system days either side of the ideal moment. */
export const WINDOW_DAYS = 2;
/** What a Hearthship can carry, in mass units: a settler weighs three, a good one (skystone a quarter). */
export const HEARTHSHIP_MASS = 90;
export const SETTLER_MASS = 3;
export const MIN_FOUNDERS = 6;
/** Most goods one skyship carries on a route run. */
export const SKYSHIP_CARGO = 16;
/** Materials for the craft itself, on top of the cargo. */
export const PROBE_COST: Record<string, number> = { plank: 2, iron: 2 };
export const HEARTHSHIP_FRAME: Record<string, number> = { plank: 10, iron: 4 };
export const SKYSHIP_FRAME: Record<string, number> = { plank: 2 };
/** Land a colony claims around its keep. */
const COLONY_RADIUS = 6;

export type VoyageKind = "probe" | "hearthship" | "skyship";
/**
 * loading: cargo still coming to the rail; waiting: loaded, for the window (or founders);
 * flying; orbit: a Hearthship over its target, waiting for a landing site; done.
 */
export type VoyageState = "loading" | "waiting" | "flying" | "orbit" | "done";

export interface Voyage {
  id: number;
  kind: VoyageKind;
  owner: number;
  from: number;
  to: number;
  state: VoyageState;
  /** Launch rail building id (in the `from` world). */
  rail: number;
  /** Goods to load (frame included) and goods carried (delivered on arrival). */
  load: number[];
  cargo: number[];
  /** Hearthships: settlers to take, and once aboard, who they are. */
  settlers: number;
  founders: Founder[];
  departs: number;
  arrives: number;
  /** Trade route this skyship runs, or -1. */
  route: number;
  /** Notified that it is short of founders. */
  warned: boolean;
}

export interface Route {
  id: number;
  owner: number;
  from: number;
  to: number;
  good: number;
  amount: number;
  active: boolean;
  /** Skyship runs completed. */
  runs: number;
}

export type VoyageCommand = (
  | { t: "probe"; from: number; to: number }
  | { t: "hearthship"; from: number; to: number; settlers: number; cargo: Record<string, number> }
  | { t: "land"; voyage: number; tile: number }
  | { t: "route"; from: number; to: number; good: string; amount: number }
  | { t: "unroute"; route: number }
) & { player?: number };

export const VOYAGE_COMMANDS = new Set(["probe", "hearthship", "land", "route", "unroute"]);

/** How the voyages see the worlds (the home world owns them; see World). */
export interface WorldHost {
  readonly seed: string;
  readonly tick: number;
  readonly system: StarSystem;
  /** Everyone who can act: people and AI rivals alike. */
  readonly players: number;
  economyAt(planet: number): Economy | null;
  /** The colony world on a planet, created on the first landing there. */
  colonize(planet: number): Economy;
}

/** Mass of a good aboard a Hearthship. */
export function goodMass(type: number): number {
  return GOODS[type]?.id === "skystone" ? 0.25 : 1;
}

/** Walking pace of someone raised at gravity `from`, on a world of gravity `to`. */
export function strideFor(from: number, to: number): number {
  return Math.max(0.85, Math.min(1.2, pow(from / to, 0.3)));
}

export class Voyages {
  readonly list: Voyage[] = [];
  readonly routes: Route[] = [];
  /** Per player: bitmask of planets a probe of theirs has reached. */
  readonly surveyed: number[] = [];
  /** Voyage notices for players (the UI shows its own player's). */
  readonly notices: { owner: number; text: string }[] = [];

  constructor(private readonly host: WorldHost) {
    for (let p = 0; p < host.players; p++) this.surveyed[p] = 1 << host.system.home;
  }

  private get dayTicks(): number {
    return ticksPerDay(this.host.system.planets[this.host.system.home]!.dayLengthHours);
  }

  /** System day (orbital clock) at a tick. */
  systemDay(tick: number): number {
    return (tick / this.dayTicks) * ORBIT_SPEED;
  }

  /** Ticks per system day. */
  get sysDayTicks(): number {
    return this.dayTicks / ORBIT_SPEED;
  }

  isSurveyed(owner: number, planet: number): boolean {
    return ((this.surveyed[owner] ?? 0) & (1 << planet)) !== 0;
  }

  /** Is the window from one planet to another open at this tick; if not, ticks until it opens. */
  windowAt(from: number, to: number, tick: number): { open: boolean; ticksUntil: number; flightTicks: number } {
    const sys = this.host.system;
    const w = launchWindow(sys.planets[from]!, sys.planets[to]!, this.systemDay(tick));
    const open = w.daysUntil <= WINDOW_DAYS || w.daysUntil >= w.synodic - WINDOW_DAYS;
    return { open, ticksUntil: open ? 0 : Math.ceil((w.daysUntil - WINDOW_DAYS) * this.sysDayTicks), flightTicks: Math.round(w.transferDays * this.sysDayTicks) };
  }

  /** The player's working launch rail on a planet, or null. */
  railOf(owner: number, planet: number): Building | null {
    const eco = this.host.economyAt(planet);
    if (!eco) return null;
    return eco.buildings.find((b) => b.alive && b.built && b.owner === owner && b.def.rail && b.stranded < 0) ?? null;
  }

  private notify(owner: number, text: string): void {
    this.notices.push({ owner, text });
  }

  private name(planet: number): string {
    return this.host.system.planets[planet]?.name ?? "?";
  }

  // ------------------------------------------------------------------ commands

  apply(cmd: VoyageCommand): CommandResult {
    const p = cmd.player ?? 0;
    if (p < 0 || p >= this.host.players) return { ok: false, reason: "Unknown player." };
    const planets = this.host.system.planets;
    switch (cmd.t) {
      case "probe":
      case "hearthship": {
        const to = planets[cmd.to];
        if (!to || !planets[cmd.from] || cmd.to === cmd.from) return { ok: false, reason: "Choose another planet to fly to." };
        const rail = this.railOf(p, cmd.from);
        if (!rail) return { ok: false, reason: `Build a launch rail on ${this.name(cmd.from)} first.` };
        if (cmd.t === "probe") {
          if (this.isSurveyed(p, cmd.to)) return { ok: false, reason: `${to.name} has already been surveyed.` };
          if (this.list.some((v) => v.owner === p && v.kind === "probe" && v.to === cmd.to && v.state !== "done")) return { ok: false, reason: `A probe is already bound for ${to.name}.` };
          this.add("probe", p, cmd.from, cmd.to, rail, goodsArray(PROBE_COST), goodsArray({}), 0, -1);
          return { ok: true };
        }
        if (!to.surface) return { ok: false, reason: `${to.name} has no ground to land on.` };
        if (!this.isSurveyed(p, cmd.to)) return { ok: false, reason: `Send a probe to ${to.name} first: nobody lands blind.` };
        const there = this.host.economyAt(cmd.to);
        if (there && there.keeps[p] !== undefined) return { ok: false, reason: `You already have a colony on ${to.name}. Send goods by skyship.` };
        if (this.list.some((v) => v.owner === p && v.kind === "hearthship" && v.to === cmd.to && v.state !== "done")) return { ok: false, reason: `A Hearthship is already bound for ${to.name}.` };
        const settlers = Math.floor(cmd.settlers);
        if (!(settlers >= MIN_FOUNDERS)) return { ok: false, reason: `A colony needs at least ${MIN_FOUNDERS} founders.` };
        const cargo = goodsArray(cmd.cargo);
        if (cargo.some((n) => !(n >= 0) || n !== Math.floor(n))) return { ok: false, reason: "Cargo must be whole goods." };
        const mass = settlers * SETTLER_MASS + cargo.reduce((s, n, g) => s + n * goodMass(g), 0);
        if (mass > HEARTHSHIP_MASS) return { ok: false, reason: `Too heavy: ${Math.ceil(mass)} of ${HEARTHSHIP_MASS}.` };
        const load = goodsArray(HEARTHSHIP_FRAME).map((n, g) => n + (cargo[g] as number));
        this.add("hearthship", p, cmd.from, cmd.to, rail, load, cargo, settlers, -1);
        return { ok: true };
      }
      case "land":
        return this.land(p, cmd.voyage, cmd.tile);
      case "route": {
        const from = planets[cmd.from];
        const to = planets[cmd.to];
        if (!from || !to || cmd.from === cmd.to) return { ok: false, reason: "Choose two different planets." };
        if (!this.railOf(p, cmd.from)) return { ok: false, reason: `Skyships leave from a launch rail: build one on ${from.name}.` };
        if (this.host.economyAt(cmd.to)?.keeps[p] === undefined) return { ok: false, reason: `You have no one on ${to.name} to unload.` };
        const good = GOODS.findIndex((g) => g.id === cmd.good);
        if (good < 0) return { ok: false, reason: "Unknown good." };
        const amount = Math.max(1, Math.min(SKYSHIP_CARGO, Math.floor(cmd.amount) || 0));
        this.routes.push({ id: this.routes.length, owner: p, from: cmd.from, to: cmd.to, good, amount, active: true, runs: 0 });
        return { ok: true };
      }
      case "unroute": {
        const r = this.routes[cmd.route];
        if (!r || r.owner !== p || !r.active) return { ok: false, reason: "No such route." };
        r.active = false;
        for (const v of this.list) if (v.route === r.id && (v.state === "loading" || v.state === "waiting")) this.cancel(v);
        return { ok: true };
      }
    }
  }

  private add(kind: VoyageKind, owner: number, from: number, to: number, rail: Building, load: number[], cargo: number[], settlers: number, route: number): Voyage {
    const v: Voyage = { id: this.list.length, kind, owner, from, to, state: "loading", rail: rail.id, load, cargo, settlers, founders: [], departs: -1, arrives: -1, route, warned: false };
    this.list.push(v);
    return v;
  }

  /** Stop a voyage that has not flown; what was loaded stays at the rail's stores. */
  private cancel(v: Voyage): void {
    if (v.state === "waiting") {
      const rail = this.host.economyAt(v.from)?.buildings[v.rail];
      if (rail?.alive) v.load.forEach((n, g) => (rail.stock[g] = (rail.stock[g] as number) + n));
    }
    v.state = "done";
  }

  private land(p: number, id: number, tile: number): CommandResult {
    const v = this.list[id];
    if (!v || v.owner !== p || v.kind !== "hearthship" || v.state !== "orbit") return { ok: false, reason: "No Hearthship of yours is waiting in orbit." };
    const eco = this.host.economyAt(v.to) ?? this.host.colonize(v.to);
    const why = eco.landingProblem(tile);
    if (why) return { ok: false, reason: why };
    const rng = new Rng(`${this.host.seed}:landing-${v.id}`);
    eco.settleAt(tile, rng, p, { people: v.founders, stock: v.cargo, radius: COLONY_RADIUS });
    eco.drift[p] = 0;
    for (const f of v.founders) {
      const person = eco.people.find((q) => q.alive && q.owner === p && q.first === f.first && q.family === f.family && q.born === f.born);
      if (person) note(person, `Came down with the Hearthship on ${this.name(v.to)}.`);
    }
    v.state = "done";
    this.notify(p, `The Hearthship has landed on ${this.name(v.to)} and unpacked into a keep. ${v.founders.length} founders begin a colony.`);
    return { ok: true };
  }

  // ------------------------------------------------------------------ step

  step(tick: number): void {
    if (tick % 25 !== 0) return;
    this.refreshWants();
    for (const v of this.list) {
      if (v.state === "loading") this.stepLoading(v);
      if (v.state === "waiting") this.stepWaiting(v, tick);
      if (v.state === "flying" && tick >= v.arrives) this.arrive(v);
    }
    // Trade routes: a skyship loading or waiting on every active route.
    for (const r of this.routes) {
      if (!r.active || this.list.some((v) => v.route === r.id && (v.state === "loading" || v.state === "waiting"))) continue;
      const rail = this.railOf(r.owner, r.from);
      if (!rail) continue;
      const cargo = goodsArray({});
      cargo[r.good] = r.amount;
      this.add("skyship", r.owner, r.from, r.to, rail, goodsArray(SKYSHIP_FRAME).map((n, g) => n + (cargo[g] as number)), cargo, 0, r.id);
    }
  }

  /** Each rail asks for what its loading voyages still lack. */
  private refreshWants(): void {
    const rails = new Map<Building, number[]>();
    for (const v of this.list) {
      if (v.state !== "loading") continue;
      const rail = this.host.economyAt(v.from)?.buildings[v.rail];
      if (!rail || !rail.alive) continue;
      const w = rails.get(rail) ?? new Array<number>(GOODS.length).fill(0);
      v.load.forEach((n, g) => (w[g] = (w[g] as number) + n));
      rails.set(rail, w);
    }
    for (const planet of this.host.system.planets) {
      const eco = this.host.economyAt(planet.index);
      if (!eco) continue;
      for (const b of eco.buildings) if (b.alive && b.def.rail) b.want = rails.get(b) ?? undefined;
    }
  }

  private stepLoading(v: Voyage): void {
    const eco = this.host.economyAt(v.from);
    let rail = eco?.buildings[v.rail];
    if (!rail || !rail.alive) {
      // The rail is gone: load at another, or give up.
      const other = this.railOf(v.owner, v.from);
      if (!other) {
        v.state = "done";
        this.notify(v.owner, `The ${v.kind} for ${this.name(v.to)} was lost with its launch rail.`);
        return;
      }
      v.rail = other.id;
      rail = other;
    }
    if (v.load.some((n, g) => (rail.stock[g] as number) < n)) return;
    v.load.forEach((n, g) => (rail.stock[g] = (rail.stock[g] as number) - n));
    v.state = "waiting";
  }

  private stepWaiting(v: Voyage, tick: number): void {
    const win = this.windowAt(v.from, v.to, tick);
    // Probes are light enough to fly any time, and quickly.
    if (v.kind !== "probe" && !win.open) return;
    if (v.kind === "hearthship" && !this.board(v)) return;
    v.state = "flying";
    v.departs = tick;
    v.arrives = tick + Math.max(this.sysDayTicks, Math.round(win.flightTicks * (v.kind === "probe" ? 0.35 : 1)));
    if (v.kind === "hearthship") this.notify(v.owner, `The Hearthship has launched for ${this.name(v.to)} with ${v.founders.length} founders aboard.`);
    else if (v.kind === "probe") this.notify(v.owner, `A probe is on its way to ${this.name(v.to)}.`);
  }

  /** Take the founders aboard: idle grown-ups, the most skilled first. */
  private board(v: Voyage): boolean {
    const eco = this.host.economyAt(v.from);
    if (!eco) return false;
    const idle = eco.people.filter((q) => q.alive && q.owner === v.owner && q.stage === "adult" && q.settler < 0 && q.woundedUntil <= eco.tick);
    if (idle.length < v.settlers) {
      if (!v.warned) this.notify(v.owner, `The Hearthship for ${this.name(v.to)} is waiting for ${v.settlers} idle settlers to board (${idle.length} free).`);
      v.warned = true;
      return false;
    }
    const skill = (q: (typeof idle)[number]) => Object.values(q.skills).reduce((s, x) => s + x, 0);
    idle.sort((a, b) => skill(b) - skill(a) || a.id - b.id);
    const sys = this.host.system;
    const from = sys.planets[v.from] as SystemPlanet;
    const to = sys.planets[v.to] as SystemPlanet;
    for (const q of idle.slice(0, v.settlers)) {
      // Raised on the world they leave (or carried there from further off).
      const origin = q.origin ?? v.from;
      const g = (sys.planets[origin] as SystemPlanet).gravity;
      note(q, `Left ${from.name} aboard the Hearthship for ${to.name}.`);
      v.founders.push({ first: q.first, family: q.family, born: q.born, skills: { ...q.skills }, journal: [...q.journal], origin, stride: strideFor(g, to.gravity) });
      q.alive = false;
      q.emigrated = true;
      if (q.house >= 0) q.house = -1;
    }
    return true;
  }

  private arrive(v: Voyage): void {
    const to = this.name(v.to);
    if (v.kind === "probe") {
      this.surveyed[v.owner] = (this.surveyed[v.owner] ?? 0) | (1 << v.to);
      v.state = "done";
      this.notify(v.owner, `The probe has reached ${to}: its ground, climate and hazards are charted. Open the star system (O) to look.`);
      return;
    }
    if (v.kind === "hearthship") {
      v.state = "orbit";
      this.notify(v.owner, `The Hearthship is in orbit over ${to}. Open the star system (O), survey ${to} and choose a landing site.`);
      return;
    }
    v.state = "done";
    const eco = this.host.economyAt(v.to);
    const keep = eco?.buildings[eco.keeps[v.owner] ?? -1];
    const route = this.routes[v.route];
    if (!eco || !keep || !keep.alive) {
      this.notify(v.owner, `A skyship reached ${to} and found no one of yours to unload for.`);
      return;
    }
    v.cargo.forEach((n, g) => (keep.stock[g] = (keep.stock[g] as number) + n));
    eco.skyshipCalled(v.owner);
    if (route) route.runs++;
    const what = v.cargo.map((n, g) => (n ? `${n} ${GOODS[g]!.name.toLowerCase()}` : "")).filter(Boolean).join(", ");
    eco.notices.push({ owner: v.owner, text: `A skyship from ${this.name(v.from)} has unloaded ${what}.` });
  }

  /** Where a flying craft is between its planets, 0..1, or -1. */
  progress(v: Voyage, tick: number): number {
    if (v.state !== "flying") return -1;
    return Math.max(0, Math.min(1, (tick - v.departs) / Math.max(1, v.arrives - v.departs)));
  }

  hash(h: StateHasher): void {
    h.int(this.list.length).int(this.routes.length);
    for (const v of this.list) h.int(v.state.length * 31 + v.kind.length).int(v.arrives).int(v.founders.length).int(v.rail);
    for (const r of this.routes) h.int(r.runs).int(r.active ? 1 : 0);
    for (const s of this.surveyed) h.int(s);
  }
}
