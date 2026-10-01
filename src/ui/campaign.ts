import { SCENARIOS, TUTORIAL, VOYAGE } from "../sim/scenario/campaign";
import type { ScenarioDef, ScenarioRun } from "../sim/scenario/scenario";
import { h, Panel } from "./dom";

const KEY = "seedfall.campaign";

/** Which scenarios this browser has completed (chapters unlock in order). */
export const progress = {
  done(): Set<string> {
    try {
      return new Set((JSON.parse(localStorage.getItem(KEY) ?? "{}") as { done?: string[] }).done ?? []);
    } catch {
      return new Set();
    }
  },
  complete(id: string): void {
    try {
      const done = progress.done();
      done.add(id);
      localStorage.setItem(KEY, JSON.stringify({ done: [...done] }));
    } catch {
      // Private mode: progress just isn't kept.
    }
  },
};

/** The next scenario after `id` in the campaign (the next chapter, or the first after the tutorial). */
export function nextAfter(id: string): ScenarioDef | undefined {
  if (id === TUTORIAL.id) return VOYAGE[0];
  const i = VOYAGE.findIndex((c) => c.id === id);
  return i >= 0 ? VOYAGE[i + 1] : undefined;
}

/** The Campaign tab of the game menu: the tutorial, The Long Voyage's chapters and the scenarios. */
export function campaignPage(play: (id: string) => void): HTMLElement {
  const root = h("div", { class: "campaign" });
  const render = () => {
    const done = progress.done();
    const row = (s: ScenarioDef, locked = false) =>
      h(
        "li",
        { class: `camp-row${done.has(s.id) ? " done" : ""}${locked ? " locked" : ""}` },
        h("div", { class: "camp-text" }, h("b", {}, `${s.chapter ? `${s.chapter}. ` : ""}${s.title}`), h("span", {}, locked ? "Finish the chapter before to open this one." : s.blurb)),
        done.has(s.id) ? h("span", { class: "camp-done", "aria-label": "Completed" }, "✓") : "",
        h("button", { class: `btn${locked ? "" : " primary"}`, disabled: locked, onclick: () => play(s.id) }, done.has(s.id) ? "Play again" : "Play"),
      );
    root.replaceChildren(
      h("h3", { class: "sub" }, "Tutorial"),
      h("ul", { class: "camp-list" }, row(TUTORIAL)),
      h("h3", { class: "sub" }, "The Long Voyage"),
      h("p", { class: "hint" }, "Twelve chapters on Lanterne, from landfall to a second world in bloom. Play alone, or in co-op from the Multiplayer tab."),
      h("ul", { class: "camp-list" }, ...VOYAGE.map((c, i) => row(c, i > 0 && !done.has(VOYAGE[i - 1]!.id)))),
      h("h3", { class: "sub" }, "Scenarios"),
      h("ul", { class: "camp-list" }, ...SCENARIOS.map((s) => row(s))),
    );
  };
  render();
  (root as HTMLElement & { refresh?: () => void }).refresh = render;
  return root;
}

/** The goals of the scenario in play, at the side of the screen. */
export class ObjectivesPanel {
  readonly root = h("aside", { class: "objectives", hidden: true, "aria-label": "Goals" });
  private key = "";

  update(run: ScenarioRun | null): void {
    if (!run) {
      this.root.hidden = true;
      this.key = "";
      return;
    }
    const key = `${run.def.id}:${run.version}`;
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = false;
    const cur = run.current;
    const goals = run.def.goals.map((g, i) => ({ g, i })).filter(({ i }) => !run.def.sequential || i <= cur || cur < 0);
    this.root.replaceChildren(
      h("h3", {}, run.def.chapter ? `Chapter ${run.def.chapter}: ${run.def.title}` : run.def.title),
      h(
        "ul",
        {},
        ...goals.map(({ g, i }) => h("li", { class: run.reached[i]! >= 0 ? "met" : i === cur ? "now" : "" }, h("span", { class: "tick" }, run.reached[i]! >= 0 ? "✓" : "○"), g.text)),
      ),
      run.def.sequential && cur >= 0 && run.def.goals[cur]?.hint ? h("p", { class: "obj-hint" }, run.def.goals[cur]!.hint!) : "",
      run.done ? h("p", { class: "obj-done" }, "Complete") : run.failed ? h("p", { class: "obj-failed" }, "Failed") : "",
    );
  }
}

/** The story at the start and end of a scenario. */
export class StoryPanel extends Panel {
  constructor() {
    super("story", "Story", { width: 460, className: "story" });
  }

  tell(title: string, text: string, buttons: { label: string; primary?: boolean; act: () => void }[]): void {
    (this.root.querySelector(".panel-head h2") as HTMLElement).textContent = title;
    this.body.replaceChildren(
      ...text.split("\n\n").map((p) => h("p", { class: "story-text" }, p)),
      h("div", { class: "btn-row" }, ...buttons.map((b) => h("button", { class: `btn${b.primary ? " primary" : ""}`, onclick: () => (this.hide(), b.act()) }, b.label))),
    );
    this.show();
  }
}
