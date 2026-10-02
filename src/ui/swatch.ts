import { goodColor, goodShape } from "../core/access";
import { h } from "./dom";

/** The coloured mark beside a good's name: its colour in the chosen palette, and its shape. */
export function swatch(goodId: string): HTMLElement {
  return h("i", { class: `sw sw-${goodShape(goodId)}`, style: `background:${goodColor(goodId)}`, "aria-hidden": "true" });
}
