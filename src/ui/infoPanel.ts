import { GOODS, goodsFor } from "../sim/econ/defs";
import { DEPOSIT_IDS } from "../sim/econ/landuse";
import { EXPLORE_REACH, FLAG_CAPACITY, GOOD_AUTO, GOOD_COLLECT, GOOD_SEND, GOOD_STOP, STORE_IN, STORE_OUT, STORE_STOP, type Economy } from "../sim/econ/economy";
import { ARM_BLADE, ARM_BOW, ARM_MOUNT, fullName, title as skillTitle, tradeName, type Person } from "../sim/econ/people";
import { rankTitle } from "../sim/econ/combat";
import { COMBAT } from "../sim/econ/defs";
import { GOOD_COLORS } from "../render/econView";
import { h, Panel } from "./dom";

export type Selection = { kind: "building" | "flag" | "road" | "person"; id: number } | null;

function armsText(arms: number): string {
  const parts = [arms & ARM_BLADE ? "blade" : "", arms & ARM_BOW ? "bow" : "", arms & ARM_MOUNT ? "mount" : ""].filter(Boolean);
  return parts.length ? ` with ${parts.join(", ")}` : "";
}


const STATE_TEXT: Record<string, string> = {
  guard: "keeping watch",
  goto: "on the way",
  idle: "waiting for goods",
  center: "walking to the middle of the road",
  fetch: "fetching goods",
  carry: "carrying goods",
  enter: "delivering",
  leave: "back to the road",
  rest: "resting inside",
  out: "heading out to work",
  work: "working",
  back: "coming back",
  craft: "crafting",
  drop: "bringing goods to the flag",
  home: "going home",
};

function goodChip(type: number, count: number | string): HTMLElement {
  const g = GOODS[type];
  return h(
    "span",
    { class: "chip-good" },
    h("i", { style: `background:${GOOD_COLORS[g?.id ?? ""] ?? "#fff"}` }),
    `${g?.name ?? "?"} ${count}`,
  );
}

/** Details for the selected building, flag or road, refreshed while open. */
export class InfoPanel extends Panel {
  private sel: Selection = null;

  constructor(
    private readonly eco: () => Economy,
    private readonly actions: { demolishTile: (tile: number) => void; geologist: (flagTile: number) => void; follow: (person: number) => void; following: () => number; player: () => number; attack: (target: number, count: number, order: "strongest" | "weakest") => void; storeMode: (building: number, mode: number) => void; storeGood: (building: number, good: string, mode: number) => void; explore: (building: number, reach: number) => void },
  ) {
    super("info", "Details", { width: 300, className: "info" });
  }

  select(sel: Selection): void {
    this.sel = sel;
    if (sel) {
      this.show();
      this.refresh();
    } else this.hide();
  }

  private attackCount = 0;
  /** Which wardens go first: the strongest (the default) or the weakest. */
  private attackOrder: "strongest" | "weakest" = "strongest";
  private attackTarget = -1;

  private dayTicks(eco: Economy): number {
    return eco.dayLength;
  }

