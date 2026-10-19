import type { ContextDocument, Session } from "@quorumind/core";
import { describe, expect, it } from "vitest";
import { costRecorded, misquotes, type RawCall, rawAuditQuotes, rawMarketRanges, validRange } from "./checks.ts";

// The bench's own checks must be able to fail: they read what the models answered, before the engine cleaned it.

const document: ContextDocument = {
  id: "doc",
  kind: "text",
  name: "Quote",
  text: "Hosting is billed separately. The warranty lasts one month.",
};

const call = (schemaName: string, answer: unknown): RawCall => ({ task: "critique", schemaName, seat: "A", text: JSON.stringify(answer) });

describe("bench checks", () => {
  it("find the quotes of the critics and of the arbiter as they wrote them, and those not in the document", () => {
    const calls = [
      call("audit_findings", { findings: [{ quote: "The warranty lasts one month." }, { quote: "" }] }),
      call("audit_verdict", { audit: { findings: [{ quote: "Hosting is included." }], price: { market: null } } }),
      call("proposal", { findings: [{ quote: "not an audit answer" }] }),
      { task: "critique", schemaName: "audit_findings", seat: "B", text: "{not json" } satisfies RawCall,
    ];
    const quotes = rawAuditQuotes(calls);
    expect(quotes).toEqual(["The warranty lasts one month.", "Hosting is included."]);
    expect(misquotes([document], quotes)).toEqual(["Hosting is included."]);
  });

  it("read the market range as the arbiter gave it, and reject one out of order or without its basis", () => {
    const calls = [
      call("audit_verdict_compliance", { audit: { price: { market: { low: 40_000, high: 20_000, basis: "Similar projects" } } } }),
    ];
    const [range = null] = rawMarketRanges(calls);
    expect(validRange(range)).toBe(false);
    expect(validRange({ low: 20_000, high: 40_000, basis: "Similar projects" })).toBe(true);
    expect(validRange({ low: 20_000, high: 40_000, basis: " " })).toBe(false);
    expect(validRange(null)).toBe(true);
  });

  it("fail when a call has no known cost", () => {
    const record = { id: "1", task: "proposal" as const, seat: "A", model: "unpriced", inputTokens: 10, outputTokens: 10 };
    expect(costRecorded({ usage: [{ ...record, costUsd: 0.01 }] } as Pick<Session, "usage">).passed).toBe(true);
    expect(costRecorded({ usage: [{ ...record, costUsd: null }] } as Pick<Session, "usage">)).toMatchObject({
      passed: false,
      detail: "no known cost: unpriced",
    });
    expect(costRecorded({ usage: [] } as Pick<Session, "usage">).passed).toBe(false);
  });
});
