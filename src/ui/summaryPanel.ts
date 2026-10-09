import { summarize, type Summary, type WinReason } from "../sim/econ/victory";
import type { Economy } from "../sim/econ/economy";
import { h, Panel } from "./dom";

const HEADLINE: Record<WinReason, string> = {
  conquest: "The last rival Hearthship has fallen.",
  wells: "The Star Wells sing for the victor.",
  bloom: "The first colony has bloomed.",
  prosperity: "A settlement prospered beyond all others.",
  influence: "The hamlets chose one light over the rest.",
};

/** The end-of-game screen: who won and how, and how every settlement fared. */
export class SummaryPanel extends Panel {
  private readonly head: HTMLElement;
  private readonly table: HTMLElement;
  private shown = false;

  constructor(
    private readonly eco: () => Economy,
    private readonly me: () => number,
    private readonly onLeave: () => void,
  ) {
    super("summary", "World summary", { width: 520, className: "summary" });
    this.head = h("p", { class: "lede" });
    this.table = h("div", { class: "summary-table" });
    this.body.append(
      this.head,
      this.table,
      h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => this.hide() }, "Keep looking around"), h("button", { class: "btn", onclick: () => this.onLeave() }, "Back to the menu")),
    );
  }

  /** Called every frame: opens once, the moment the game is won or the player's Hearthship falls. */
  update(): void {
    const eco = this.eco();
    const lost = !!eco.defeated[this.me()];
    if (!this.shown && (eco.winner >= 0 || lost)) {
      this.shown = true;
      this.show();
    }
  }

  override show(): void {
    this.render(summarize(this.eco()));
    super.show();
  }

  private render(s: Summary): void {
    const me = this.me();
    const mine = s.rows.find((r) => r.player === me);
    const title = !s.over
      ? mine?.outcome === "fallen"
        ? "Your Hearthship has fallen."
        : "The world goes on."
      : mine?.outcome === "won"
        ? "Victory!"
        : mine?.outcome === "ally"
          ? "Your team has won."
          : mine?.outcome === "fallen"
            ? "Your Hearthship fell, and another settlement won."
            : "Another settlement has won this world.";
    const why = s.over && s.reason ? ` ${HEADLINE[s.reason]}` : "";
    this.head.textContent = `${title}${why} After ${s.days} day${s.days === 1 ? "" : "s"}.`;
    const cols = ["Settlement", "", `Goods (of ${s.goods})`, `Hamlets (of ${s.hamletsTotal})`, `Wells (of ${s.wellsTotal})`, "Taken", "Buildings", "People"];
    const cell = (text: string, cls = "") => h("span", { class: cls }, text);
    const rows = s.rows.flatMap((r) => {
      const tag = r.outcome === "won" ? "Winner" : r.outcome === "ally" ? "Winning team" : r.outcome === "fallen" ? "Fallen" : "";
      const cls = r.player === me ? "me" : "";
      return [cell(r.name + (r.player === me ? " (you)" : ""), cls), cell(tag, `tag ${r.outcome}`), cell(String(r.made), "num"), cell(String(r.hamlets), "num"), cell(String(r.wells), "num"), cell(String(r.captured), "num"), cell(String(r.buildings), "num"), cell(String(r.people), "num")];
    });
    this.table.replaceChildren(...cols.map((c) => cell(c, "th")), ...rows);
  }
}
