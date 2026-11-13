import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RequirementsSheet } from "@quorumind/core";
import i18next, { type TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { deadlineText, usersText } from "./sheetText.ts";

// The sentences that count things, read in the language of the person: the plural form follows the number.

async function translator(code: string): Promise<TFunction> {
  const translation = JSON.parse(readFileSync(join(import.meta.dirname, "locales", `${code}.json`), "utf8"));
  const instance = i18next.createInstance();
  await instance.init({ lng: code, resources: { [code]: { translation } }, interpolation: { escapeValue: false } });
  return instance.t;
}

const users = (launch: number) => ({ users: { launch, oneYear: null, note: "" } }) as unknown as RequirementsSheet;
const weeks = (amount: number) =>
  ({ deadline: { date: null, duration: { amount, unit: "week" }, note: "" } }) as unknown as RequirementsSheet;

describe("counted sentences", () => {
  it("say one user and one week in the singular, several in the plural, with the number written for the language", async () => {
    const en = await translator("en");
    expect(usersText(users(1), en, "en")).toBe("1 user at launch");
    expect(usersText(users(1200), en, "en")).toBe("1,200 users at launch");
    expect(deadlineText(weeks(1), en, "en")).toBe("1 week");
    expect(deadlineText(weeks(6), en, "en")).toBe("6 weeks");
  });

  it("follow French, where zero and one are singular", async () => {
    const fr = await translator("fr");
    expect(deadlineText(weeks(1), fr, "fr")).toBe("1 semaine");
    expect(deadlineText(weeks(0), fr, "fr")).toBe("0 semaine");
    expect(deadlineText(weeks(2), fr, "fr")).toBe("2 semaines");
  });

  it("use the six forms of Arabic, the dual included", async () => {
    const ar = await translator("ar");
    const said = [1, 2, 3, 11, 100].map((count) => deadlineText(weeks(count), ar, "en"));
    expect(said).toEqual(["أسبوع واحد", "أسبوعان", "3 أسابيع", "11 أسبوعًا", "100 أسبوع"]);
  });

  it("have only one form in Japanese and Chinese", async () => {
    const ja = await translator("ja");
    const zh = await translator("zh-Hans");
    expect(deadlineText(weeks(1), ja, "ja")).toBe("1 週");
    expect(deadlineText(weeks(3), zh, "zh-Hans")).toBe("3 周");
  });
});
