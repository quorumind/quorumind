import { describe, expect, it } from "vitest";
import { AGENCY_LABELS } from "../agency-labels.ts";
import { DEFAULT_BRANDING } from "../branding.ts";
import { clientDeliverable, renderClientReport } from "../deliverable.ts";
import { LOCALES } from "../locales.ts";
import { renderReport } from "../report.ts";
import { LABELS } from "../report-labels.ts";
import { formatDate } from "../revision-report.ts";
import { revisionChanges, unchanged } from "../revisions.ts";
import { renderDocx } from "./docx.ts";
import { renderHtml } from "./html.ts";
import { readZip, revisedDemo as revised, styled } from "./testing.ts";

describe("reports of a revised verdict", () => {
  it("say which revision they show and what changed since the previous one", async () => {
    const session = await revised();
    const report = renderReport(session);
    expect(report).toMatch(/^_Decision report · \d{4}-\d{2}-\d{2} · Revision 2 · /m);
    expect(report).toContain("## What changed since revision 1");
    expect(report).toContain("_Revision 2 · ");
    expect(report).toContain("· Updated with the client's answers_");
    expect(report).toContain("### Scores\n\n- Option A · Weighted score: ");
    expect(report).toContain("- Option A · Ease of maintenance: 3 → 4");
    expect(report).toContain("### New risks\n\n- SMS volume grows faster than the members (Likelihood: Low, Impact: Medium)");
    expect(report).toContain("- Option A · Monthly cost: €120 – €260 → €140 – €220");
    expect(report).toContain("### Questions answered\n\n- Which SMS provider meets the cost assumption?");
    expect(report).toContain("### New facts taken into account\n\n- Which SMS provider meets the cost assumption?: Brevo at €0.04");

    const html = renderHtml(session, DEFAULT_BRANDING, { print: false });
    expect(html).toContain('<section class="changes"><h2>What changed since revision 1</h2>');
    expect(html).toContain("Option A · Ease of maintenance: 3 → 4");

    const xml = readZip(await renderDocx(session, DEFAULT_BRANDING), "word/document.xml");
    expect(styled(xml, "Heading1")).toContain("What changed since revision 1");
    expect(styled(xml, "Heading3")).toEqual(expect.arrayContaining(["Scores", "New risks", "Cost estimates", "Questions answered"]));
    expect(xml).toContain("Revision 2 · ");
  });

  it("show the debate's own verdict as revision 1, with nothing changed to list", async () => {
    const session = await revised();
    session.revisions = session.revisions.slice(0, 1);
    session.verdict = session.revisions[0]!.verdict;
    const report = renderReport(session);
    expect(report).toContain(" · Revision 1 · ");
    expect(report).not.toContain("What changed");
  });

  it("say so when the new facts changed nothing", async () => {
    const session = await revised();
    session.revisions[1]!.verdict = session.revisions[0]!.verdict;
    session.revisions[1]!.costs = [];
    session.verdict = session.revisions[0]!.verdict;
    expect(renderReport(session)).toContain("## What changed since revision 1\n\n_Revision 2 · ");
    expect(renderReport(session)).toContain("The new facts changed neither the recommendation, the scores, the risks nor the costs.");
  });

  it("list a build time the new facts changed, even when nothing else moved", async () => {
    const session = await revised();
    session.revisions[1]!.verdict = session.revisions[0]!.verdict;
    session.revisions[1]!.costs = [];
    session.revisions[1]!.schedules = [{ seat: "A", buildWeeks: { low: 30, high: 40 } }];
    session.verdict = session.revisions[0]!.verdict;
    const changes = revisionChanges(session, 2)!;
    expect(unchanged(changes)).toBe(false);
    expect(changes.schedules).toEqual([
      { seat: "A", from: expect.objectContaining({ low: expect.any(Number) }), to: { low: 30, high: 40 } },
    ]);
    const report = renderReport(session);
    expect(report).not.toContain("The new facts changed neither");
    expect(report).toMatch(/- Option A · Build time: .* → 30 to 40 weeks/);
  });

  it("date in UTC whatever the server's time zone, and in the document's language", async () => {
    const zone = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      expect(formatDate("2026-10-19T23:30:00.000Z", "en")).toBe("October 19, 2026");
      const session = await revised("fr");
      session.updatedAt = "2026-10-19T23:30:00.000Z";
      const report = renderClientReport(clientDeliverable(session));
      expect(report).toContain("19 octobre 2026");
      expect(report).not.toContain("2026-10-19");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("give the client deliverable its revision", async () => {
    const session = await revised("fr");
    const deliverable = clientDeliverable(session);
    expect(deliverable.revision?.number).toBe(2);
    expect(renderClientReport(deliverable)).toMatch(/· Révision 2 · /);
  });
});

describe("agency labels", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  it.each(LOCALES.map((locale) => locale.code))("%s has every label, with the English placeholders", (code) => {
    const english = AGENCY_LABELS.en;
    const labels = AGENCY_LABELS[code];
    expect(Object.keys(labels).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(english)) {
      const translated = labels[key as keyof typeof labels];
      expect(translated.trim(), `${code}: ${key}`).not.toBe("");
      expect(placeholders(translated), `${code}: ${key}`).toEqual(placeholders(value));
    }
  });

  it("follow French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [key, value] of Object.entries(AGENCY_LABELS.fr)) {
      expect(value, key).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, key).not.toMatch(/«[^  ]/u);
    }
  });

  it.each(LOCALES.map((locale) => locale.code))("%s report labels keep the English placeholders", (code) => {
    for (const [key, value] of Object.entries(LABELS.en)) {
      expect(placeholders(LABELS[code][key as keyof typeof LABELS.en]), `${code}: ${key}`).toEqual(placeholders(value));
    }
  });
});
