import type { DesktopBridge } from "./bridge";

/**
 * Steam Cloud mirror of the save slots. Saves stay in localStorage (the game's store); each one
 * is also written to Steam Cloud as `save-<id>.json` with an index `saves.json`, so they follow
 * the player to another machine. On start, cloud saves missing locally are pulled in.
 */
export class CloudSaves {
  constructor(
    private readonly bridge: DesktopBridge,
    private readonly local: Storage,
  ) {}

  async enabled(): Promise<boolean> {
    try {
      return await this.bridge.cloudEnabled();
    } catch {
      return false;
    }
  }

  /** Mirror one save and the index. */
  async push(id: string): Promise<void> {
    if (!(await this.enabled())) return;
    const text = this.local.getItem(`seedfall.save.${id}`);
    if (text) await this.bridge.cloudWrite(`save-${id}.json`, text);
    await this.bridge.cloudWrite("saves.json", this.local.getItem("seedfall.saves") ?? "[]");
  }

  async remove(id: string): Promise<void> {
    if (!(await this.enabled())) return;
    await this.bridge.cloudDelete(`save-${id}.json`);
    await this.bridge.cloudWrite("saves.json", this.local.getItem("seedfall.saves") ?? "[]");
  }

  /** Bring in saves that exist in the cloud but not here. Returns how many were added. */
  async pull(): Promise<number> {
    if (!(await this.enabled())) return 0;
    let remote: { id: string }[];
    try {
      remote = JSON.parse((await this.bridge.cloudRead("saves.json")) ?? "[]") as { id: string }[];
    } catch {
      return 0;
    }
    let local: { id: string }[];
    try {
      local = JSON.parse(this.local.getItem("seedfall.saves") ?? "[]") as { id: string }[];
    } catch {
      local = [];
    }
    let added = 0;
    for (const meta of remote) {
      if (local.some((m) => m.id === meta.id)) continue;
      const text = await this.bridge.cloudRead(`save-${meta.id}.json`);
      if (!text) continue;
      this.local.setItem(`seedfall.save.${meta.id}`, text);
      local.push(meta);
      added++;
    }
    if (added) this.local.setItem("seedfall.saves", JSON.stringify(local));
    return added;
  }
}
