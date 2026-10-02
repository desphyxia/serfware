import { BUILDINGS, GOODS } from "../sim/econ/defs";
import { Deposit } from "../sim/econ/landuse";
import { EXAMPLE_MOD, validateMod, type ModPack } from "../sim/mods";
import { PAINT_REGIONS, type PaintKind, type WorldPaint } from "../sim/planet/paint";
import type { GridSize } from "../sim/planet/grid";
import { registerScenario } from "../sim/scenario/campaign";
import type { Action, Condition, ScenarioDef } from "../sim/scenario/scenario";
import { desktop } from "../platform/bridge";
import { h, Panel } from "./dom";

/**
 * Creative tools: the player's library of painted worlds, scenarios and mods (kept in this
 * browser, exported as files, shared on the Steam Workshop in the desktop build), the Create tab
 * of the game menu, the scenario editor and the world painter's toolbox.
 */

export interface SavedWorld {
  id: string;
  name: string;
  seed: string;
  size?: GridSize;
  paint: WorldPaint;
}

interface Stored {
  scenarios: ScenarioDef[];
  worlds: SavedWorld[];
  mods: { mod: ModPack; on: boolean }[];
}

const KEY = "seedfall.creations";

function read(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
    return { scenarios: s.scenarios ?? [], worlds: s.worlds ?? [], mods: s.mods ?? [] };
  } catch {
    return { scenarios: [], worlds: [], mods: [] };
  }
}

function write(s: Stored): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The player's creations. Every saved scenario is registered so it can be played by id. */
export const library = {
  scenarios: (): ScenarioDef[] => read().scenarios,
  worlds: (): SavedWorld[] => read().worlds,
  mods: () => read().mods,
  enabledMods: (): ModPack[] => read().mods.filter((m) => m.on).map((m) => m.mod),
  saveScenario(def: ScenarioDef): boolean {
    const s = read();
    s.scenarios = [...s.scenarios.filter((x) => x.id !== def.id), def];
    registerScenario(def);
    return write(s);
  },
  removeScenario(id: string): void {
    const s = read();
    s.scenarios = s.scenarios.filter((x) => x.id !== id);
    write(s);
  },
  saveWorld(w: SavedWorld): boolean {
    const s = read();
    s.worlds = [...s.worlds.filter((x) => x.id !== w.id), w];
    return write(s);
  },
  removeWorld(id: string): void {
    const s = read();
    s.worlds = s.worlds.filter((x) => x.id !== id);
    write(s);
  },
  saveMod(mod: ModPack, on = true): boolean {
    const s = read();
    s.mods = [...s.mods.filter((x) => x.mod.id !== mod.id), { mod, on }];
    return write(s);
  },
  setModOn(id: string, on: boolean): void {
    const s = read();
    for (const m of s.mods) if (m.mod.id === id) m.on = on;
    write(s);
  },
  removeMod(id: string): void {
    const s = read();
    s.mods = s.mods.filter((x) => x.mod.id !== id);
    write(s);
  },
  /** Register every saved scenario (at startup). */
  register(): void {
    for (const d of read().scenarios) registerScenario(d);
  },
};

/** A creation as a file: what it is, and its data. */
export type Creation = { kind: "scenario"; data: ScenarioDef } | { kind: "world"; data: SavedWorld } | { kind: "mod"; data: ModPack };

export function creationText(c: Creation): string {
  return JSON.stringify({ format: "seedfall-creation", version: 1, ...c }, null, 1);
}

/** Read a creation file (or a bare mod pack). Throws with a reason if it isn't one. */
export function readCreation(text: string): Creation {
  const o = JSON.parse(text) as { format?: string; kind?: string; data?: unknown };
  if (o.format !== "seedfall-creation") {
    // A bare mod pack, as a modder would write it by hand.
    const errors = validateMod(o);
    if (errors.length) throw new Error(`Not a Seedfall creation or mod: ${errors[0]}`);
    return { kind: "mod", data: o as unknown as ModPack };
  }
  if (o.kind === "mod") {
    const errors = validateMod(o.data);
    if (errors.length) throw new Error(`This mod has problems: ${errors.slice(0, 3).join(" ")}`);
    return { kind: "mod", data: o.data as ModPack };
  }
  if (o.kind === "scenario") {
    const d = o.data as ScenarioDef;
    if (!d || typeof d.id !== "string" || !Array.isArray(d.goals) || typeof d.seed !== "string") throw new Error("This scenario file is incomplete.");
    for (const m of d.opts?.mods ?? []) if (validateMod(m).length) throw new Error(`Its mod ${m.id} has problems.`);
    return { kind: "scenario", data: { ...d, kind: "custom" } };
  }
  if (o.kind === "world") {
    const d = o.data as SavedWorld;
    if (!d || typeof d.seed !== "string" || !Array.isArray(d.paint?.strokes)) throw new Error("This world file is incomplete.");
    return { kind: "world", data: d };
  }
  throw new Error("Unknown kind of creation.");
}

