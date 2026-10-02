import { t } from "../core/i18n";
import { copyText, h } from "./dom";

const ICONS = {
  settings:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.3 4.6-.1-2.2 2-1.6-2-3.5-2.4.9a8 8 0 0 0-1.9-1.1L15.5 3h-4l-.4 2.6c-.7.3-1.3.6-1.9 1.1l-2.4-.9-2 3.5 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.5 2.4-.9c.6.5 1.2.8 1.9 1.1l.4 2.6h4l.4-2.6c.7-.3 1.3-.6 1.9-1.1l2.4.9 2-3.5-2-1.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  debug:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 16l4-5 3 3 5-7 2 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v6a4 4 0 0 1-8 0V8Zm1-3 1.5 2M15 5l-1.5 2M4 12h4m8 0h4M5 18l3-2m11 2-3-2M5 7l3 2m11-2-3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/** Always-visible HUD: toolbar, bug line (seed · build · coordinate · time) and warning badge. */
export class Hud {
  readonly root: HTMLElement;
  private readonly bugLine: HTMLButtonElement;
  private readonly fps: HTMLElement;
  private readonly badge: HTMLButtonElement;
  private readonly banner: HTMLElement;
  private lastText = "";

  constructor(actions: { settings: () => void; debug: () => void; report: () => void; menu: () => void }) {
    const btn = (label: string, key: string, icon: string, fn: () => void) => {
      const b = h("button", { class: "tool", title: `${label} (${key})`, "aria-label": label, onclick: fn });
      b.innerHTML = icon;
      return b;
    };
    const toolbar = h(
      "nav",
      { class: "toolbar", "aria-label": "Game menu" },
      btn(t("Game menu"), "M", ICONS.menu, actions.menu),
      btn(t("Report a bug"), "F8", ICONS.bug, actions.report),
      btn(t("Debug"), "F3", ICONS.debug, actions.debug),
      btn(t("Settings"), "Esc", ICONS.settings, actions.settings),
    );
    this.bugLine = h("button", { class: "bugline", title: "Click to copy. Include this line in bug reports." }) as HTMLButtonElement;
    this.bugLine.addEventListener("click", () => {
      void copyText(this.lastText).then((ok) => {
        if (!ok) return;
        this.bugLine.classList.add("copied");
        setTimeout(() => this.bugLine.classList.remove("copied"), 900);
      });
    });
    this.fps = h("div", { class: "fps", hidden: true });
    this.badge = h("button", { class: "badge", hidden: true, onclick: actions.debug }) as HTMLButtonElement;
    this.banner = h("div", { class: "banner", hidden: true, role: "status" });
    this.root = h("div", { class: "hud" }, toolbar, this.fps, this.badge, this.banner, this.bugLine);
  }

  setBugLine(parts: string[]): void {
    const text = parts.join(" · ");
    if (text === this.lastText) return;
    this.lastText = text;
    this.bugLine.textContent = text;
  }

  bugLineText(): string {
    return this.lastText;
  }

  setFps(show: boolean, fps: number): void {
    this.fps.hidden = !show;
    if (show) this.fps.textContent = `${fps.toFixed(0)} fps`;
  }

  setBanner(text: string | null): void {
    this.banner.hidden = !text;
    if (text && this.banner.textContent !== text) this.banner.textContent = text;
  }

  warn(text: string | null): void {
    this.badge.hidden = !text;
    if (text) this.badge.textContent = text;
  }
}
