import { composePostcard, letterCode, makeLetter, mergeLetters, readLetter, thumbnail, type Letter } from "../core/postcard";
import { copyText, h, Panel } from "./dom";

/** The looks a photograph can take, applied over the game's own colour grade. */
export const FILTERS = {
  none: { name: "As it is", saturation: 1, contrast: 1, exposure: 1, tint: [1, 1, 1], vignette: 0 },
  vivid: { name: "Vivid", saturation: 1.35, contrast: 1.08, exposure: 1, tint: [1, 1, 1], vignette: 0.05 },
  faded: { name: "Faded", saturation: 0.65, contrast: 0.9, exposure: 1.08, tint: [1.03, 1.0, 0.95], vignette: 0.1 },
  noir: { name: "Noir", saturation: 0, contrast: 1.3, exposure: 1, tint: [1, 1, 1], vignette: 0.3 },
  sepia: { name: "Sepia", saturation: 0.3, contrast: 1.1, exposure: 1, tint: [1.12, 1.0, 0.78], vignette: 0.2 },
  dusk: { name: "Golden hour", saturation: 1.1, contrast: 1.05, exposure: 1, tint: [1.12, 0.98, 0.84], vignette: 0.12 },
  frost: { name: "Frost", saturation: 0.8, contrast: 1.05, exposure: 1.04, tint: [0.9, 0.98, 1.1], vignette: 0.1 },
} as const;
export type FilterId = keyof typeof FILTERS;

/** What the photographer has set. Only looks: nothing here touches the simulation. */
export interface PhotoState {
  open: boolean;
  /** 0 = sharp everywhere, 1 = strong blur away from the focus. */
  dof: number;
  /** Hours the light is moved from the world clock (-12 to 12). */
  hourShift: number;
  filter: FilterId;
  /** Hide every other panel and button. */
  clean: boolean;
}

export function newPhotoState(): PhotoState {
  return { open: false, dof: 0, hourShift: 0, filter: "none", clean: true };
}

export interface PhotoHost {
  state: PhotoState;
  /** The next rendered frame, copied to a canvas. */
  capture(): Promise<HTMLCanvasElement>;
  /** Where and when, for the card and the letter. */
  context(): { seed: string; day: number; player: string; season: string };
  changed(): void;
  notify(text: string, kind?: "info" | "warn" | "good"): void;
}

function save(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }, "image/png");
}