/** Keep a creation from a file or the Workshop in the library. */
export function keepCreation(c: Creation): string {
  if (c.kind === "scenario") library.saveScenario(c.data);
  else if (c.kind === "world") library.saveWorld(c.data);
  else library.saveMod(c.data, false);
  return c.kind === "mod" ? `Mod "${c.data.name}" added (switched off until you turn it on).` : `${c.kind === "scenario" ? "Scenario" : "World"} "${c.kind === "scenario" ? c.data.title : c.data.name}" added.`;
}

export function download(name: string, text: string): void {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** Ask for a file and read it as text (null if cancelled). */
export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ".json,application/json" }) as HTMLInputElement;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "creation";

/** Share on the Steam Workshop (desktop build). */
export async function shareToWorkshop(c: Creation): Promise<string> {
  const bridge = desktop();
  if (!bridge?.workshopUpload) return "The Steam Workshop needs the desktop build. Export the file and share it instead.";
  const title = c.kind === "scenario" ? c.data.title : c.data.name;
  const description = c.kind === "scenario" ? c.data.blurb : c.kind === "mod" ? (c.data.description ?? "") : `A painted world on seed ${c.data.seed}.`;
  try {
    const r = await bridge.workshopUpload({ title, description, tags: [c.kind], json: creationText(c) });
    if (!r.itemId) return "Steam did not take the upload. Is Steam running?";
    return r.needsAgreement ? "Uploaded. Accept the Workshop agreement on Steam to make it public." : "Shared on the Steam Workshop.";
  } catch (e) {
    return `The upload failed: ${(e as Error).message}`;
  }
}

/** Creations the player subscribed to on the Workshop, added to the library. */
export async function syncWorkshop(): Promise<string> {
  const bridge = desktop();
  if (!bridge?.workshopItems) return "The Steam Workshop needs the desktop build.";
  let n = 0;
  for (const item of await bridge.workshopItems()) {
    try {
      keepCreation(readCreation(item.json));
      n++;
    } catch {
      // Not a creation this version understands.
    }
  }
  return n ? `${n} creation${n === 1 ? "" : "s"} from the Workshop.` : "Nothing from the Workshop yet: subscribe to creations on Steam.";
}

export interface CreateHost {
  /** Open the world painter (on a saved world, or on the current seed). */
  paint(world?: SavedWorld): void;
  /** Play a painted world as an ordinary game. */
  playWorld(world: SavedWorld): void;
  editScenario(def?: ScenarioDef): void;
  playScenario(id: string): void;
  notify(text: string, kind?: "info" | "warn" | "good"): void;
}

