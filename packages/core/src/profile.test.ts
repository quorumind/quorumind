import { describe, expect, it } from "vitest";
import { DEMO_SHEET } from "./demo.ts";
import { currencyCode, currencyCodes, unknownCurrencies, withCurrencyCodes } from "./profile.ts";

describe("currencies", () => {
  it("reads an ISO 4217 code from what was written, and refuses three letters that are not one", () => {
    expect(currencyCode("eur")).toBe("EUR");
    expect(currencyCode(" € ")).toBe("EUR");
    expect(currencyCode("XOF")).toBe("XOF");
    // Intl.NumberFormat formats any three letters: the code must be a known one.
    expect(currencyCode("DOL")).toBeNull();
    expect(currencyCode("EURO")).toBeNull();
    expect(currencyCode("")).toBeNull();
  });

  it("lists the known codes, sorted", () => {
    const codes = currencyCodes();
    expect(codes).toContain("EUR");
    expect(codes).toContain("MAD");
    expect(codes).not.toContain("DOL");
    expect(codes).toEqual([...codes].sort());
  });

  const sheet = (build: string | null, run: string | null) => ({
    ...DEMO_SHEET,
    budget: {
      ...DEMO_SHEET.budget,
      build: build === null ? null : { amount: 15000, currency: build },
      run: run === null ? null : { amount: 200, currency: run, period: "month" as const },
    },
  });

  it("names the currencies of a budget that are not codes", () => {
    expect(unknownCurrencies(sheet("DOL", "usd"))).toEqual(["DOL"]);
    expect(unknownCurrencies(sheet("EUR", null))).toEqual([]);
    expect(unknownCurrencies(sheet(null, null))).toEqual([]);
  });

  it("writes a model's budget in codes, without failing on a currency that does not exist", () => {
    expect(withCurrencyCodes(sheet("€", "eur"), "USD").budget).toMatchObject({ build: { currency: "EUR" }, run: { currency: "EUR" } });
    // The other amount's currency first, then the fallback.
    expect(withCurrencyCodes(sheet("DOL", "chf"), "USD").budget).toMatchObject({ build: { currency: "CHF" }, run: { currency: "CHF" } });
    expect(withCurrencyCodes(sheet("DOL", null), "EUR").budget).toMatchObject({ build: { amount: 15000, currency: "EUR" }, run: null });
  });
});
