import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILDING_OWNERS, COMMAND_OWNERS } from "../src/sim/ai/coverage";
import { BUILDINGS } from "../src/sim/econ/defs";

const source = (file: string) => readFileSync(new URL(`../src/sim/${file}`, import.meta.url), "utf8");

describe("what the AI can do", () => {
  it("accounts for every building type", () => {
    const missing = BUILDINGS.map((b) => b.id).filter((id) => !(id in BUILDING_OWNERS));
    expect(missing, "buildings with no owner in ai/coverage.ts").toEqual([]);
    const stale = Object.keys(BUILDING_OWNERS).filter((id) => !BUILDINGS.some((b) => b.id === id));
    expect(stale, "owners for buildings that no longer exist").toEqual([]);
  });

  it("names a source that mentions each command and building it claims", () => {
    for (const [cmd, owner] of Object.entries(COMMAND_OWNERS)) {
      if ("exempt" in owner) continue;
      expect(source(owner.by), `${owner.by} should issue "${cmd}"`).toMatch(new RegExp(`t: "${cmd}"`));
    }
    for (const [id, owner] of Object.entries(BUILDING_OWNERS)) {
      if ("exempt" in owner) continue;
      expect(source(owner.by), `${owner.by} should place "${id}"`).toMatch(new RegExp(`["']${id}["']`));
    }
  });

  it("gives every exemption a reason", () => {
    for (const owner of [...Object.values(COMMAND_OWNERS), ...Object.values(BUILDING_OWNERS)]) if ("exempt" in owner) expect(owner.exempt.length).toBeGreaterThan(20);
  });
});
