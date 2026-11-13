import { describe, expect, it } from "vitest";
import { agencyLabels } from "./agency-labels.ts";
import { auditLabels } from "./audit-labels.ts";
import { complianceLabels } from "./compliance-labels.ts";
import { decisionLabels } from "./decision-labels.ts";
import { LOCALES } from "./locales.ts";
import { fill, reportLabels } from "./report.ts";
import { researchLabels } from "./research-labels.ts";

// The labels of reports and exports that count something use plural forms, never "week(s)".

const FILLER = /[\p{L}]\((s|n|e|es|x|en)\)|[\p{L}]\/(e|i)\b/u;

const tablesOf = (code: (typeof LOCALES)[number]["code"]) => ({
  report: reportLabels(code),
  audit: auditLabels(code),
  decision: decisionLabels(code),
  agency: agencyLabels(code),
  research: researchLabels(code),
  compliance: complianceLabels(code),
});

/** Every `{name|form=text|form=text}` block of a template, with its forms. */
const blocks = (text: string) =>
  [...text.matchAll(/\{(\w+)\|((?:\\.|[^}\\])*)\}/g)].map((match) => ({
    name: match[1] as string,
    forms: (match[2] as string).split(/(?<!\\)\|/).map((form) => form.slice(0, form.indexOf("="))),
  }));

describe("the label tables", () => {
  // French, Spanish, Portuguese and Italian also have `many` (millions); fill() falls back to `other` there.
  it.each(LOCALES.map((locale) => locale.code))("%s: every plural template has `other` and each form the language selects", (code) => {
    const needed = new Intl.PluralRules(code)
      .resolvedOptions()
      .pluralCategories.filter((form) => !(form === "many" && ["fr", "es", "pt", "it"].includes(code)));
    let found = 0;
    for (const [name, table] of Object.entries(tablesOf(code))) {
      for (const [key, text] of Object.entries(table as Record<string, unknown>)) {
        if (typeof text !== "string") continue;
        for (const block of blocks(text)) {
          found++;
          expect(block.forms, `${code}: ${name}.${key}`).toContain("other");
          for (const form of needed) expect(block.forms, `${code}: ${name}.${key} ${block.name}`).toContain(form);
        }
      }
    }
    // Japanese and Chinese count with one form and have no template: they need none.
    if (!["ja", "zh-Hans"].includes(code)) expect(found).toBeGreaterThanOrEqual(2);
  });

  it.each(LOCALES.map((locale) => locale.code))("%s has no (s) filler", (code) => {
    const tables = tablesOf(code);
    for (const [name, table] of Object.entries(tables)) {
      for (const [key, text] of Object.entries(table as Record<string, string>)) {
        if (typeof text === "string") expect(text, `${code}: ${name}.${key}`).not.toMatch(FILLER);
      }
    }
  });
});

describe("counted sentences", () => {
  const weeks = (code: "en" | "fr" | "ar" | "ja", count: number) => fill(reportLabels(code).late, { weeks: count }, code);

  it("follow English: one is singular, the rest plural", () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => weeks("en", n))).toEqual([
      "Late by 0 weeks",
      "Late by 1 week",
      "Late by 2 weeks",
      "Late by 3 weeks",
      "Late by 11 weeks",
      "Late by 100 weeks",
    ]);
  });

  it("follow French, where zero is singular", () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => weeks("fr", n))).toEqual([
      "En retard de 0 semaine",
      "En retard de 1 semaine",
      "En retard de 2 semaines",
      "En retard de 3 semaines",
      "En retard de 11 semaines",
      "En retard de 100 semaines",
    ]);
  });

  it("use the six forms of Arabic", () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => weeks("ar", n))).toEqual([
      "تأخير 0 أسبوع",
      "تأخير أسبوع واحد",
      "تأخير أسبوعين",
      "تأخير 3 أسابيع",
      "تأخير 11 أسبوعًا",
      "تأخير 100 أسبوع",
    ]);
  });

  it("have one form in Japanese", () => {
    expect([0, 1, 2, 3, 11, 100].map((n) => weeks("ja", n))).toEqual([0, 1, 2, 3, 11, 100].map((n) => `${n} 週の遅れ`));
  });

  it("agree the verb of the shortened debate with its number of rounds", () => {
    const t = reportLabels("fr").shortened;
    expect(fill(t, { done: 1, planned: 2 }, "fr")).toContain("1 tour a eu lieu sur les 2 prévus");
    expect(fill(t, { done: 0, planned: 1 }, "fr")).toContain("0 tour a eu lieu sur 1 prévu");
  });

  it("keeps a formatted count and plural-selects on the number behind it", () => {
    expect(fill("{count|one=# difference|other=# differences}", { count: "1,200" }, "en", { count: 1200 })).toBe("1,200 differences");
    expect(fill("{count|one=# difference|other=# differences}", { count: "1" }, "en", { count: 1 })).toBe("1 difference");
  });

  it("falls back to `other`, then to the first form written, never to an empty text", () => {
    expect(fill("{n|one=# day|other=# days}", { n: 5 }, "en")).toBe("5 days");
    expect(fill("{n|few=# a|many=# b}", { n: 1 }, "en")).toBe("1 a");
    expect(fill("{n|one=# day}", { n: 3 }, "en")).toBe("3 day");
    expect(fill("{n|one=# day|other=# days}", { n: "x" }, "en")).toBe("x days");
  });

  it("reads a literal | or } inside a form when it is escaped", () => {
    expect(fill("{n|one=# a\\|b|other=# a\\}b}", { n: 1 }, "en")).toBe("1 a|b");
    expect(fill("{n|one=# a\\|b|other=# a\\}b}", { n: 2 }, "en")).toBe("2 a}b");
  });
});