/** Photo mode (F2): look controls, a plain photograph and a postcard. */
export class PhotoPanel extends Panel {
  constructor(private readonly host: PhotoHost) {
    super("photo", "Photo mode", { width: 280, className: "photo-panel" });
    const s = host.state;
    const range = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const out = h("output", {}, fmt(get()));
      const input = h("input", { type: "range", min, max, step, value: get(), "aria-label": label }) as HTMLInputElement;
      input.addEventListener("input", () => {
        set(Number(input.value));
        out.textContent = fmt(get());
        host.changed();
      });
      return h("div", { class: "row" }, h("label", {}, label), input, out);
    };
    const filter = h("select", { "aria-label": "Filter" }, ...Object.entries(FILTERS).map(([id, f]) => h("option", { value: id }, f.name))) as HTMLSelectElement;
    filter.addEventListener("change", () => {
      s.filter = filter.value as FilterId;
      host.changed();
    });
    const clean = h("input", { type: "checkbox", checked: s.clean, "aria-label": "Hide the interface" }) as HTMLInputElement;
    clean.addEventListener("change", () => {
      s.clean = clean.checked;
      host.changed();
    });
    const caption = h("input", { type: "text", placeholder: "A line for the postcard", maxlength: 80, "aria-label": "Postcard line" }) as HTMLInputElement;
    this.body.append(
      h("p", { class: "hint" }, "Move the camera as usual (drag, wheel, Q/E, tilt), then set the light. This only changes how the world looks, never the game."),
      h("div", { class: "form" }, range("Blur", 0, 1, 0.05, () => s.dof, (v) => (s.dof = v), (v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`)), range("Time of day", -12, 12, 0.5, () => s.hourShift, (v) => (s.hourShift = v), (v) => (v === 0 ? "now" : `${v > 0 ? "+" : ""}${v} h`)), h("div", { class: "row" }, h("label", {}, "Filter"), filter, h("span")), h("div", { class: "row" }, h("label", {}, "Hide interface"), clean, h("span")), h("div", { class: "row" }, h("label", {}, "Postcard"), caption, h("span"))),
      h(
        "div",
        { class: "buttons" },
        h("button", { onclick: () => void this.photo() }, "Take photo"),
        h("button", { onclick: () => void this.postcard(caption.value) }, "Make postcard"),
        h("button", { onclick: () => this.hide() }, "Done"),
      ),
    );
  }

  protected override onShow(): void {
    this.host.state.open = true;
    this.host.changed();
  }

  override hide(): void {
    super.hide();
    this.host.state.open = false;
    this.host.changed();
  }

  private async photo(): Promise<void> {
    const c = await this.host.capture();
    const x = this.host.context();
    save(c, `seedfall-${x.seed}-day${Math.floor(x.day)}.png`);
    this.host.notify("Photo saved.", "good");
  }

  /** The postcard for the view as it is now. */
  async makePostcard(line: string): Promise<HTMLCanvasElement> {
    const c = await this.host.capture();
    const x = this.host.context();
    return composePostcard(c, c.width, c.height, { title: x.seed, caption: line.trim() || `Day ${Math.floor(x.day)}, ${x.season}`, from: x.player });
  }

  private async postcard(line: string): Promise<void> {
    const card = await this.makePostcard(line);
    const x = this.host.context();
    save(card, `seedfall-postcard-${x.seed}-day${Math.floor(x.day)}.png`);
    this.host.notify("Postcard saved.", "good");
  }
}

const LETTERS_KEY = "seedfall.letters";

function loadLetters(): Letter[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LETTERS_KEY) ?? "[]") as unknown[];
    return raw.map((x) => readLetter(JSON.stringify(x))).filter((x): x is Letter => !!x);
  } catch {
    return [];
  }
}

function storeLetters(l: readonly Letter[]): void {
  try {
    localStorage.setItem(LETTERS_KEY, JSON.stringify(l));
  } catch {
    // No storage: letters last until the page is closed.
  }
}

/**
 * Skyship letters (F4): write a note, with or without a picture of your settlement, and hand over its
 * code; paste one you were given to have it arrive. No server is involved: the letters travel however
 * you send them, like saves do.
 */
export class LettersPanel extends Panel {
  private letters: Letter[] = loadLetters();
  private readonly list: HTMLElement;
  private readonly code: HTMLTextAreaElement;

  constructor(private readonly host: PhotoHost, private readonly visit: (seed: string) => void) {
    super("letters", "Skyship letters", { width: 380 });
    const to = h("input", { type: "text", placeholder: "To (optional)", maxlength: 40, "aria-label": "To" }) as HTMLInputElement;
    const text = h("textarea", { rows: 4, maxlength: 600, placeholder: "Write a letter…", "aria-label": "Letter" }) as HTMLTextAreaElement;
    const withPicture = h("input", { type: "checkbox", checked: true, "aria-label": "Send a picture" }) as HTMLInputElement;
    this.code = h("textarea", { class: "report-text", rows: 4, placeholder: "A letter's code appears here, or paste one you received and press Receive.", "aria-label": "Letter code" }) as HTMLTextAreaElement;
    this.list = h("div", { class: "save-list" });
    this.body.append(
      h("div", { class: "form" }, h("div", { class: "row" }, h("label", {}, "To"), to, h("span")), text, h("div", { class: "row" }, h("label", {}, "Picture"), withPicture, h("span"))),
      h(
        "div",
        { class: "buttons" },
        h("button", { onclick: () => void this.send(to.value, text.value, withPicture.checked) }, "Send by skyship"),
        h("button", { onclick: () => this.receive(this.code.value) }, "Receive"),
        h("button", { onclick: () => void copyText(this.code.value, this.code).then((ok) => ok && this.host.notify("Copied.", "good")) }, "Copy code"),
      ),
      this.code,
      this.list,
    );
    this.render();
  }

  protected override onShow(): void {
    this.render();
  }

  private async send(to: string, text: string, picture: boolean): Promise<void> {
    if (!text.trim()) {
      this.host.notify("Write something first.", "warn");
      return;
    }
    const x = this.host.context();
    const pic = picture ? thumbnail(await this.host.capture()) : undefined;
    const letter = makeLetter({ from: x.player, seed: x.seed, day: x.day, to, text, picture: pic });
    this.code.value = letterCode(letter);
    this.host.notify("The skyship is loaded. Hand over the code below.", "good");
  }

  receive(text: string): void {
    const l = readLetter(text);
    if (!l) {
      this.host.notify("That is not a Seedfall letter.", "warn");
      return;
    }
    this.letters = mergeLetters(this.letters, l);
    storeLetters(this.letters);
    this.render();
    this.host.notify(`A skyship brings a letter from ${l.from}.`, "good");
  }

  private render(): void {
    this.list.replaceChildren(
      ...(this.letters.length
        ? this.letters.map((l) => {
            const row = h("div", { class: "letter" }, h("strong", {}, `${l.from} · day ${l.day} · ${l.seed}`), l.picture ? h("img", { src: l.picture, alt: "Postcard", width: 320 }) : null, h("p", {}, l.text));
            row.append(h("button", { onclick: () => this.visit(l.seed) }, "Visit their world"));
            return row;
          })
        : [h("p", { class: "hint" }, "No letters yet.")]),
    );
  }
}

/** The bar shown while a time-lapse plays. */
export class TimelapseBar {
  readonly root: HTMLElement;
  private readonly bar: HTMLInputElement;
  private readonly label: HTMLElement;

  constructor(o: { speeds: number[]; setSpeed: (v: number) => void; restart: () => void; exit: () => void; orbit: (on: boolean) => void; photo: () => void }) {
    this.bar = h("input", { type: "range", min: 0, max: 1000, value: 0, disabled: true, "aria-label": "Progress" }) as HTMLInputElement;
    this.label = h("span", { class: "tl-label" }, "");
    const speed = h("select", { "aria-label": "Speed" }, ...o.speeds.map((v) => h("option", { value: v }, `×${v}`))) as HTMLSelectElement;
    speed.value = String(o.speeds[Math.floor(o.speeds.length / 2)]);
    speed.addEventListener("change", () => o.setSpeed(Number(speed.value)));
    const orbit = h("input", { type: "checkbox", "aria-label": "Slowly turn the camera" }) as HTMLInputElement;
    orbit.addEventListener("change", () => o.orbit(orbit.checked));
    this.root = h("div", { class: "timelapse", hidden: true }, h("strong", {}, "Time-lapse"), speed, this.bar, this.label, h("label", {}, orbit, " turn"), h("button", { onclick: o.restart }, "Restart"), h("button", { onclick: o.photo }, "Photo"), h("button", { onclick: o.exit }, "Back to the game"));
  }

  show(on: boolean): void {
    this.root.hidden = !on;
  }

  update(progress: number, text: string): void {
    this.bar.value = String(Math.round(progress * 1000));
    this.label.textContent = text;
  }
}
