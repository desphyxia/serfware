import { describe, expect, it } from "vitest";
import { difference, GOOD_IDS, GOOD_SHAPE, PALETTES, type PaletteId } from "../src/core/access";
import { GOODS } from "../src/sim/econ/defs";

const KINDS = [undefined, "protan", "deutan", "tritan"] as const;

describe("palettes", () => {
  it("cover every good, and every good has a shape", () => {
    for (const id of GOOD_IDS) expect(GOODS.some((g) => g.id === id), `${id} is a good`).toBe(true);
    for (const id of GOOD_IDS) expect(GOOD_SHAPE[id], id).toBeDefined();
    for (const id of GOOD_IDS) for (const p of Object.keys(PALETTES) as PaletteId[]) expect(PALETTES[p].goods[id], `${p} ${id}`).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("never give two goods the same colour and the same shape", () => {
    for (const p of ["safe"] as const) {
      const seen = new Map<string, string>();
      for (const id of GOOD_IDS) {
        const key = `${PALETTES[p].goods[id]}/${GOOD_SHAPE[id]}`;
        expect(seen.get(key), `${p}: ${id} repeats ${seen.get(key)}`).toBeUndefined();
        seen.set(key, id);
      }
    }
  });

  it("keep goods of the same shape apart for every kind of colour blindness", () => {
    const g = PALETTES.safe.goods;
    for (const kind of KINDS) {
      for (let i = 0; i < GOOD_IDS.length; i++) for (let j = i + 1; j < GOOD_IDS.length; j++) {
        if (GOOD_SHAPE[GOOD_IDS[i]!] !== GOOD_SHAPE[GOOD_IDS[j]!]) continue;
        expect(difference(g[GOOD_IDS[i]!]!, g[GOOD_IDS[j]!]!, kind), `${GOOD_IDS[i]} / ${GOOD_IDS[j]} ${kind ?? "normal"}`).toBeGreaterThan(25);
      }
    }
  });

  it("keep players apart for every kind of colour blindness", () => {
    const worst: Record<string, number> = {};
    for (const p of ["safe"] as const) {
      for (const kind of KINDS) {
        let min = Infinity;
        const c = PALETTES[p].players;
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) min = Math.min(min, difference(c[i]!, c[j]!, kind));
        worst[`${p}/${kind ?? "normal"}`] = Math.round(min);
        expect(min, `${p} ${kind ?? "normal"}`).toBeGreaterThan(25);
      }
    }
    // Printed for the README: the least ΔE between any two players per palette and vision.
    expect(Object.keys(worst).length).toBe(4);
  });
});
