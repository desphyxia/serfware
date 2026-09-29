import { crash, formatReport, type CapturedError } from "../core/crash";
import { copyText, h, Panel } from "./dom";

/** Bug report dialog. Opens automatically on a crash, or any time with F8. */
export class ReportPanel extends Panel {
  private readonly summary: HTMLElement;
  private readonly area: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly title: HTMLInputElement;
  private crashed: CapturedError | null = null;

  constructor() {
    super("report", "Report a bug", { width: 440, className: "report" });
    this.summary = h("p", { class: "lede" });
    this.title = h("input", { type: "text", id: "r-title", placeholder: "What went wrong, in a few words" }) as HTMLInputElement;
    this.area = h("textarea", { class: "report-text", readonly: true, rows: 8, hidden: true, "aria-label": "Report text" }) as HTMLTextAreaElement;
    this.status = h("span", { class: "status", role: "status" });
    this.body.append(
      this.summary,
      h("div", { class: "row" }, h("label", { for: "r-title" }, "Title"), this.title, h("span")),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => void this.copy() }, "Copy report"),
        h("button", { class: "btn", onclick: () => this.preview() }, "Show report"),
        h("button", { class: "btn", onclick: () => this.hide() }, "Continue playing"),
      ),
      this.status,
      this.area,
      h(
        "p",
        { class: "hint" },
        "The report includes the seed, build, position, time of day, settings, recent log lines, errors and memory history. Paste it into a GitHub issue.",
      ),
    );
    crash.onCrash((e) => {
      if (e.kind === "manual") return;
      this.crashed = e;
      this.show();
    });
  }

  protected override onShow(): void {
    this.area.hidden = true;
    this.status.textContent = "";
    if (this.crashed) {
      this.root.classList.add("crashed");
      this.summary.textContent = `Something went wrong: ${this.crashed.message}. The game will try to keep running. Copy the report so we can fix it.`;
      if (!this.title.value) this.title.value = this.crashed.message.slice(0, 80);
    } else {
      this.root.classList.remove("crashed");
      this.summary.textContent = "Describe the problem, then copy the report. Everything we need to reproduce it is included.";
    }
  }

  override hide(): void {
    super.hide();
    this.crashed = null;
  }

  private text(): string {
    return formatReport(crash.build(this.title.value.trim() || "Untitled"));
  }

  private preview(): void {
    this.area.value = this.text();
    this.area.hidden = false;
  }

  private async copy(): Promise<void> {
    const ok = await copyText(this.text(), this.area);
    this.status.textContent = ok ? "Copied to clipboard." : "Select the text below and copy it.";
  }
}
