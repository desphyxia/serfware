/**
 * Key bindings the player can change (Settings, Controls). Keys are stored by their `KeyboardEvent.key`
 * in lower case; arrow keys always work for the camera as well. Bindings are kept in this browser.
 */

import { tr } from "./i18n";

export interface KeyAction {
  id: string;
  label: string;
  /** Where it belongs in the Controls list. */
  group: "Game" | "Camera" | "Tools" | "Panels";
  key: string;
}

export const ACTIONS: readonly KeyAction[] = [
  { id: "pause", label: tr("Pause / resume"), group: "Game", key: " " },
  { id: "menu", label: tr("Game menu"), group: "Game", key: "m" },
  { id: "grid", label: tr("Hex grid"), group: "Game", key: "g" },
  { id: "photo", label: tr("Photo mode"), group: "Game", key: "f2" },
  { id: "letters", label: tr("Skyship letters"), group: "Game", key: "f4" },
  { id: "debug", label: tr("Debug dialog"), group: "Game", key: "f3" },
  { id: "report", label: tr("Report a bug"), group: "Game", key: "f8" },
  { id: "left", label: tr("Move left"), group: "Camera", key: "a" },
  { id: "right", label: tr("Move right"), group: "Camera", key: "d" },
  { id: "up", label: tr("Move forward"), group: "Camera", key: "w" },
  { id: "down", label: tr("Move back"), group: "Camera", key: "s" },
  { id: "turnLeft", label: tr("Turn left"), group: "Camera", key: "q" },
  { id: "turnRight", label: tr("Turn right"), group: "Camera", key: "e" },
  { id: "resetView", label: tr("Reset the view"), group: "Camera", key: "r" },
  { id: "tiltUp", label: tr("Tilt up"), group: "Camera", key: "pageup" },
  { id: "tiltDown", label: tr("Tilt down"), group: "Camera", key: "pagedown" },
  { id: "zoomIn", label: tr("Zoom in"), group: "Camera", key: "+" },
  { id: "zoomOut", label: tr("Zoom out"), group: "Camera", key: "-" },
  { id: "flag", label: tr("Flag tool"), group: "Tools", key: "1" },
  { id: "road", label: tr("Road tool"), group: "Tools", key: "2" },
  { id: "demolish", label: tr("Demolish"), group: "Tools", key: "x" },
  { id: "cat-materials", label: tr("Materials"), group: "Tools", key: "3" },
  { id: "cat-food", label: tr("Food"), group: "Tools", key: "4" },
  { id: "cat-metal", label: tr("Mining"), group: "Tools", key: "5" },
  { id: "cat-storage", label: tr("Homes"), group: "Tools", key: "6" },
  { id: "cat-lantern", label: tr("Lanterns"), group: "Tools", key: "7" },
  { id: "cat-terra", label: tr("Terraform"), group: "Tools", key: "8" },
  { id: "cat-decor", label: tr("Decor"), group: "Tools", key: "9" },
  { id: "economy", label: tr("Economy panel"), group: "Panels", key: "p" },
  { id: "almanac", label: tr("Almanac"), group: "Panels", key: "l" },
  { id: "diplomacy", label: tr("Diplomacy"), group: "Panels", key: "j" },
  { id: "systemMap", label: tr("System map"), group: "Panels", key: "o" },
];

const STORAGE_KEY = "seedfall.keys";
/** Keys that cannot be rebound: they are needed to get out of trouble. */
export const RESERVED = new Set(["escape", "tab"]);

export class Keymap {
  private readonly map = new Map<string, string>();

  constructor(stored?: Readonly<Record<string, string>>) {
    for (const a of ACTIONS) this.map.set(a.id, a.key);
    if (stored) for (const [id, key] of Object.entries(stored)) if (this.map.has(id) && typeof key === "string" && key.length > 0 && !RESERVED.has(key)) this.map.set(id, key.toLowerCase());
    // A stored file could bind one key twice: keep the first action's, restore the others' defaults.
    const seen = new Set<string>();
    for (const a of ACTIONS) {
      const k = this.map.get(a.id) as string;
      if (seen.has(k)) this.map.set(a.id, a.key);
      seen.add(this.map.get(a.id) as string);
    }
  }

  static load(): Keymap {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) return new Keymap(JSON.parse(raw) as Record<string, string>);
    } catch {
      // Unreadable storage: the defaults will do.
    }
    return new Keymap();
  }

  key(action: string): string {
    return this.map.get(action) ?? "";
  }

  /** The action a key is bound to, if any. */
  actionOf(key: string): string | null {
    const k = key.toLowerCase();
    for (const [id, v] of this.map) if (v === k) return id;
    return null;
  }

  /** Bind a key; refuses reserved keys and keys another action holds. Returns a reason when it refuses. */
  set(action: string, key: string): string | null {
    const k = key.toLowerCase();
    if (!this.map.has(action)) return "No such action.";
    if (RESERVED.has(k)) return "That key can't be changed.";
    const other = this.actionOf(k);
    if (other && other !== action) return `Already used for: ${ACTIONS.find((a) => a.id === other)?.label ?? other}.`;
    this.map.set(action, k);
    this.save();
    return null;
  }

  reset(): void {
    for (const a of ACTIONS) this.map.set(a.id, a.key);
    this.save();
  }

  private save(): void {
    const changed: Record<string, string> = {};
    for (const a of ACTIONS) if (this.map.get(a.id) !== a.key) changed[a.id] = this.map.get(a.id) as string;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(changed));
    } catch {
      // Bindings last for this session.
    }
  }
}

/** A key's name for display ("Space", "F2", "Page Up", "A"). */
export function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key === "pageup") return "Page Up";
  if (key === "pagedown") return "Page Down";
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1);
}
