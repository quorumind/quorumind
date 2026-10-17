import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "@quorumind/core/locales";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "locales");
const load = (code: string) => JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as Record<string, unknown>;

function keys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

function placeholders(text: string) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

function value(node: Record<string, unknown>, path: string): string {
  return path.split(".").reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], node) as string;
}

describe("interface translations", () => {
  const english = load("en");
  const englishKeys = keys(english).sort();

  it("has one file per supported language", () => {
    const files = readdirSync(dir)
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual(LOCALES.map((locale) => locale.code).sort());
  });

  it.each(LOCALES.map((locale) => locale.code))("%s has exactly the English keys", (code) => {
    expect(keys(load(code)).sort()).toEqual(englishKeys);
  });

  it.each(LOCALES.map((locale) => locale.code))("%s keeps every placeholder", (code) => {
    const translated = load(code);
    for (const key of englishKeys) {
      expect(placeholders(value(translated, key)), `${code}: ${key}`).toEqual(placeholders(value(english, key)));
      expect(value(translated, key).trim(), `${code}: ${key}`).not.toBe("");
    }
  });
});