  /** Attack section for an enemy lantern: who can go, odds, and the order. */
  private attackUi(targetId: number): HTMLElement[] {
    const eco = this.eco();
    const me = this.actions.player();
    const target = eco.buildings[targetId];
    if (!target) return [];
    const blocked = eco.attackBlocked(me, target);
    if (blocked) return [h("p", { class: "hint" }, blocked)];
    const pool = eco.attackersFor(me, target, this.attackOrder).length;
    if (!pool) return [h("p", { class: "hint" }, "No wardens can be spared. Each lantern keeps one at home.")];
    if (this.attackTarget !== targetId) {
      this.attackTarget = targetId;
      this.attackCount = pool;
    }
    this.attackCount = Math.max(1, Math.min(pool, this.attackCount));
    const odds = eco.attackOdds(me, target, this.attackCount, this.attackOrder);
    const input = h("input", { type: "range", id: "atk-n", min: 1, max: pool, step: 1 }) as HTMLInputElement;
    input.value = String(this.attackCount);
    input.addEventListener("input", () => {
      this.attackCount = Number(input.value);
      this.refresh();
    });
    const pct = Math.round(odds * 100);
    return [
      h("h3", { class: "sub" }, "Attack"),
      h("div", { class: "row" }, h("label", { for: "atk-n" }, "Wardens"), input, h("output", {}, `${this.attackCount} of ${pool}`)),
      h(
        "div",
        { class: "row" },
        h("label", { for: "atk-order" }, "Send first"),
        h(
          "select",
          {
            id: "atk-order",
            onchange: (e: Event) => {
              this.attackOrder = (e.target as HTMLSelectElement).value === "weakest" ? "weakest" : "strongest";
              this.refresh();
            },
          },
          h("option", { value: "strongest", selected: this.attackOrder === "strongest" }, "The strongest"),
          h("option", { value: "weakest", selected: this.attackOrder === "weakest" }, "The weakest"),
        ),
        h("span"),
      ),
      h("p", { class: pct >= 60 ? "status" : "status warn" }, `About ${pct} % chance to take it.`),
      h("p", { class: "hint" }, "Rank, blades, the march, your settlement's resolve and the defenders' home ground all count. Bows loose a volley first."),
      h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.attack(targetId, this.attackCount, this.attackOrder) }, `Send ${this.attackCount}`)),
    ];
  }

  refresh(): void {
    if (!this.visible || !this.sel) return;
    if (document.activeElement?.id === "atk-n") return;
    const eco = this.eco();
    const body: HTMLElement[] = [];
    const title = this.root.querySelector(".panel-head h2") as HTMLElement;
    if (this.sel.kind === "person") {
      const p = eco.people[this.sel.id];
      if (!p || !p.alive) return this.select(null);
      title.textContent = fullName(p);
      const s = p.settler >= 0 ? eco.settlers[p.settler] : null;
      const work = s && s.building >= 0 ? eco.buildings[s.building] : null;
      const where = s
        ? s.role === "carrier"
          ? `Carrying on the roads, ${STATE_TEXT[s.state] ?? s.state}.`
          : s.role === "attacker"
            ? s.state === "march"
              ? "Marching to attack."
              : s.state === "duel"
                ? "Fighting a duel at the door!"
                : "Waiting at the door for the next duel."
            : s.role === "warden"
            ? `Warden at the ${work?.def.name.toLowerCase() ?? "lantern"}, ${STATE_TEXT[s.state] ?? s.state}.`
            : `${s.role === "builder" ? "Building" : s.role === "geologist" ? "Surveying" : `Working at the ${work?.def.name.toLowerCase() ?? "workshop"}`}, ${STATE_TEXT[s.state] ?? s.state}.`
        : p.stage === "child"
          ? "Playing near home."
          : p.house >= 0
            ? "At home."
            : "Resting in the Hearthship.";
      body.push(h("p", { class: "lede" }, `${eco.ageDays(p)} days old · ${p.stage}${p.house >= 0 ? " · has a home" : ""}`));
      if (p.rank > 0 || p.arms || (s && (s.role === "warden" || s.role === "attacker"))) body.push(h("p", { class: "hint" }, `${rankTitle(p.rank)}${armsText(p.arms)}`));
      if (p.woundedUntil > eco.tick) body.push(h("p", { class: "status warn" }, "Recovering from a wound."));
      body.push(h("p", { class: "status" }, where));
      const skills = Object.entries(p.skills)
        .filter(([, v]) => v > 0.02)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);
      if (skills.length) {
        body.push(h("h3", { class: "sub" }, "Skills"));
        for (const [trade, v] of skills) {
          body.push(h("div", { class: "skill" }, h("span", {}, `${skillTitle(v)} ${tradeName(trade)}`), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(v * 100)}%` }))));
        }
      }
      if (p.journal.length) {
        body.push(h("h3", { class: "sub" }, "Journal"));
        body.push(h("ul", { class: "journal" }, ...p.journal.slice().reverse().map((j) => h("li", {}, j))));
      }
      const on = this.actions.following() === p.id;
      body.push(h("div", { class: "btn-row" }, h("button", { class: on ? "btn small on" : "btn small", onclick: () => this.actions.follow(on ? -1 : p.id) }, on ? "Stop following" : "Follow")));
    } else if (this.sel.kind === "building") {
      const b = eco.buildings[this.sel.id];
      if (!b || !b.alive) return this.select(null);
      title.textContent = b.built ? b.def.name : `${b.def.name} (site)`;
      const theirs = b.owner !== this.actions.player();
      if (theirs) {
        body.push(h("p", { class: "status warn" }, `Belongs to ${eco.playerName(b.owner)}.`));
        if (b.stranded >= 0) body.push(h("p", { class: "hint" }, "Cut off and standing idle."));
        else if (b.def.light) {
          const isKeep = eco.keeps.includes(b.id);
          body.push(h("p", { class: "hint" }, isKeep ? "Their Hearthship. Take it and their settlement falls." : b.lit ? "Its lantern is lit." : "Its lantern is dark."));
          const defs = eco.defendersOf(b);
          if (defs.length) body.push(h("p", { class: "hint" }, `${defs.length} warden${defs.length === 1 ? "" : "s"} on watch inside.`));
          else if (isKeep) body.push(h("p", { class: "hint" }, "No wardens: its people will take up arms."));
          body.push(...this.attackUi(b.id));
        }
        this.body.replaceChildren(...body);
        return;
      }
      if (b.stranded >= 0) {
        const left = Math.max(0, COMBAT.strandedDays * this.dayTicks(eco) - (eco.tick - b.stranded));
        body.push(h("p", { class: "status warn" }, `Cut off. Win the land back within ${Math.ceil(left / (this.dayTicks(eco) / 24))} hours or it falls to ruin.`));
      }
      body.push(h("p", { class: "lede" }, b.def.description));
      if (b.def.slots) {
        const on = b.garrison.filter((id) => eco.settlers[id]?.state === "guard").length;
        const coming = b.garrison.length - on;
        if (!b.built) body.push(h("p", { class: "status" }, `Once built, a warden lights it and your border grows ${b.def.light} steps around it.`));
        else {
          body.push(h("p", { class: b.lit ? "status" : "status warn" }, b.lit ? `Lit. Light reaches ${b.def.light} steps.` : "Dark. Waiting for a warden to light it."));
          body.push(h("p", { class: "hint" }, `${on} of ${b.def.slots} wardens on watch${coming ? `, ${coming} on the way` : ""}. Wants ${eco.garrisonWant(b)} (${b.threat >= 2 ? "frontier" : b.threat === 1 ? "near" : "inland"} policy).`));
          const roster = eco.defendersOf(b).reverse();
          if (roster.length)
            body.push(
              h(
                "ul",
                { class: "journal roster" },
                ...roster.map((s) => {
                  const p = eco.people[s.person] as Person;
                  return h("li", {}, h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), this.select({ kind: "person", id: p.id })) }, fullName(p)), ` · ${rankTitle(p.rank)}${armsText(p.arms)}`);
                }),
              ),
            );
          if (b.siege.length) body.push(h("p", { class: "status warn" }, `Under attack: ${b.siege.length} at the door.`));
        }
      }
      if (b.def.storage) {
        body.push(h("h3", { class: "sub" }, "Stock"));
        body.push(h("div", { class: "chips" }, ...b.stock.map((n, i) => goodChip(i, n))));
        body.push(h("p", { class: "hint" }, `${b.residents} settlers resting inside.`));
        if (!eco.keeps.includes(b.id) && b.owner === this.actions.player()) {
          const modes = [
            [STORE_IN, "In", "Takes in goods from the roads."],
            [STORE_STOP, "Stop", "Keeps what it has but takes no more."],
            [STORE_OUT, "Out", "Carries its goods out to your other stores."],
          ] as const;
          body.push(h("h3", { class: "sub" }, "Goods"));
          body.push(h("div", { class: "btn-row" }, ...modes.map(([m, label, tip]) => h("button", { class: b.mode === m ? "btn small on" : "btn small", title: tip, onclick: () => this.actions.storeMode(b.id, m) }, label))));
        }
        if (b.owner === this.actions.player()) {
          // Settings by good (Settlers 2's Stop, Send and Collect), kept folded away until wanted.
          const keep = eco.keeps.includes(b.id);
          const options: [number, string][] = keep ? [[GOOD_AUTO, "Auto"], [GOOD_COLLECT, "Collect"]] : [[GOOD_AUTO, "Auto"], [GOOD_STOP, "Stop"], [GOOD_SEND, "Send"], [GOOD_COLLECT, "Collect"]];
          const set = b.goodMode.filter((m) => m !== GOOD_AUTO).length;
          body.push(
            h(
              "details",
              { class: "good-settings" },
              h("summary", {}, set ? `Settings by good (${set})` : "Settings by good"),
              h("p", { class: "hint" }, "Stop: takes no more of it. Send: carries it out to other stores. Collect: brings it in from the other stores, and new ones come here first."),
              ...GOODS.map((g, i) =>
                h(
                  "label",
                  { class: "good-setting" },
                  `${g.name} `,
                  h(
                    "select",
                    { onchange: (e: Event) => this.actions.storeGood(b.id, g.id, Number((e.target as HTMLSelectElement).value)) },
                    ...options.map(([m, label]) => h("option", { value: String(m), ...((b.goodMode[i] ?? GOOD_AUTO) === m ? { selected: "selected" } : {}) }, label)),
                  ),
                ),
              ),
            ),
          );
        }
      } else if (!b.built) {
        const connected = eco.route(eco.buildings[eco.keeps[b.owner] as number]!.flag, b.flag).dist !== Infinity;
        body.push(h("p", { class: connected ? "status" : "status warn" }, connected ? (b.dig > 0 ? (b.builder >= 0 ? `Builder levelling the ground (${b.dig} to dig).` : "Waiting for a builder to level the ground.") : b.builder >= 0 ? "Builder at work." : "Waiting for a builder.") : "Not connected. Build a road from this flag to your roads."));
        body.push(h("h3", { class: "sub" }, "Materials delivered"));
        body.push(h("div", { class: "chips" }, ...b.cost.map((n, i) => (n > 0 ? goodChip(i, `${b.delivered[i]}/${n}`) : null)).filter((x): x is HTMLElement => !!x)));
        body.push(h("div", { class: "bar" }, h("i", { style: `width:${Math.round((b.consumed / Math.max(1, b.costTotal)) * 100)}%` })));
      } else {
        const w = b.worker >= 0 ? eco.settlers[b.worker] : null;
        const waiting = eco.waitingFor(b);
        body.push(h("p", { class: waiting ? "status warn" : "status" }, waiting ?? (w ? `Worker ${STATE_TEXT[w.state] ?? w.state}.` : "Waiting for a worker. Is it connected to the Hearthship?")));
        if (b.def.job === "mine") {
          const land = eco.land;
          let left = 0;
          for (const t of [b.tile, ...land.ring(b.tile, b.def.radius ?? 2)]) if (land.deposit[t] && DEPOSIT_IDS[land.deposit[t] as number] === b.def.resource) left += land.depositAmount[t] as number;
          body.push(h("p", { class: "hint" }, `About ${left} loads left in reach. Food for ${b.food} more.`));
        }
        if (b.def.inputs) body.push(h("h3", { class: "sub" }, "Inputs"), h("div", { class: "chips" }, ...Object.keys(b.def.inputs).map((id) => goodChip(GOODS.findIndex((g) => g.id === id), b.stock[GOODS.findIndex((g) => g.id === id)] ?? 0))));
        if (b.def.job === "explore") {
          const names = ["Near", "Far", "Very far"];
          body.push(h("h3", { class: "sub" }, "Charting"));
          body.push(h("p", { class: "hint" }, `The crew sails out to the nearest unexplored sea within ${EXPLORE_REACH[b.reach] ?? 18} steps of the yard and comes back to rest. Choose how far it may go.`));
          body.push(h("div", { class: "btn-row" }, ...names.map((label, i) => h("button", { class: b.reach === i ? "btn small on" : "btn small", onclick: () => this.actions.explore(b.id, i) }, label))));
        }
        const work = eco.productivity(b);
        if (work !== null) body.push(h("p", { class: "hint", title: "The share of the day the worker spent at work, not waiting for goods or a free flag." }, `Productivity: ${work}%.`));
        if (b.output > 0) body.push(h("p", { class: "hint" }, `${b.output} finished, waiting to go out.`));
      }
      if (b.burn > 0) body.push(h("p", { class: "status warn" }, "On fire! A well within five steps would put it out."));
      if (b.built) {
        const mend = GOODS[eco.upkeepGood(b)]?.name.toLowerCase() ?? "plank";
        const cond =
          b.wear > 0.85 ? `Badly worn: works at two-thirds speed until a ${mend} arrives to mend it.` : b.wear >= 0.5 ? `Weathered: asking for a ${mend} to mend it.` : b.wear > 0.25 ? "Showing its age." : "In good repair.";
        body.push(h("p", { class: b.wear >= 0.5 ? "hint warn" : "hint" }, cond));
      }
      if (b.def.well) {
        const water = Math.round((eco.ecology.table[b.tile] ?? 0) * 100);
        body.push(h("p", { class: "hint" }, `Groundwater ${water} %. Bucket lines guard everything within five steps against fire.`));
      }
      if (b.def.job === "hunt") {
        const land = eco.land;
        const reach = land.ring(b.tile, b.def.radius ?? 7).filter((t) => land.isLand(t));
        const mean = reach.reduce((sum, t) => sum + (eco.ecology.game[t] as number), 0) / Math.max(1, reach.length);
        body.push(h("p", { class: "hint" }, mean > 60 ? "Deer are plentiful in reach." : mean > 30 ? "The herds nearby are thinning." : "Game is scarce here. Let the herds recover, or hunt elsewhere."));
      }
      if (!eco.keeps.includes(b.id)) body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(b.tile) }, "Demolish")));
    } else if (this.sel.kind === "flag") {
      const f = eco.flags[this.sel.id];
      if (!f || !f.alive) return this.select(null);
      title.textContent = "Flag";
      body.push(h("p", { class: "status" }, `${f.goods.length} of ${FLAG_CAPACITY} places taken · ${f.roads.length} road${f.roads.length === 1 ? "" : "s"}`));
      const counts = new Map<number, number>();
      for (const g of f.goods) {
        const t = eco.goods[g]?.type ?? 0;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      if (counts.size) body.push(h("div", { class: "chips" }, ...[...counts].map(([t, n]) => goodChip(t, n))));
      if (f.goods.length >= 6) body.push(h("p", { class: "hint warn" }, "This flag is crowded. Add a parallel road or split long roads with flags."));
      body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small", onclick: () => this.actions.geologist(f.tile) }, "Send geologist")));
      if (!eco.keeps.includes(f.building)) body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(f.tile) }, "Remove flag")));
    } else {
      const r = eco.roads[this.sel.id];
      if (!r || !r.alive) return this.select(null);
      title.textContent = "Road";
      const c = r.carrier >= 0 ? eco.settlers[r.carrier] : null;
      body.push(h("p", { class: "status" }, `${r.tiles.length - 1} steps long · carrier ${c ? STATE_TEXT[c.state] ?? c.state : "not assigned yet"}`));
      const busy = eco.roadProductivity(r);
      if (busy !== null) body.push(h("p", { class: busy >= 80 ? "status warn" : "hint", title: "The share of the day the carrier was busy. A road that stays above 80% calls extra carriers." }, `Busy ${busy}% of the day${busy >= 80 ? " (a busy road)" : ""}.`));
      body.push(h("div", { class: "btn-row" }, h("button", { class: "btn small danger", onclick: () => this.actions.demolishTile(r.tiles[1] as number) }, "Remove road")));
    }
    this.body.replaceChildren(...body);
  }
}

/** Top-left summary of stock and settlers. */
export class StockBar {
  readonly root = h("div", { class: "stockbar", "aria-label": "Stock" });

  update(eco: Economy, player = 0, weather?: { text: string; title: string }): void {
    const totals = eco.storageTotals(player);
    const pop = eco.population(player);
    const glow = eco.glow[player] ?? 0;
    const idx = (id: string) => GOODS.findIndex((g) => g.id === id);
    const food = goodsFor("food").reduce((s, g) => s + (totals[g] ?? 0), 0);
    this.root.replaceChildren(
      ...["log", "stone", "plank"].map((id) => goodChip(idx(id), totals[idx(id)] ?? 0)),
      h("span", { class: "chip-good" }, h("i", { style: "background:#d98f4e" }), `Food ${food}`),
      ...["coal", "iron", "gold"].map((id) => goodChip(idx(id), totals[idx(id)] ?? 0)),
      h("span", { class: "chip-good pop", title: "Settlers resting / at work" }, `Settlers ${pop.idle} / ${pop.working}`),
      ...(weather ? [h("span", { class: "chip-good weather", title: weather.title }, weather.text)] : []),
      h("span", { class: `chip-good glow${glow < 40 ? " low" : ""}`, title: "Glow: how content your people are. Content towns work faster and grow." }, h("i", { style: `background:hsl(${30 + glow * 0.2},90%,${45 + glow * 0.2}%)` }), `Glow ${glow}`),
    );
  }
}
