import { t, tr } from "../core/i18n";
import { h } from "./dom";

/**
 * Captions for sounds, at the foot of the screen, for players who cannot hear them (or have the sound off):
 * "[axe chopping, left]", "[birdsong]", "[rain]". Each kind is shown at most once every few seconds.
 */
export class Captions {
  readonly root = h("div", { class: "captions", "aria-live": "off" });
  private readonly last = new Map<string, number>();
  on = false;

  /** Show a caption for a kind of sound, unless the same kind was shown less than `gap` ms ago. */
  say(kind: string, text: string, now: number, gap = 4000): void {
    if (!this.on) return;
    if (now - (this.last.get(kind) ?? -1e9) < gap) return;
    this.last.set(kind, now);
    const el = h("span", {}, text);
    this.root.append(el);
    while (this.root.children.length > 3) this.root.firstElementChild?.remove();
    setTimeout(() => el.remove(), 3200);
  }
}

const WORK: Record<string, string> = {
  chop: tr("axe chopping"),
  clink: tr("stone being cut"),
  hammer: tr("hammering"),
  saw: tr("saw buzzing"),
};

/** The words for a work sound at a pan position (-1 left … 1 right). */
export function workCaption(kind: string, pan: number): string {
  const side = pan < -0.35 ? t("left") : pan > 0.35 ? t("right") : "";
  const what = t(WORK[kind] ?? kind);
  return side ? `[${what}, ${side}]` : `[${what}]`;
}

/** Caption for the ambience: what the world sounds like around the view. */
export function ambientCaptions(s: { daylight: number; water: number; rain: number; wind: number; closeness: number }): [string, string][] {
  const out: [string, string][] = [];
  if (s.rain > 0.3) out.push(["rain", `[${t("rain falling")}]`]);
  if (s.water > 0.3) out.push(["sea", `[${t("waves on the shore")}]`]);
  if (s.wind > 0.7) out.push(["wind", `[${t("wind")}]`]);
  if (s.closeness > 0.3) out.push([s.daylight > 0.5 ? "birds" : "crickets", `[${s.daylight > 0.5 ? t("birdsong") : t("crickets")}]`]);
  return out;
}
