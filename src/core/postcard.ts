/**
 * Postcards and skyship letters. There is no server: a letter is a short piece of text (or a small
 * file) that one player hands to another by any means they like, as with saves. It carries a note,
 * where the sender lives and when, and optionally a small picture; the receiver's game shows it as
 * arriving by skyship and keeps it in the Letters list.
 */

export interface Letter {
  format: "seedfall-letter";
  version: 1;
  /** Who it is from, and the world they write from (seed and game day). */
  from: string;
  seed: string;
  day: number;
  /** Who it is for (free text; empty for anyone). */
  to: string;
  text: string;
  /** A postcard picture: a small JPEG as a data URL (about 10 KB), if sent along. */
  picture?: string;
  /** When it was written (ISO), for ordering. */
  sent: string;
}

export const MAX_LETTER_TEXT = 600;
const PREFIX = "seedfall-letter:";

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function makeLetter(o: { from: string; seed: string; day: number; to?: string; text: string; picture?: string; now?: Date }): Letter {
  return { format: "seedfall-letter", version: 1, from: o.from.trim().slice(0, 40) || "A traveller", seed: o.seed, day: Math.max(0, Math.floor(o.day)), to: (o.to ?? "").trim().slice(0, 40), text: o.text.trim().slice(0, MAX_LETTER_TEXT), ...(o.picture && { picture: o.picture }), sent: (o.now ?? new Date()).toISOString() };
}

/** A letter as one line of text to paste anywhere. */
export function letterCode(l: Letter): string {
  return PREFIX + b64encode(JSON.stringify(l));
}

/** Read a letter from its code or its raw JSON; null if it is neither (nothing is trusted: fields are checked and cut to size). */
export function readLetter(text: string): Letter | null {
  const t = text.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(t.startsWith(PREFIX) ? b64decode(t.slice(PREFIX.length)) : t);
  } catch {
    return null;
  }
  const o = raw as Partial<Letter> | null;
  if (!o || o.format !== "seedfall-letter" || o.version !== 1 || typeof o.text !== "string" || typeof o.from !== "string" || typeof o.seed !== "string") return null;
  const picture = typeof o.picture === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]{1,200000}$/.test(o.picture) ? o.picture : undefined;
  return {
    format: "seedfall-letter",
    version: 1,
    from: o.from.slice(0, 40),
    seed: o.seed.slice(0, 80),
    day: Number.isFinite(o.day) ? Math.max(0, Math.floor(o.day as number)) : 0,
    to: typeof o.to === "string" ? o.to.slice(0, 40) : "",
    text: o.text.slice(0, MAX_LETTER_TEXT),
    ...(picture && { picture }),
    sent: typeof o.sent === "string" ? o.sent.slice(0, 40) : "",
  };
}

/** The same letter twice is one letter. */
export function letterKey(l: Letter): string {
  return `${l.sent}|${l.from}|${l.seed}|${l.text.slice(0, 40)}`;
}

/** The Letters in storage, newest first. */
export function mergeLetters(have: readonly Letter[], add: Letter): Letter[] {
  if (have.some((x) => letterKey(x) === letterKey(add))) return [...have];
  return [add, ...have].sort((a, b) => (a.sent < b.sent ? 1 : a.sent > b.sent ? -1 : 0)).slice(0, 50);
}

export interface PostcardInfo {
  /** Place line, e.g. the world's seed. */
  title: string;
  /** Under it: day and season, or whatever the player wrote. */
  caption: string;
  from: string;
}

/**
 * A postcard: the picture on a paper card with a stamp-like corner and two lines of writing. Drawn
 * on a 2D canvas from any image source (the game canvas).
 */
export function composePostcard(source: CanvasImageSource, sw: number, sh: number, info: PostcardInfo, width = 1200): HTMLCanvasElement {
  const margin = Math.round(width * 0.03);
  const pw = width - margin * 2;
  const ph = Math.round((pw * sh) / sw);
  const foot = Math.round(width * 0.09);
  const height = margin * 2 + ph + foot;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (!g) return c;
  g.fillStyle = "#f4ecd8";
  g.fillRect(0, 0, width, height);
  g.drawImage(source, margin, margin, pw, ph);
  g.strokeStyle = "#cdbf9d";
  g.lineWidth = 2;
  g.strokeRect(margin - 1, margin - 1, pw + 2, ph + 2);
  g.fillStyle = "#4a3f2a";
  g.font = `italic ${Math.round(foot * 0.36)}px Georgia, serif`;
  g.textBaseline = "middle";
  g.fillText(info.title, margin, margin + ph + foot * 0.34);
  g.font = `${Math.round(foot * 0.27)}px Georgia, serif`;
  g.fillStyle = "#6b5d40";
  g.fillText(info.caption, margin, margin + ph + foot * 0.72);
  g.textAlign = "right";
  g.fillText(`from ${info.from}`, width - margin, margin + ph + foot * 0.72);
  // A small stamp in the corner of the picture.
  const s = Math.round(width * 0.07);
  g.save();
  g.translate(width - margin - s - 14, margin + 14);
  g.rotate(0.05);
  g.fillStyle = "#f4ecd8";
  g.fillRect(0, 0, s, s * 1.15);
  g.strokeStyle = "#b9482f";
  g.setLineDash([4, 3]);
  g.strokeRect(2, 2, s - 4, s * 1.15 - 4);
  g.setLineDash([]);
  g.fillStyle = "#b9482f";
  g.beginPath();
  g.moveTo(s / 2, s * 0.22);
  g.lineTo(s * 0.78, s * 0.62);
  g.lineTo(s * 0.22, s * 0.62);
  g.closePath();
  g.fill();
  g.restore();
  return c;
}

/** A small JPEG of a canvas as a data URL, for a letter. */
export function thumbnail(source: HTMLCanvasElement, maxSide = 320, quality = 0.6): string {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(source.width * k));
  c.height = Math.max(1, Math.round(source.height * k));
  c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
