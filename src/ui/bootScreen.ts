/** The start-up overlay in index.html: a progress bar shown until the first frame is on screen. */
export const bootScreen = {
  /** Show how far start-up has got (0 to 1) and what it is doing. */
  set(fraction: number, message: string): void {
    const el = document.getElementById("boot");
    if (!el) return;
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    el.setAttribute("aria-valuenow", String(pct));
    const fill = el.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${pct}%`;
    const msg = el.querySelector<HTMLElement>(".msg");
    if (msg) msg.textContent = message;
  },
  /** Fade the overlay out and remove it. */
  hide(): void {
    const el = document.getElementById("boot");
    if (!el) return;
    el.classList.add("done");
    window.setTimeout(() => el.remove(), 500);
  },
};
