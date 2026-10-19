import { describe, expect, it } from "vitest";
import { AGENCY_LABEL_KEYS, AGENCY_LABELS } from "./agency-labels.ts";
import { LOCALES } from "./locales.ts";
import { LABEL_KEYS, LABELS } from "./report-labels.ts";

// Every set of labels of the exports, with the keys each language must have.
const SETS = [
  ["report", LABELS, LABEL_KEYS],
  ["agency", AGENCY_LABELS, AGENCY_LABEL_KEYS],
] as const;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe.each(SETS)("%s labels", (_name, labels, keys) => {
  const all = labels as Record<string, Record<string, string>>;

  it.each(LOCALES.map((locale) => locale.code))("%s has every label, with the English placeholders", (locale) => {
    const translated = all[locale] ?? {};
    expect(Object.keys(translated).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(translated[key]?.trim(), `${locale}: ${key}`).not.toBe("");
      expect(placeholders(translated[key] ?? ""), `${locale}: ${key}`).toEqual(placeholders(all.en?.[key] ?? ""));
      // A control character is what a botched replacement leaves behind.
      expect(translated[key], `${locale}: ${key}`).not.toMatch(/\p{Cc}/u);
    }
  });

  it("follows French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [key, value] of Object.entries(all.fr ?? {})) {
      expect(value, key).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, key).not.toMatch(/«[^  ]/u);
    }
  });
});
