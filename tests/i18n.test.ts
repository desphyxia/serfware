import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { format, languages, markers, registerLanguage, setLanguage, t } from "../src/core/i18n";
import "../src/locales";

const template = JSON.parse(readFileSync("src/locales/template.json", "utf8")) as Record<string, string>;
const sv = JSON.parse(readFileSync("src/locales/sv.json", "utf8")) as Record<string, string>;

describe("localisation", () => {
  it("shows English when there is no translation, and fills in values", () => {
    setLanguage("en");
    expect(t("Settings")).toBe("Settings");
    expect(t("Day {day}, {season}", { day: 3, season: "spring" })).toBe("Day 3, spring");
    registerLanguage({ id: "xx", name: "Test", catalogue: { Settings: "Inställ" } });
    setLanguage("xx");
    expect(t("Settings")).toBe("Inställ");
    expect(t("Something new")).toBe("Something new");
    setLanguage("nonsense");
    expect(t("Settings")).toBe("Settings");
    expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
    setLanguage("en");
  });

  it("offers Swedish", () => {
    expect(languages().map((l) => l.id)).toContain("sv");
    setLanguage("sv");
    expect(t("Settings")).toBe("Inställningar");
    setLanguage("en");
  });

  it("keeps the template in step with the code, and every translation complete with the same {values}", () => {
    // The template lists every text in the code: it must be up to date (npm run strings -- --write).
    const out = execFileSync("node", ["scripts/extract-strings.mjs"], { encoding: "utf8" });
    expect(out).toContain(`${Object.keys(template).length} texts in the code`);
    for (const key of Object.keys(template)) {
      expect(sv[key], `Swedish: ${key}`).toBeTruthy();
      expect(markers(sv[key] as string), `values in: ${key}`).toEqual(markers(key));
    }
    for (const key of Object.keys(sv)) expect(template[key], `stale Swedish text: ${key}`).toBeDefined();
  });
});
