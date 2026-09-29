type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: h("div", { class: "x", onclick: fn }, "text", child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export async function copyText(text: string, fallbackArea?: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackArea) {
      fallbackArea.value = text;
      fallbackArea.hidden = false;
      fallbackArea.focus();
      fallbackArea.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** A draggable, closable floating panel. */
export class Panel {
  readonly root: HTMLElement;
  readonly body: HTMLElement;

  constructor(
    readonly id: string,
    title: string,
    opts: { width?: number; className?: string } = {},
  ) {
    const close = h("button", { class: "panel-x", "aria-label": `Close ${title}`, onclick: () => this.hide() }, "×");
    const head = h("header", { class: "panel-head" }, h("h2", {}, title), close);
    this.body = h("div", { class: "panel-body" });
    this.root = h("section", { class: `panel ${opts.className ?? ""}`, id, role: "dialog", "aria-label": title }, head, this.body);
    if (opts.width) this.root.style.width = `${opts.width}px`;
    this.root.hidden = true;
    let drag: { x: number; y: number; l: number; t: number } | null = null;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = this.root.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.root.style.left = `${Math.max(0, drag.l + e.clientX - drag.x)}px`;
      this.root.style.top = `${Math.max(0, drag.t + e.clientY - drag.y)}px`;
      this.root.style.right = "auto";
    });
    head.addEventListener("pointerup", () => (drag = null));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.onShow();
  }

  hide(): void {
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  protected onShow(): void {}
}
