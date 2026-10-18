import { describe, expect, it } from "vitest";
import { LABEL_KEYS, LABELS } from "./report-labels.ts";

describe("report labels", () => {
  it.each(Object.keys(LABELS))("%s has every label", (locale) => {
    const labels = LABELS[locale as keyof typeof LABELS];
    expect(Object.keys(labels).sort()).toEqual([...LABEL_KEYS].sort());
    for (const key of LABEL_KEYS) expect(labels[key].trim(), `${locale}: ${key}`).not.toBe("");
  });

  it("follows French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [key, value] of Object.entries(LABELS.fr)) {
      expect(value, key).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, key).not.toMatch(/«[^  ]/u);
    }
  });
});