/** The Create tab: the world painter, my scenarios and worlds, mods, and the Workshop. */
export function createPage(host: CreateHost): HTMLElement & { refresh: () => void } {
  const root = h("div", { class: "campaign create" }) as unknown as HTMLElement & { refresh: () => void };
  const steam = !!desktop()?.workshopUpload;
  const importFile = async () => {
    const text = await pickFile();
    if (!text) return;
    try {
      host.notify(keepCreation(readCreation(text)), "good");
    } catch (e) {
      host.notify((e as Error).message, "warn");
    }
    render();
  };
  const share = (c: Creation) => void shareToWorkshop(c).then((m) => host.notify(m, "info"));
  const row = (title: string, sub: string, ...buttons: HTMLElement[]) => h("li", { class: "camp-row" }, h("div", { class: "camp-text" }, h("b", {}, title), h("span", {}, sub)), ...buttons);
  const btn = (label: string, act: () => void, primary = false, title?: string) => h("button", { class: `btn${primary ? " primary" : ""}`, title, onclick: act }, label);
  const render = () => {
    const scenarios = library.scenarios();
    const worlds = library.worlds();
    const mods = library.mods();
    root.replaceChildren(
      h("h3", { class: "sub" }, "World painter"),
      h("p", { class: "hint" }, "Sculpt the ground, lay down regions, plant woods, place ore and move the Star Wells, on this world's seed."),
      h("div", { class: "btn-row" }, btn("Paint this world", () => host.paint(), true)),
      worlds.length
        ? h(
            "ul",
            { class: "camp-list" },
            ...worlds.map((w) =>
              row(
                w.name,
                `Seed ${w.seed} · ${w.paint.strokes.length} strokes${w.paint.wells ? " · wells placed" : ""}`,
                btn("Play", () => host.playWorld(w), true),
                btn("Paint", () => host.paint(w)),
                btn("Export", () => download(`${slug(w.name)}.seedfall-world.json`, creationText({ kind: "world", data: w }))),
                ...(steam ? [btn("Share", () => share({ kind: "world", data: w }))] : []),
                btn("✕", () => (library.removeWorld(w.id), render()), false, "Delete"),
              ),
            ),
          )
        : "",
      h("h3", { class: "sub" }, "My scenarios"),
      h("div", { class: "btn-row" }, btn("New scenario", () => host.editScenario(), true), btn("Import a file…", () => void importFile())),
      scenarios.length
        ? h(
            "ul",
            { class: "camp-list" },
            ...scenarios.map((s) =>
              row(
                s.title,
                `${s.goals.length} goal${s.goals.length === 1 ? "" : "s"}${s.author ? ` · by ${s.author}` : ""}${s.opts?.paint ? " · painted world" : ""}${s.opts?.mods?.length ? " · mods" : ""}`,
                btn("Play", () => host.playScenario(s.id), true),
                btn("Edit", () => host.editScenario(s)),
                btn("Export", () => download(`${slug(s.title)}.seedfall-scenario.json`, creationText({ kind: "scenario", data: s }))),
                ...(steam ? [btn("Share", () => share({ kind: "scenario", data: s }))] : []),
                btn("✕", () => (library.removeScenario(s.id), render()), false, "Delete"),
              ),
            ),
          )
        : h("p", { class: "hint" }, "No scenarios yet. Make one, or import a .json file someone shared."),
      h("h3", { class: "sub" }, "Mods"),
      h("p", { class: "hint" }, "Mods add goods and buildings, change costs and work times, rename and retune the warden ranks, or change the start. Turned-on mods apply to new games (and travel with saves and multiplayer starts)."),
      h(
        "div",
        { class: "btn-row" },
        btn("Import a mod…", () => void importFile()),
        mods.some((m) => m.mod.id === EXAMPLE_MOD.id) ? "" : btn("Add the example mod", () => (library.saveMod(EXAMPLE_MOD, false), render())),
        btn("Mod template", () => download("my-mod.json", JSON.stringify(EXAMPLE_MOD, null, 2)), false, "A worked example to start a mod from"),
      ),
      mods.length
        ? h(
            "ul",
            { class: "camp-list" },
            ...mods.map(({ mod, on }) => {
              const box = h("input", { type: "checkbox", "aria-label": `Use ${mod.name}`, checked: on, onchange: () => (library.setModOn(mod.id, box.checked), host.notify(box.checked ? `${mod.name} is on for new games.` : `${mod.name} is off.`, "info")) }) as HTMLInputElement;
              return row(
                mod.name,
                `${mod.version}${mod.author ? ` · ${mod.author}` : ""} · ${mod.goods?.length ?? 0} goods, ${mod.buildings?.length ?? 0} buildings${mod.description ? ` · ${mod.description}` : ""}`,
                h("label", { class: "mod-on" }, box, "On"),
                btn("Export", () => download(`${mod.id}.json`, JSON.stringify(mod, null, 2))),
                ...(steam ? [btn("Share", () => share({ kind: "mod", data: mod }))] : []),
                btn("✕", () => (library.removeMod(mod.id), render()), false, "Remove"),
              );
            }),
          )
        : "",
      h("h3", { class: "sub" }, "Steam Workshop"),
      steam
        ? h(
            "div",
            { class: "btn-row" },
            btn("Get my subscriptions", () => void syncWorkshop().then((m) => (host.notify(m, "info"), render())), true),
            btn("Browse the Workshop", () => desktop()?.openWorkshop?.()),
          )
        : h("p", { class: "hint" }, "In the Steam version, share creations on the Workshop and play what others made. Here, export them as files instead."),
    );
  };
  render();
  root.refresh = render;
  return root;
}

