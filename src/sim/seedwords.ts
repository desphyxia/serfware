import { Rng } from "./rng";

const ADJECTIVES = [
  "amber", "ashen", "autumn", "brisk", "cedar", "copper", "dawn", "dusky", "ember", "fallow",
  "fern", "frost", "gentle", "gilded", "hazel", "hollow", "ivory", "juniper", "lantern", "linen",
  "loam", "meadow", "misty", "moss", "north", "oaken", "pale", "quiet", "rain", "russet",
  "saffron", "salt", "silver", "slate", "sorrel", "still", "tide", "umber", "velvet", "willow",
];

const NOUNS = [
  "anchor", "barrow", "beacon", "brook", "cairn", "comet", "croft", "dell", "ember", "fen",
  "field", "fjord", "glade", "grove", "harbor", "hearth", "heron", "hollow", "isle", "kestrel",
  "kiln", "lark", "marsh", "mill", "moth", "orchard", "otter", "pine", "quarry", "reef",
  "ridge", "rook", "shoal", "spire", "thicket", "vale", "wren", "yarrow", "yew", "zephyr",
];

/** A readable seed such as "russet-heron-417". Any string is also a valid seed. */
export function randomSeedWord(entropy: number): string {
  const r = new Rng(entropy >>> 0);
  return `${r.pick(ADJECTIVES)}-${r.pick(NOUNS)}-${r.int(100, 999)}`;
}

/** Normalise user input into a seed string. */
export function normaliseSeed(input: string): string {
  const s = input.trim().toLowerCase().replace(/\s+/g, "-");
  return s.length > 0 ? s.slice(0, 64) : "hearth-1";
}
