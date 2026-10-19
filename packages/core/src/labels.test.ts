import { describe, expect, it } from "vitest";
import { AGENCY_LABEL_KEYS, AGENCY_LABELS } from "./agency-labels.ts";
import { AUDIT_LABEL_KEYS, AUDIT_LABELS } from "./audit-labels.ts";
import { COMPLIANCE_LABELS } from "./compliance-labels.ts";
import { DECISION_LABEL_KEYS, DECISION_LABELS } from "./decision-labels.ts";
import { LOCALES } from "./locales.ts";
import { LABEL_KEYS, LABELS } from "./report-labels.ts";
import { RESEARCH_LABELS } from "./research-labels.ts";

// Every set of labels of the exports, with the keys each language must have.
const SETS = [
  ["report", LABELS, LABEL_KEYS],
  ["agency", AGENCY_LABELS, AGENCY_LABEL_KEYS],
  ["audit", AUDIT_LABELS, AUDIT_LABEL_KEYS],
] as const;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** Every text of a set of labels, nested ones included, by its path: "requirements.gdpr_processors". */
function texts(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "string") return { [path]: value };
  if (!value || typeof value !== "object") return {};
  return Object.assign({}, ...Object.entries(value).map(([key, item]) => texts(item, path ? `${path}.${key}` : key)));
}

// The sets of labels without a list of keys, some of them nested: English is the reference of every language.
const NESTED = [
  ["decision", DECISION_LABELS, DECISION_LABEL_KEYS],
  ["compliance", COMPLIANCE_LABELS, null],
  ["research", RESEARCH_LABELS, null],
] as const;

describe.each(NESTED)("%s labels", (_name, labels, keys) => {
  const all = labels as Record<string, unknown>;
  const english = texts(all.en);

  it("has keys in English", () => {
    expect(Object.keys(english).length).toBeGreaterThan(0);
    for (const key of keys ?? [])
      expect(
        Object.keys(english).some((path) => path === key || path.startsWith(`${key}.`)),
        key,
      ).toBe(true);
  });

  it.each(LOCALES.map((locale) => locale.code))("%s has every label of English, with its placeholders", (locale) => {
    const translated = texts(all[locale]);
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    for (const [path, value] of Object.entries(translated)) {
      expect(value.trim(), `${locale}: ${path}`).not.toBe("");
      expect(placeholders(value), `${locale}: ${path}`).toEqual(placeholders(english[path] ?? ""));
      expect(value, `${locale}: ${path}`).not.toMatch(/\p{Cc}/u);
    }
  });

  it("follows French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [path, value] of Object.entries(texts(all.fr))) {
      expect(value, path).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, path).not.toMatch(/«[^  ]/u);
    }
  });
});

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