// ---------------------------------------------------------------------------------------------
// The scenario editor

type CondKind = Condition["k"];
const COND_KINDS: { k: CondKind; label: string; n?: string; type?: "building" | "good" | "treaty" | "rank" }[] = [
  { k: "build", label: "Buildings of a type", n: "how many", type: "building" },
  { k: "buildings", label: "Buildings in all", n: "how many" },
  { k: "roads", label: "Roads", n: "how many" },
  { k: "flags", label: "Flags", n: "how many" },
  { k: "people", label: "People", n: "how many" },
  { k: "glow", label: "Glow", n: "at least" },
  { k: "stock", label: "Goods in store", n: "how many", type: "good" },
  { k: "land", label: "Land (tiles)", n: "how many" },
  { k: "lit", label: "Lantern buildings lit", n: "how many" },
  { k: "pages", label: "Almanac pages", n: "how many" },
  { k: "day", label: "Days have passed", n: "days" },
  { k: "wardens", label: "Wardens of a rank", n: "how many", type: "rank" },
  { k: "wells", label: "Star Wells held", n: "how many" },
  { k: "probe", label: "A probe has surveyed another planet" },
  { k: "colony", label: "A colony is founded" },
  { k: "bloom", label: "A colony has bloomed" },
  { k: "hamlet", label: "A hamlet has joined" },
  { k: "treaty", label: "A treaty is signed", type: "treaty" },
  { k: "defeated", label: "A settlement has fallen", n: "player (0 is you)" },
];

function condRow(c: Condition | undefined, onChange: () => void): { el: HTMLElement; get: () => Condition } {
  const kind = h("select", { "aria-label": "Condition", onchange: () => (sync(), onChange()) }, ...COND_KINDS.map((x) => h("option", { value: x.k }, x.label))) as HTMLSelectElement;
  const n = h("input", { type: "number", min: 0, value: 1, class: "num", "aria-label": "Number" }) as HTMLInputElement;
  const building = h("select", { "aria-label": "Building" }, ...BUILDINGS.filter((b) => b.buildable !== false).map((b) => h("option", { value: b.id }, b.name))) as HTMLSelectElement;
  const good = h("select", { "aria-label": "Good" }, ...GOODS.map((g) => h("option", { value: g.id }, g.name))) as HTMLSelectElement;
  const treaty = h("select", { "aria-label": "Treaty" }, ...["truce", "trade", "roads", "prisoners"].map((t) => h("option", { value: t }, t))) as HTMLSelectElement;
  const rank = h("input", { type: "number", min: 0, max: 7, value: 1, class: "num", "aria-label": "Rank", title: "Rank (0 Watcher, 1 Warden, …)" }) as HTMLInputElement;
  const sync = () => {
    const d = COND_KINDS.find((x) => x.k === kind.value)!;
    n.hidden = !d.n;
    n.title = d.n ?? "";
    building.hidden = d.type !== "building";
    good.hidden = d.type !== "good";
    treaty.hidden = d.type !== "treaty";
    rank.hidden = d.type !== "rank";
  };
  if (c && c.k !== "all" && c.k !== "page") {
    kind.value = c.k;
    const any = c as { n?: number; type?: string; good?: string; kind?: string; rank?: number; player?: number };
    if (any.n !== undefined) n.value = String(any.n);
    if (c.k === "defeated") n.value = String(c.player);
    if (any.type) building.value = any.type;
    if (any.good) good.value = any.good;
    if (any.kind) treaty.value = any.kind;
    if (any.rank !== undefined) rank.value = String(any.rank);
  }
  sync();
  const num = () => Math.max(0, Math.round(Number(n.value) || 0));
  const get = (): Condition => {
    switch (kind.value as CondKind) {
      case "build":
        return { k: "build", type: building.value, n: Math.max(1, num()) };
      case "stock":
        return { k: "stock", good: good.value, n: num() };
      case "wardens":
        return { k: "wardens", rank: Math.round(Number(rank.value) || 0), n: num() };
      case "treaty":
        return { k: "treaty", kind: treaty.value as never };
      case "defeated":
        return { k: "defeated", player: num() };
      case "probe":
      case "colony":
      case "bloom":
      case "rooted":
      case "hamlet":
        return { k: kind.value } as Condition;
      default:
        return { k: kind.value, n: num() } as Condition;
    }
  };
  return { el: h("span", { class: "cond" }, kind, building, good, treaty, rank, n), get };
}

