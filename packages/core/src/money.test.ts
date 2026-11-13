import { describe, expect, it } from "vitest";
import { formatCurrency } from "./money.ts";

const eur = (locale: string, options: Intl.NumberFormatOptions = {}) =>
  formatCurrency(new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", ...options }), 0, "EUR");
const fmt = (locale: string, amount: number, currency: string, options: Intl.NumberFormatOptions = {}) =>
  formatCurrency(new Intl.NumberFormat(locale, { style: "currency", currency, ...options }), amount, currency);
const NB = " ";

describe("formatCurrency", () => {
  it("puts the euro after the amount in English", () => {
    expect(fmt("en", 1234.5, "EUR")).toBe(`1,234.50${NB}€`);
    expect(eur("en")).toBe(`0.00${NB}€`);
  });

  it("keeps the minus and plus signs in front", () => {
    expect(fmt("en", -5, "EUR")).toBe(`-5.00${NB}€`);
    expect(fmt("en", 12, "EUR", { signDisplay: "exceptZero" })).toBe(`+12.00${NB}€`);
  });

  it("builds a range with the euro after each end", () => {
    const options = { maximumFractionDigits: 0 };
    expect(`${fmt("en", 120, "EUR", options)} – ${fmt("en", 260, "EUR", options)}`).toBe(`120${NB}€ – 260${NB}€`);
  });

  it("moves the euro after the amount in Portuguese, Japanese and Chinese", () => {
    expect(fmt("pt", 1234.5, "EUR")).toBe(`1.234,50${NB}€`);
    expect(fmt("ja", 3, "EUR", { maximumFractionDigits: 0 })).toBe(`3${NB}€`);
    expect(fmt("zh-Hans", 3, "EUR", { maximumFractionDigits: 0 })).toBe(`3${NB}€`);
  });

  it("leaves languages that already put the euro after unchanged", () => {
    for (const locale of ["fr", "de", "es", "it", "ar"]) {
      const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
      expect(formatCurrency(formatter, -1234.5, "EUR")).toBe(formatter.format(-1234.5));
    }
  });

  it("keeps the right-to-left mark of Arabic", () => {
    const formatter = new Intl.NumberFormat("ar", { style: "currency", currency: "EUR", signDisplay: "always" });
    const text = formatCurrency(formatter, -5, "EUR");
    expect(text).toBe(formatter.format(-5));
    expect(text).toMatch(/‏|؜|‎/);
  });

  it("leaves other currencies to their language", () => {
    expect(fmt("en", 1234.5, "USD")).toBe("$1,234.50");
    expect(fmt("fr", 1234.5, "USD")).toBe(new Intl.NumberFormat("fr", { style: "currency", currency: "USD" }).format(1234.5));
  });
});
