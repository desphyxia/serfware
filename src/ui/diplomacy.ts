import { PERSONALITIES, type Personality } from "../sim/ai/personality";
import { TREATIES, type TreatyKind } from "../sim/econ/diplomacy";
import type { Economy, Command } from "../sim/econ/economy";
import { h, Panel } from "./dom";

const KINDS: TreatyKind[] = ["truce", "trade", "roads", "prisoners"];

/**
 * Diplomacy (J): every other settlement, its temperament and name among its neighbours, the
 * treaties in force and how long they have left, offers waiting for an answer, prisoners held
 * either way, and buttons to offer a treaty or break your word.
 */
export class DiplomacyPanel extends Panel {
  private key = "";

  constructor(
    private readonly economy: () => Economy,
    private readonly player: () => number,
    private readonly personality: (p: number) => Personality | null,
    private readonly command: (cmd: Command) => void,
  ) {
    super("diplomacy", "Diplomacy", { width: 520, className: "diplomacy" });
  }

  protected override onShow(): void {
    this.key = "";
    this.refresh();
  }

  refresh(): void {
    if (!this.visible) return;
    const eco = this.economy();
    const me = this.player();
    const dip = eco.diplomacy;
    const day = eco.dayTicks;
    const live = dip.treaties.filter((t) => !t.broken && t.until > eco.tick && (t.a === me || t.b === me));
    const offers = dip.proposals.filter((x) => x.open && x.to === me);
    const held = eco.people.filter((p) => p.alive && p.captive !== undefined && (p.owner === me || p.captive === me));
    const key = `${live.map((t) => `${t.id}:${Math.ceil((t.until - eco.tick) / day)}`).join()}|${offers.map((o) => o.id).join()}|${held.length}|${dip.rep(me)}|${dip.shamed(me)}|${dip.proposals.length}`;
    if (key === this.key) return;
    this.key = key;
    const rows: HTMLElement[] = [h("p", { class: "dip-rep" }, `Your name among the settlements: ${repWord(dip.rep(me))} (${dip.rep(me)}).${dip.shamed(me) ? " Your people are ashamed of a broken treaty." : ""}`)];
    for (const o of offers)
      rows.push(
        h(
          "div",
          { class: "dip-offer" },
          h("span", {}, `${eco.playerName(o.from)} offers a ${TREATIES[o.kind].name.toLowerCase()}: ${TREATIES[o.kind].note}`),
          h("button", { class: "btn primary", onclick: () => this.command({ t: "answer", proposal: o.id, accept: true, player: me }) }, "Accept"),
          h("button", { class: "btn", onclick: () => this.command({ t: "answer", proposal: o.id, accept: false, player: me }) }, "Decline"),
        ),
      );
    let others = 0;
    for (let q = 0; q < eco.keeps.length; q++) {
      if (q === me || eco.keeps[q] === undefined) continue;
      others++;
      const temper = this.personality(q);
      const mine = live.filter((t) => t.a === q || t.b === q);
      const ours = held.filter((p) => p.owner === me && p.captive === q).length;
      const theirs = held.filter((p) => p.owner === q && p.captive === me).length;
      const pending = (k: TreatyKind) => dip.proposals.some((x) => x.open && x.from === me && x.to === q && x.kind === k);
      rows.push(
        h(
          "section",
          { class: `dip-card${eco.defeated[q] ? " fallen" : ""}` },
          h("h3", {}, eco.playerName(q), temper ? h("span", { class: `dip-temper ${temper}`, title: PERSONALITIES[temper].note }, PERSONALITIES[temper].name) : h("span", { class: "dip-temper" }, "Player")),
          h("p", { class: "dip-line" }, `Reputation ${repWord(dip.rep(q))} (${dip.rep(q)})${eco.defeated[q] ? " · fallen" : ""}`),
          h(
            "p",
            { class: "dip-line" },
            mine.length ? mine.map((t) => `${TREATIES[t.kind].name}: ${Math.ceil((t.until - eco.tick) / day)} days left`).join(" · ") : "No treaties.",
          ),
          ours || theirs ? h("p", { class: "dip-line" }, `Prisoners: they hold ${ours} of yours, you hold ${theirs} of theirs.`) : "",
          eco.defeated[q]
            ? ""
            : h(
                "div",
                { class: "dip-actions" },
                ...KINDS.map((k) =>
                  h(
                    "button",
                    {
                      class: "btn",
                      title: TREATIES[k].note,
                      disabled: pending(k) || (k !== "prisoners" && mine.some((t) => t.kind === k)) || (k === "prisoners" && !ours && !theirs),
                      onclick: () => this.command({ t: "propose", to: q, kind: k, player: me }),
                    },
                    pending(k) ? `${TREATIES[k].name}: offered` : `Offer ${TREATIES[k].name.toLowerCase()}`,
                  ),
                ),
                mine.length ? h("button", { class: "btn danger", title: "Break every treaty with them. Your people will be ashamed, and others will remember.", onclick: () => this.command({ t: "break", with: q, player: me }) }, "Break treaties") : "",
              ),
        ),
      );
    }
    if (!others) rows.push(h("p", { class: "dip-line" }, "No other settlement shares this world. Start a world with AI rivals (Settings, World) or play neighbours with friends."));
    this.body.replaceChildren(...rows);
  }
}

function repWord(r: number): string {
  return r >= 75 ? "trusted" : r >= 50 ? "respected" : r >= 30 ? "doubted" : "oath-breaker";
}
