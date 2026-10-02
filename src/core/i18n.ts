/**
 * Localisation. Interface text is written in English in the code and wrapped in a call to t();
 * a language is a catalogue from that English text to its translation, so a missing translation is
 * simply shown in English. `{name}` marks a value filled in at run time and must appear in every
 * translation. `npm run strings` lists the texts in the code and how much of each language is done.
 */

export interface Language {
  id: string;
  /** The language's own name. */
  name: string;
  catalogue: Readonly<Record<string, string>>;
}

const registry = new Map<string, Language>();
let current: Language | null = null;

export function registerLanguage(l: Language): void {
  registry.set(l.id, l);
}

export function languages(): Language[] {
  return [{ id: "en", name: "English", catalogue: {} }, ...registry.values()];
}

export function setLanguage(id: string): void {
  current = registry.get(id) ?? null;
}

export function language(): string {
  return current?.id ?? "en";
}

/** Fill `{name}` markers in a text. */
export function format(text: string, values?: Readonly<Record<string, string | number>>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** The text in the current language (English if it has no translation), with values filled in. */
export function t(text: string, values?: Readonly<Record<string, string | number>>): string {
  return format(current?.catalogue[text] ?? text, values);
}

/** Markers in a text, sorted, for checking translations. */
export function markers(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}

/** Marks a text to be translated later (at the place it is shown with t()); returns it unchanged. */
export const tr = (text: string): string => text;
