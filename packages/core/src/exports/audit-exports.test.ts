import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditDeliverable } from "../audit-report.ts";
import { DEFAULT_BRANDING } from "../branding.ts";
import { DEMO_LINEUP, providersFor } from "../config.ts";
import { clientDeliverable, renderClientReport } from "../deliverable.ts";
import { DebateEngine } from "../engine.ts";
import { LOCALES, type Locale } from "../locales.ts";
import { renderReport } from "../report.ts";
import { createSession, type Session } from "../session.ts";
import { renderDocx } from "./docx.ts";
import { renderHtml } from "./html.ts";
import { readZip } from "./testing.ts";

const mock = { provider: "mock" as const, model: "mock" };
const QUOTE = readFileSync(join(import.meta.dirname, "../../../../bench/fixtures/web-agency-quote.md"), "utf8");

async function audited(locale: Locale = "en", alternative = false): Promise<Session> {
  const lineup = { ...DEMO_LINEUP, devil: { ...mock, persona: null } };
  const engine = new DebateEngine(providersFor(lineup, {}, { mockDelayMs: 0 }), { emit: () => {}, save: () => {} });
  const session = createSession({
    locale,
    idea: "Is this quote for our booking website sound?",
    demo: true,
    mode: "audit",
    ...lineup,
    context: [{ id: "q", kind: "file", name: "quote.pdf", text: QUOTE }],
    audit: { alternative },
  });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet as NonNullable<Session["sheet"]>);
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Maintain it?", answer: "The agency." }]);
    await engine.runDebate(session);
  }
  return session;
}

describe("audit exports", () => {
  it("write the audit report in Markdown: opinion, quoted findings, recomputed figures, questions", async () => {
    const report = renderReport(await audited());
    expect(report).toContain("_Audit report · ");
    expect(report).toContain("## Overall opinion: Not sound as it stands");
    expect(report).toContain("### Blocking");
    expect(report).toContain("   > Total: 38,000 € excl. VAT");
    expect(report).toContain("_The document says nothing about it._");
    expect(report).toContain("| Payment and passes | 8 | €600 | €5,800 | €4,800 | **€1,000** |");
    expect(report).toContain("The stated total differs from the sum of the lines by €1,400.");
    expect(report).toContain("- Average day rate: €644");
    expect(report).toContain("**Market range (estimate)**: €22,000 – €40,000 (Within the estimated range).");
    expect(report).toContain("- Budget: Over your budget of €15,000 by €23,000");
    expect(report).toContain("## Questions to ask the provider");
    expect(report).toContain("| Ownership of the code and data | Missing |");
    expect(report).toContain("- **Ownership of the code and data**: Not stated");
    expect(report).toContain("## How this audit was produced");
    // The need ticks personal data: the document is assessed against those requirements.
    expect(report).toContain("## Compliance");
    expect(report).toMatch(/\| [^|]+ \| The document \|/);
    // A debate's sections have no place in an audit.
    expect(report).not.toContain("## Cost comparison");
  });

  it("compares the document with the alternative, when there is one", async () => {
    const report = renderReport(await audited("en", true));
    expect(report).toContain("## An alternative, for comparison");
    expect(report).toMatch(/\| Build cost \| €38,000 \| €[\d,]+ – €[\d,]+ \(estimate\) \|/);
  });

  it("follow the language of the session", async () => {
    const report = renderReport(await audited("fr"));
    expect(report).toContain("_Rapport d'audit · ");
    expect(report).toContain("## Avis général : Pas solide en l'état");
    expect(report).toContain("## Questions à poser au prestataire");
  });

  it("print the audit as a page, every text escaped", async () => {
    const session = await audited();
    if (session.audit?.extraction) session.audit.extraction.title = "<script>alert(1)</script>";
    const html = renderHtml(session, DEFAULT_BRANDING, { print: true });
    expect(html).toContain("<title>Audit report: ");
    expect(html).toContain('<article class="finding blocking">');
    expect(html).toContain("<blockquote>Total: 38,000 € excl. VAT</blockquote>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("window.print()");
    expect(renderHtml(session, DEFAULT_BRANDING, { print: false })).not.toContain("<script>");
  });

  it("write the audit as a Word document", async () => {
    const xml = readZip(await renderDocx(await audited(), DEFAULT_BRANDING), "word/document.xml");
    for (const text of [
      "Overall opinion",
      "Not sound as it stands",
      "Questions to ask the provider",
      "Total: 38,000 € excl. VAT",
      "Sum of the lines",
    ]) {
      expect(xml).toContain(text);
    }
  });

  it("share with a client the audit alone: no transcript, no interview, no document beyond its quotes", async () => {
    const session = await audited();
    const deliverable = clientDeliverable(session);
    expect(deliverable.audit?.opinion).toBe("not_sound");
    expect(deliverable.audit?.questions.length).toBeGreaterThan(3);
    const json = JSON.stringify(deliverable);
    expect(json).not.toContain("Lotus Yoga Network, 12 studios");
    expect(json).not.toContain(session.interview[0]?.kind === "interviewer" ? session.interview[0].data.speech : "-");
    const markdown = renderClientReport(deliverable);
    expect(markdown).toContain("## Questions to ask the provider");
    expect(markdown).not.toContain("## Your need");
  });

  it.each(LOCALES.map((locale) => locale.code))("render in %s without a missing label", async (locale) => {
    const session = await audited(locale, true);
    const report = renderReport(session);
    expect(report).not.toContain("undefined");
    expect(renderHtml(session, DEFAULT_BRANDING, { print: false })).not.toContain("undefined");
    expect(auditDeliverable(session)?.coverage).toHaveLength(10);
  });
});
