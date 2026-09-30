/**
 * Controller input through the Gamepad API (standard mapping). Steam Input presents every pad,
 * the Steam Deck included, as a standard gamepad, so this covers the desktop build and browsers
 * alike. Pure mapping (`readPad`, `padActions`) is separate from polling so it can be tested.
 */

/** Standard-mapping button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface PadState {
  /** Sticks after the dead zone, -1..1 (y down is positive, as the API reports). */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Triggers 0..1. */
  lt: number;
  rt: number;
  /** Buttons held. */
  down: boolean[];
}

export type PadAction = "confirm" | "back" | "radial" | "economy" | "menu" | "settings" | "road" | "flag" | "pause" | "grid" | "centre";

const DEAD = 0.18;

/** Radial dead zone with rescaling, so small drift reads as zero and full tilt as one. */
export function deadzone(x: number, y: number, dead = DEAD): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

/** A gamepad snapshot as plain numbers. */
export function readPad(p: { axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] }): PadState {
  const [lx, ly] = deadzone(p.axes[0] ?? 0, p.axes[1] ?? 0);
  const [rx, ry] = deadzone(p.axes[2] ?? 0, p.axes[3] ?? 0);
  return {
    lx,
    ly,
    rx,
    ry,
    lt: p.buttons[PAD.LT]?.value ?? 0,
    rt: p.buttons[PAD.RT]?.value ?? 0,
    down: p.buttons.map((b) => b.pressed),
  };
}

const PRESS: [number, PadAction][] = [
  [PAD.A, "confirm"],
  [PAD.B, "back"],
  [PAD.X, "radial"],
  [PAD.Y, "economy"],
  [PAD.VIEW, "menu"],
  [PAD.MENU, "settings"],
  [PAD.LB, "road"],
  [PAD.RB, "flag"],
  [PAD.DOWN, "pause"],
  [PAD.UP, "grid"],
  [PAD.RS, "centre"],
];

/** Buttons that went down since the last snapshot, as actions. */
export function padActions(prev: PadState | null, cur: PadState): PadAction[] {
  const out: PadAction[] = [];
  for (const [b, a] of PRESS) if (cur.down[b] && !prev?.down[b]) out.push(a);
  return out;
}

/** Any stick, trigger or button in use: the player is on the controller. */
export function padActive(s: PadState): boolean {
  return s.lx !== 0 || s.ly !== 0 || s.rx !== 0 || s.ry !== 0 || s.lt > 0.1 || s.rt > 0.1 || s.down.some(Boolean);
}

/** Polls the first connected gamepad each frame. */
export class GamepadInput {
  private prev: PadState | null = null;

  /** The current state and the actions pressed this frame, or null with no pad. */
  poll(): { state: PadState; actions: PadAction[] } | null {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === "standard") ?? [...pads].find((p) => p && p.connected);
    if (!pad) {
      this.prev = null;
      return null;
    }
    const state = readPad(pad);
    const actions = padActions(this.prev, state);
    this.prev = state;
    return { state, actions };
  }
}
