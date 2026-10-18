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
import { DEMO_LINEUP } from "./config.ts";
import { DebateEngine } from "./engine.ts";
import { MockProvider } from "./providers/mock.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import { createSession } from "./session.ts";

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

  it("reaches the prompts of the roles that design an option, and the report's method box", async () => {
    const requests: GenerateRequest[] = [];
    const inner = new MockProvider({ chunkDelayMs: 0 });
    const recorder: LlmProvider = {
      kind: "mock",
      model: "mock",
      generate: (request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> => {
        requests.push(request);
        return inner.generate(request, onDelta);
      },
    };
    const engine = new DebateEngine(
      { interviewer: recorder, arbiter: recorder, proposers: { A: recorder, B: recorder }, devil: recorder },
      { emit: () => {}, save: () => {} },
    );
    const session = createSession({ locale: "en", idea: "Booking app", demo: false, ...DEMO_LINEUP });
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    if (!session.sheet) throw new Error("no sheet");
    await engine.confirmSheet(session, session.sheet);
    await engine.runDebate(session);
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
    await engine.runDebate(session);

    const marker = `Reference cloud prices, as of ${PRICE_REFERENCE.asOf}`;
    expect(requests.find((request) => request.task === "proposal")?.system).toContain(marker);
    expect(requests.find((request) => request.task === "revision")?.system).toContain(marker);
    expect(requests.find((request) => request.task === "verdict")?.system).not.toContain(marker);
    expect(session.priceReference).toEqual({ asOf: PRICE_REFERENCE.asOf });
    expect(renderReport(session)).toContain(`The proposals relied on reference cloud prices as of ${PRICE_REFERENCE.asOf}`);
    // Sessions started before the reference prices say nothing of them.
    expect(renderReport({ ...session, priceReference: null })).not.toContain("reference cloud prices");
  });
});
