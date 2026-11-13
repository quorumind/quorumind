/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSession, DEMO_LINEUP, DebateEngine, providersFor, type Session } from "@quorumind/core";
import { auditDeliverable } from "@quorumind/core/audit-report";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { AuditView } from "./Audit.tsx";

const QUOTE = readFileSync(join(import.meta.dirname, "../../../bench/fixtures/web-agency-quote.md"), "utf8");

let audited: Session;
beforeAll(async () => {
  const lineup = { ...DEMO_LINEUP, devil: { provider: "mock" as const, model: "mock", persona: null } };
  const engine = new DebateEngine(providersFor(lineup, {}, { mockDelayMs: 0 }), { emit: () => {}, save: () => {} });
  audited = createSession({
    locale: "en",
    idea: "Is this quote for our booking website sound?",
    demo: true,
    mode: "audit",
    ...lineup,
    context: [{ id: "q", kind: "file", name: "quote.md", text: QUOTE }],
    audit: { alternative: false },
  });
  await engine.startInterview(audited);
  await engine.answerInterview(audited, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(audited, audited.sheet as NonNullable<Session["sheet"]>);
  await engine.runDebate(audited);
  while (audited.phase === "awaiting_answers") {
    await engine.answerDebate(audited, [{ question: "Maintain it?", answer: "The agency." }]);
    await engine.runDebate(audited);
  }
});

describe("the findings of an audit", () => {
  it("say the document says nothing only where the arbiter quoted nothing", () => {
    const audit = auditDeliverable(audited);
    if (!audit) throw new Error("No audit.");
    // Every quote dropped, as when Quorumind cannot find the passages in the document: the document may say something.
    const findings = audit.findings.map((finding) => ({ ...finding, quote: "", quoteDropped: Boolean(finding.quote) }));
    const view = render(<AuditView audit={{ ...audit, findings }} />);
    const said = view.container.textContent?.split("The document says nothing about it.").length ?? 1;
    expect(said - 1).toBe(audit.findings.filter((finding) => !finding.quote).length);
    expect(said - 1).toBeLessThan(findings.length);
  });
});