const ACTIONS: { a: Action["a"]; label: string }[] = [
  { a: "say", label: "Tell the player" },
  { a: "give", label: "Give goods" },
  { a: "event", label: "Bring an event" },
  { a: "peace", label: "Grant peace (days)" },
];

function actionRow(a: Action | undefined): { el: HTMLElement; get: () => Action } {
  const kind = h("select", { "aria-label": "Action", onchange: () => sync() }, ...ACTIONS.map((x) => h("option", { value: x.a }, x.label))) as HTMLSelectElement;
  const text = h("input", { type: "text", placeholder: "Message", "aria-label": "Message" }) as HTMLInputElement;
  const good = h("select", { "aria-label": "Good" }, ...GOODS.map((g) => h("option", { value: g.id }, g.name))) as HTMLSelectElement;
  const event = h("select", { "aria-label": "Event" }, ...["coldsnap", "flood", "blight", "meteors", "pests"].map((e) => h("option", { value: e }, e))) as HTMLSelectElement;
  const n = h("input", { type: "number", min: 0, value: 5, class: "num", "aria-label": "Amount" }) as HTMLInputElement;
  const sync = () => {
    text.hidden = kind.value !== "say";
    good.hidden = kind.value !== "give";
    event.hidden = kind.value !== "event";
    n.hidden = kind.value === "say";
    n.title = kind.value === "event" ? "Hours from now" : kind.value === "peace" ? "Days" : "How many";
  };
  if (a) {
    kind.value = a.a;
    if (a.a === "say") text.value = a.text;
    if (a.a === "give") {
      good.value = a.good;
      n.value = String(a.n);
    }
    if (a.a === "event") {
      event.value = a.kind;
      n.value = String(a.hours ?? 6);
    }
    if (a.a === "peace") n.value = String(a.days);
  }
  sync();
  const num = () => Math.max(0, Math.round(Number(n.value) || 0));
  const get = (): Action => {
    switch (kind.value as Action["a"]) {
      case "say":
        return { a: "say", text: text.value.trim() || "…" };
      case "give":
        return { a: "give", good: good.value, n: num() };
      case "event":
        return { a: "event", kind: event.value as never, hours: num() };
      default:
        return { a: "peace", days: num() };
    }
  };
  return { el: h("span", { class: "cond" }, kind, text, good, event, n), get };
}

/** Make or change a scenario: its world, its story, goals, events and how it can be lost. */
export class ScenarioEditor extends Panel {
  private def: ScenarioDef | null = null;
  onPlay: (id: string) => void = () => {};
  onSaved: () => void = () => {};
  currentSeed: () => string = () => "";

  constructor() {
    super("scenario-editor", "Scenario editor", { width: 620, className: "scenario-editor" });
  }

  open(def?: ScenarioDef, world?: SavedWorld): void {
    this.def = def ?? {
      id: `custom-${Date.now().toString(36)}`,
      kind: "custom",
      title: "A new scenario",
      blurb: "",
      seed: world?.seed ?? this.currentSeed(),
      opts: world ? { paint: world.paint, ...(world.size && { size: world.size }) } : {},
      intro: "",
      goals: [{ text: "Build a woodcutter", when: { k: "build", type: "woodcutter" } }],
      outro: "Well done.",
    };
    this.render();
    this.show();
  }

