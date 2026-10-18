import { describe, expect, it } from "vitest";
import {
  CLOUD_PROVIDERS,
  isPriceReferenceStale,
  PRICE_ITEMS,
  PRICE_MAX_AGE_DAYS,
  PRICE_REFERENCE,
  priceAgeDays,
  priceReferenceProblems,
  priceReferenceRule,
} from "./cloud-prices.ts";

describe("reference cloud prices", () => {
  it("loads a valid, dated file with a source for every figure", () => {
    expect(priceReferenceProblems(PRICE_REFERENCE)).toEqual([]);
    expect(PRICE_REFERENCE.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const item of PRICE_REFERENCE.items) expect(item.source).toMatch(/^https:\/\//);
    // Every provider prices every item: the proposers can compare like with like.
    for (const provider of CLOUD_PROVIDERS) {
      for (const kind of PRICE_ITEMS) {
        expect(
          PRICE_REFERENCE.items.some((item) => item.provider === provider && item.item === kind),
          `${provider} ${kind}`,
        ).toBe(true);
      }
    }
  });

  it("reports what is wrong with a broken file", () => {
    expect(priceReferenceProblems(null)).toEqual(["The price file is not an object."]);
    expect(priceReferenceProblems({ asOf: "19/10/2026", items: [] })).toEqual([
      '"asOf" must be a date written YYYY-MM-DD.',
      '"items" must list at least one price.',
    ]);
    const item = { ...PRICE_REFERENCE.items[0], provider: "hetzner", price: -1, source: "http://example.com" };
    expect(priceReferenceProblems({ asOf: "2026-10-19", items: [item] })).toEqual([
      'items[0]: unknown provider "hetzner".',
      "items[0]: the price must be a number.",
      "items[0]: the source must be an https address.",
    ]);
  });

  it("tells when the figures are older than 90 days", () => {
    const asOf = { asOf: "2026-01-01" };
    expect(priceAgeDays(asOf, new Date("2026-01-31T12:00:00Z"))).toBe(30);
    expect(priceAgeDays(asOf, new Date("2025-12-31T12:00:00Z"))).toBe(0);
    expect(isPriceReferenceStale(asOf, new Date(Date.parse("2026-01-01") + PRICE_MAX_AGE_DAYS * 86_400_000))).toBe(false);
    expect(isPriceReferenceStale(asOf, new Date(Date.parse("2026-01-01") + (PRICE_MAX_AGE_DAYS + 1) * 86_400_000))).toBe(true);
  });

  it("gives the proposers the figures, dated, as references to check", () => {
    const rule = priceReferenceRule();
    expect(rule).toContain(`Reference cloud prices, as of ${PRICE_REFERENCE.asOf}`);
    expect(rule).toContain("check them before committing");
    expect(rule).toContain("- Scaleway, Paris (fr-par-1): Instance POP2-2C-8G (2 dedicated vCPU, 8 GB RAM), 0.0735 EUR per hour");
    expect(rule).toContain("managed PostgreSQL:");
  });
});
