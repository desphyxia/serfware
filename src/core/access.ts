/**
 * Colour for goods and players, with palettes that stay readable for colour-blind players.
 * Goods are never told apart by colour alone: each also has a shape (circle, square, diamond,
 * triangle) shown in its swatch, so 17 goods need only eight colours.
 */

import { tr } from "./i18n";

export type PaletteId = "default" | "safe";

export const SHAPES = ["circle", "square", "diamond", "triangle"] as const;
export type Shape = (typeof SHAPES)[number];

export const GOOD_IDS = ["blade", "bow", "mount", "log", "stone", "plank", "grain", "flour", "bread", "fish", "livestock", "meat", "coal", "ironore", "iron", "goldore", "gold"] as const;

/**
 * The shape of each good: the first eight goods are circles, the next eight squares, the last a
 * diamond, so goods that share a colour (every eighth) never share a shape.
 */
export const GOOD_SHAPE: Record<string, Shape> = Object.fromEntries(GOOD_IDS.map((id, i) => [id, SHAPES[Math.floor(i / 8)] as Shape]));

interface PaletteDef {
  name: string;
  goods: Record<string, string>;
  players: string[];
}

/**
 * Eight colours found by searching for the set whose two nearest members stay furthest apart
 * (CIE76 ΔE of 28 or more) for normal vision and for protan, deutan and tritan colour blindness,
 * keeping to mid-light, saturated colours that read on both grass and sea.
 */
const SAFE = ["#206080", "#e0a000", "#8020e0", "#e0e080", "#a04000", "#60e0e0", "#c060e0", "#80a060"];

function spread(colors: string[]): Record<string, string> {
  // Colours in turn; a colour only repeats on a different shape (see GOOD_SHAPE).
  const out: Record<string, string> = {};
  GOOD_IDS.forEach((id, i) => (out[id] = colors[i % colors.length] as string));
  return out;
}

export const PALETTES: Record<PaletteId, PaletteDef> = {
  default: {
    name: tr("Default"),
    goods: { blade: "#c9d3de", bow: "#8a5a2b", mount: "#7a5236", log: "#9a6a42", stone: "#a9a59d", plank: "#e0b27a", grain: "#e2c46e", flour: "#f1e6cc", bread: "#d98f4e", fish: "#7fc4c8", livestock: "#f0c8b8", meat: "#b8574a", coal: "#2e2e34", ironore: "#a0583f", iron: "#8f96a3", goldore: "#c9a24a", gold: "#f0c85a" },
    players: ["#f0b25a", "#6fc3e0", "#e57a9a", "#a4d86a", "#b58ae8", "#e8e070", "#ff8c5a", "#7ae0b8"],
  },
  safe: { name: tr("Colour-blind safe"), goods: spread(SAFE), players: SAFE },
};

let active: PaletteId = "default";
const listeners = new Set<() => void>();

export function setPalette(id: PaletteId): void {
  active = PALETTES[id] ? id : "default";
  for (const l of listeners) l();
}

export function palette(): PaletteId {
  return active;
}

export function onPalette(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function goodColor(id: string): string {
  return PALETTES[active].goods[id] ?? PALETTES.default.goods[id] ?? "#cccccc";
}

export function goodShape(id: string): Shape {
  return GOOD_SHAPE[id] ?? "circle";
}

export function playerHex(i: number): string {
  const p = PALETTES[active].players;
  return p[i % p.length] as string;
}

// ---- colour-blindness simulation (used by the tests) ----

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/** Machado, Oliveira and Fernandes (2009), full severity, applied in linear RGB. */
export const CVD: Record<"protan" | "deutan" | "tritan", Matrix> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)) as [number, number, number];
}

/** CIE Lab of a colour as seen with (or without) a kind of colour blindness. */
export function lab(hex: string, kind?: keyof typeof CVD): [number, number, number] {
  let [r, g, b] = rgbOf(hex);
  if (kind) {
    const m = CVD[kind];
    [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  }
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** How different two colours look (CIE76 ΔE) to someone with the given kind of colour blindness. */
export function difference(a: string, b: string, kind?: keyof typeof CVD): number {
  const p = lab(a, kind);
  const q = lab(b, kind);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