  private render(): void {
    const d = this.def!;
    const field = (label: string, el: HTMLElement) => h("div", { class: "row" }, h("label", {}, label), el, h("span"));
    const title = h("input", { type: "text", value: d.title, "aria-label": "Title" }) as HTMLInputElement;
    const author = h("input", { type: "text", value: d.author ?? "", placeholder: "Your name", "aria-label": "Author" }) as HTMLInputElement;
    const blurb = h("input", { type: "text", value: d.blurb, placeholder: "One line for the menu", "aria-label": "Blurb" }) as HTMLInputElement;
    const intro = h("textarea", { rows: 3, placeholder: "Told when it begins. Blank lines make paragraphs.", "aria-label": "Intro" }) as HTMLTextAreaElement;
    intro.value = d.intro;
    const outro = h("textarea", { rows: 2, placeholder: "Told when every goal is reached.", "aria-label": "Outro" }) as HTMLTextAreaElement;
    outro.value = d.outro;
    const seed = h("input", { type: "text", value: d.seed, "aria-label": "Seed" }) as HTMLInputElement;
    const worlds = library.worlds();
    const painted = h("select", { "aria-label": "Painted world" }, h("option", { value: "" }, "The seed as it is"), ...worlds.map((w) => h("option", { value: w.id }, w.name))) as HTMLSelectElement;
    const current = worlds.find((w) => d.opts?.paint && JSON.stringify(w.paint) === JSON.stringify(d.opts.paint));
    painted.value = current?.id ?? "";
    if (d.opts?.paint && !current) painted.prepend(h("option", { value: "keep", selected: true }, "Its own painted world"));
    const rivals = h("input", { type: "number", min: 0, max: 7, value: d.opts?.rivals ?? 0, class: "num", "aria-label": "AI rivals" }) as HTMLInputElement;
    const difficulty = h("select", { "aria-label": "Difficulty" }, ...["gentle", "honest", "hard"].map((x) => h("option", { value: x }, x[0]!.toUpperCase() + x.slice(1)))) as HTMLSelectElement;
    difficulty.value = d.opts?.difficulty ?? "honest";
    const peace = h("input", { type: "number", min: 0, max: 99, value: d.opts?.peaceDays ?? 1, class: "num", "aria-label": "Peace days" }) as HTMLInputElement;
    const withMods = h("input", { type: "checkbox", checked: !!d.opts?.mods?.length }) as HTMLInputElement;
    const sequential = h("input", { type: "checkbox", checked: !!d.sequential }) as HTMLInputElement;

    const goals: { text: HTMLInputElement; cond: ReturnType<typeof condRow> }[] = [];
    const goalList = h("ol", { class: "ed-list" });
    const addGoal = (text = "", c?: Condition) => {
      const t = h("input", { type: "text", value: text, placeholder: "What the player reads", "aria-label": "Goal text" }) as HTMLInputElement;
      const cond = condRow(c, () => {});
      const g = { text: t, cond };
      goals.push(g);
      const li = h("li", {}, t, cond.el, h("button", { class: "btn", "aria-label": "Remove goal", onclick: () => (goals.splice(goals.indexOf(g), 1), li.remove()) }, "✕"));
      goalList.append(li);
    };
    for (const g of d.goals) addGoal(g.text, g.when);

    const triggers: { cond: ReturnType<typeof condRow>; act: ReturnType<typeof actionRow> }[] = [];
    const trigList = h("ol", { class: "ed-list" });
    const addTrigger = (c?: Condition, a?: Action) => {
      const t = { cond: condRow(c, () => {}), act: actionRow(a) };
      triggers.push(t);
      const li = h("li", {}, h("span", { class: "ed-when" }, "When"), t.cond.el, h("span", { class: "ed-when" }, "then"), t.act.el, h("button", { class: "btn", "aria-label": "Remove event", onclick: () => (triggers.splice(triggers.indexOf(t), 1), li.remove()) }, "✕"));
      trigList.append(li);
    };
    for (const t of d.triggers ?? []) addTrigger(t.when, t.do[0]);

    const failOn = h("input", { type: "checkbox", checked: !!d.fail }) as HTMLInputElement;
    const failCond = condRow(d.fail?.when ?? { k: "defeated", player: 0 }, () => {});
    const failText = h("input", { type: "text", value: d.fail?.text ?? "The settlement is lost.", "aria-label": "Failure text" }) as HTMLInputElement;

    const collect = (): ScenarioDef | string => {
      if (!goals.length) return "A scenario needs at least one goal.";
      const w = worlds.find((x) => x.id === painted.value);
      const opts = { ...d.opts };
      delete opts.paint;
      delete opts.mods;
      delete opts.size;
      if (w) {
        opts.paint = w.paint;
        if (w.size) opts.size = w.size;
      } else if (painted.value === "keep" && d.opts?.paint) {
        opts.paint = d.opts.paint;
        if (d.opts.size) opts.size = d.opts.size;
      }
      const mods = library.enabledMods();
      if (withMods.checked && mods.length) opts.mods = mods;
      opts.rivals = Math.max(0, Math.min(7, Math.round(Number(rivals.value) || 0)));
      opts.difficulty = difficulty.value as never;
      opts.peaceDays = Math.max(0, Number(peace.value) || 0);
      return {
        id: d.id,
        kind: "custom",
        author: author.value.trim() || undefined,
        title: title.value.trim() || "Untitled",
        blurb: blurb.value.trim(),
        seed: (w?.seed ?? seed.value.trim()) || this.currentSeed(),
        opts,
        intro: intro.value.trim(),
        goals: goals.map((g) => ({ text: g.text.value.trim() || "A goal", when: g.cond.get() })),
        sequential: sequential.checked || undefined,
        triggers: triggers.length ? triggers.map((t) => ({ when: t.cond.get(), do: [t.act.get()] })) : undefined,
        fail: failOn.checked ? { when: failCond.get(), text: failText.value.trim() || "Lost." } : undefined,
        outro: outro.value.trim() || "Well done.",
      };
    };
    const msg = h("p", { class: "hint ed-msg" });
    const save = (): ScenarioDef | null => {
      const r = collect();
      if (typeof r === "string") {
        msg.textContent = r;
        return null;
      }
      // Mods in a scenario must be fine before it is kept (they shape the whole world).
      for (const m of r.opts?.mods ?? []) if (validateMod(m).length) return (msg.textContent = `Mod ${m.name} has problems.`), null;
      this.def = JSON.parse(JSON.stringify(r)) as ScenarioDef;
      msg.textContent = library.saveScenario(this.def) ? "Saved." : "Couldn't save (browser storage is full or off). Export it instead.";
      this.onSaved();
      return this.def;
    };

    this.body.replaceChildren(
      h(
        "div",
        { class: "form" },
        field("Title", title),
        field("Author", author),
        field("Blurb", blurb),
        field("Seed", seed),
        field("World", painted),
        field("Rivals", rivals),
        field("Peace days", peace),
        field("Difficulty", difficulty),
        h("label", { class: "inline" }, withMods, " include my turned-on mods"),
        h("h3", { class: "sub" }, "Story"),
        intro,
        outro,
        h("h3", { class: "sub" }, "Goals"),
        h("label", { class: "inline" }, sequential, " one at a time (like the tutorial)"),
        goalList,
        h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => addGoal() }, "Add a goal")),
        h("h3", { class: "sub" }, "Events"),
        h("p", { class: "hint" }, "Something happens once, the first time its condition is true: a message, goods in the Hearthship, a cold snap or flood, or a truce."),
        trigList,
        h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => addTrigger({ k: "day", n: 2 }, { a: "say", text: "" }) }, "Add an event")),
        h("h3", { class: "sub" }, "Losing"),
        h("div", { class: "row" }, h("label", { class: "inline" }, failOn, " lost if"), failCond.el),
        failText,
        msg,
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary", onclick: () => save() }, "Save"),
          h("button", { class: "btn", onclick: () => save() && (this.hide(), this.onPlay(this.def!.id)) }, "Save and play"),
          h("button", { class: "btn", onclick: () => save() && download(`${slug(this.def!.title)}.seedfall-scenario.json`, creationText({ kind: "scenario", data: this.def! })) }, "Export"),
          desktop()?.workshopUpload ? h("button", { class: "btn", onclick: () => save() && void shareToWorkshop({ kind: "scenario", data: this.def! }).then((m) => (msg.textContent = m)) }, "Share on Workshop") : "",
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The world painter's toolbox

export type Brush = PaintKind | "well";

export const BRUSHES: { id: Brush; label: string; hint: string }[] = [
  { id: "raise", label: "Raise", hint: "Lift the ground: hills, then mountains; out of the sea, new land." },
  { id: "lower", label: "Lower", hint: "Sink the ground: valleys, then bays." },
  { id: "level", label: "Level", hint: "Flatten to the height where you first click." },
  { id: "sea", label: "Sea", hint: "Flood it: lakes and straits." },
  { id: "region", label: "Region", hint: "Lay down a region: its ground, climate and life." },
  { id: "forest", label: "Woods", hint: "Plant trees." },
  { id: "clear", label: "Clear", hint: "Clear trees, rocks and scrub." },
  { id: "rocks", label: "Rocks", hint: "Scatter stone to quarry." },
  { id: "ore", label: "Ore", hint: "Put coal, iron, gold or granite underground (mines dig it in the hills)." },
  { id: "well", label: "Star Well", hint: "Click a Star Well, then where it should be." },
];

export const ORES: { id: Deposit; name: string }[] = [
  { id: Deposit.Coal, name: "Coal" },
  { id: Deposit.Iron, name: "Iron" },
  { id: Deposit.Gold, name: "Gold" },
  { id: Deposit.Granite, name: "Granite" },
  { id: Deposit.None, name: "None" },
];

export interface PainterState {
  brush: Brush;
  size: number;
  strength: number;
  region: number;
  ore: Deposit;
}

/** The painter's toolbox (a panel at the side while painting). */
export class PainterPanel {
  readonly root = h("aside", { class: "painter", hidden: true, "aria-label": "World painter" });
  readonly state: PainterState = { brush: "raise", size: 2, strength: 0.5, region: 0, ore: Deposit.Iron };
  private status = h("p", { class: "painter-status" });
  private nameInput = h("input", { type: "text", "aria-label": "World name", placeholder: "Name this world" }) as HTMLInputElement;

  constructor(
    private readonly act: {
      undo(): void;
      reset(): void;
      save(name: string): void;
      play(): void;
      scenario(): void;
      exportFile(name: string): void;
      close(): void;
    },
  ) {
    this.render();
  }

  get name(): string {
    return this.nameInput.value.trim() || "A painted world";
  }

  set name(v: string) {
    this.nameInput.value = v;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private render(): void {
    const s = this.state;
    const brushes = h(
      "div",
      { class: "painter-brushes", role: "radiogroup", "aria-label": "Brush" },
      ...BRUSHES.map((b) => h("button", { class: `btn${b.id === s.brush ? " on" : ""}`, title: b.hint, role: "radio", "aria-checked": b.id === s.brush ? "true" : "false", onclick: () => ((s.brush = b.id), this.render()) }, b.label)),
    );
    const hint = BRUSHES.find((b) => b.id === s.brush)!.hint;
    const size = h("input", { type: "range", min: 0, max: 6, step: 1, value: s.size, "aria-label": "Brush size", oninput: () => (s.size = Number(size.value)) }) as HTMLInputElement;
    const strength = h("input", { type: "range", min: 0.1, max: 1, step: 0.1, value: s.strength, "aria-label": "Strength", oninput: () => (s.strength = Number(strength.value)) }) as HTMLInputElement;
    const region = h("select", { "aria-label": "Region", onchange: () => (s.region = Number(region.value)) }, ...PAINT_REGIONS.map((r, i) => h("option", { value: i, selected: i === s.region }, r.name))) as HTMLSelectElement;
    const ore = h("select", { "aria-label": "Ore", onchange: () => (s.ore = Number(ore.value) as Deposit) }, ...ORES.map((o) => h("option", { value: o.id, selected: o.id === s.ore }, o.name))) as HTMLSelectElement;
    this.root.replaceChildren(
      h("h3", {}, "World painter"),
      brushes,
      h("p", { class: "hint" }, hint),
      s.brush === "well" ? "" : h("label", { class: "painter-row" }, "Size", size),
      s.brush === "raise" || s.brush === "lower" ? h("label", { class: "painter-row" }, "Strength", strength) : "",
      s.brush === "region" ? h("label", { class: "painter-row" }, "Region", region) : "",
      s.brush === "ore" ? h("label", { class: "painter-row" }, "Ore", ore) : "",
      this.status,
      this.nameInput,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", onclick: () => this.act.undo(), title: "Undo the last stroke (Ctrl+Z)" }, "Undo"),
        h("button", { class: "btn", onclick: () => this.act.reset() }, "Start over"),
        h("button", { class: "btn", onclick: () => this.act.save(this.name) }, "Save"),
        h("button", { class: "btn", onclick: () => this.act.exportFile(this.name) }, "Export"),
      ),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => this.act.play() }, "Play this world"),
        h("button", { class: "btn", onclick: () => this.act.scenario() }, "Make a scenario"),
        h("button", { class: "btn", onclick: () => this.act.close() }, "Close"),
      ),
    );
  }
}
