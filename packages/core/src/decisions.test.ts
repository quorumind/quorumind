import { describe, expect, it } from "vitest";
import { compareRevisions } from "./compare.ts";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { DECISION_LABEL_KEYS, DECISION_LABELS } from "./decision-labels.ts";
import { changeText, comparisonDocument, decisionStatusText, renderComparison, renderRegisterCsv } from "./decision-report.ts";
import {
  approveDecision,
  DecisionError,
  decisionStatus,
  registerEntry,
  rejectDecision,
  reopenDecision,
  requestApproval,
  reviewDue,
  setDecisionDetails,
  supersedeDecision,
} from "./decisions.ts";
import { DEMO_IDEA } from "./demo.ts";
import { DebateEngine } from "./engine.ts";
import { renderComparisonHtml } from "./exports/comparison-html.ts";
import { renderHtml } from "./exports/html.ts";
import type { Locale } from "./locales.ts";
import { MockProvider } from "./providers/mock.ts";
import { renderAdr, renderReport } from "./report.ts";
import { adoptScenario, type RevisionScenario } from "./scenarios.ts";
import { createSession, type Session } from "./session.ts";

const engine = () =>
  new DebateEngine(
    { ...providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 }), devil: new MockProvider({ chunkDelayMs: 0 }) },
    { emit: () => {}, save: () => {} },
  );

async function completed(locale: Locale = "en"): Promise<Session> {
  const run = engine();
  const session = createSession({ locale, idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
  await run.startInterview(session);
  await run.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await run.confirmSheet(session, session.sheet!);
  await run.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await run.answerDebate(session, [{ question: "Hosted?", answer: "Yes" }]);
    await run.runDebate(session);
  }
  return session;
}

const cut: RevisionScenario = {
  title: "Budget cut",
  question: null,
  changes: [
    { kind: "team", delta: 2 },
    { kind: "budget", target: "build", percent: -30 },
  ],
};

async function withScenario(locale: Locale = "en"): Promise<Session> {
  const session = await completed(locale);
  const run = engine();
  await run.beginRevision(session, {
    reason: "scenario",
    inputs: { facts: [], note: null, questionnaireId: null },
    by: null,
    scenario: cut,
  });
  await run.runRevision(session);
  return session;
}

const ada = { id: "ada", name: "Ada Lovelace" };
const bob = { id: "bob", name: "Bob" };
const AT = "2026-10-19T09:00:00.000Z";

describe("the decision register", () => {
  it("records who asked, who approved which version, and goes back to proposed on a new one", async () => {
    const session = await completed();
    expect(decisionStatus(session)).toBe("proposed");
    expect(registerEntry(session)).toMatchObject({
      status: "proposed",
      approval: null,
      recommendation: { seat: "A" },
      revision: { number: 1 },
    });

    requestApproval(session, bob, "Ready for the steering committee", AT);
    expect(registerEntry(session)?.request).toMatchObject({ name: "Bob", comment: "Ready for the steering committee" });
    approveDecision(session, ada, "Go", AT);
    expect(decisionStatus(session)).toBe("approved");
    expect(session.decision?.request).toBeNull();
    expect(registerEntry(session)?.approval).toEqual({ name: "Ada Lovelace", by: "ada", at: AT, comment: "Go", revision: 1 });
    expect(() => approveDecision(session, ada, null, AT)).toThrow(DecisionError);
    expect(() => requestApproval(session, bob, null, AT)).toThrow(DecisionError);

    // A new revision is not what was approved.
    const run = engine();
    await run.beginRevision(session, {
      reason: "edit",
      inputs: { facts: [], note: "Launch in October.", questionnaireId: null },
      by: null,
    });
    await run.runRevision(session);
    expect(decisionStatus(session)).toBe("proposed");
    expect(registerEntry(session)).toMatchObject({
      approval: null,
      previousApproval: { name: "Ada Lovelace", revision: 1 },
      revision: { number: 2 },
    });
    approveDecision(session, ada, null, AT);
    expect(registerEntry(session)?.approval?.revision).toBe(2);

    rejectDecision(session, bob, "Too risky", AT);
    expect(decisionStatus(session)).toBe("rejected");
    expect(() => rejectDecision(session, bob, null, AT)).toThrow(DecisionError);
    expect(() => approveDecision(session, ada, null, AT)).toThrow(DecisionError);
    reopenDecision(session, ada, null, AT);
    expect(decisionStatus(session)).toBe("proposed");
    expect(() => reopenDecision(session, ada, null, AT)).toThrow(DecisionError);

    expect(() => supersedeDecision(session, ada, { id: session.id, title: null }, null, AT)).toThrow(DecisionError);
    supersedeDecision(session, ada, { id: "next", title: "Studio booking app, phase 2" }, null, AT);
    expect(registerEntry(session)).toMatchObject({ status: "superseded", supersededBy: "next" });
    expect(session.decision?.history.map((event) => event.kind)).toEqual([
      "requested",
      "approved",
      "approved",
      "rejected",
      "reopened",
      "superseded",
    ]);
    expect(session.decision?.history[2]?.revision).toBe(2);
  });

  it("approve the adopted scenario, and remind of the review once its date has come", async () => {
    const session = await withScenario();
    adoptScenario(session, 2);
    approveDecision(session, ada, null, AT);
    expect(registerEntry(session)).toMatchObject({
      status: "approved",
      revision: { number: 2, reason: "scenario", scenario: "Budget cut" },
    });
    adoptScenario(session, null);
    expect(decisionStatus(session)).toBe("proposed");

    setDecisionDetails(session, { note: "Revisit after the pilot.", review: { on: "2026-11-02", when: "the SMS price doubles" } });
    expect(reviewDue(session, "2026-11-01")).toBe(false);
    expect(reviewDue(session, "2026-11-02")).toBe(true);
    session.decision!.review.remindedFor = "2026-11-02";
    expect(reviewDue(session, "2026-11-30")).toBe(false);
    // The same date keeps its reminder; a new one gets its own.
    setDecisionDetails(session, { review: { on: "2026-11-02", when: null } });
    expect(session.decision?.review.remindedFor).toBe("2026-11-02");
    setDecisionDetails(session, { review: { on: "2026-12-01", when: null } });
    expect(reviewDue(session, "2026-12-01")).toBe(true);
    rejectDecision(session, ada, null, AT);
    expect(reviewDue(session, "2026-12-01")).toBe(false);
    expect(() => setDecisionDetails(createSession({ locale: "en", idea: "x", demo: true, ...DEMO_LINEUP }), { note: "x" })).toThrow(
      DecisionError,
    );
  });

  it("states the approval in the report and the ADR", async () => {
    const session = await completed();
    expect(renderAdr(session)).toContain("- **Status:** Proposed");
    expect(renderReport(session)).not.toContain("## Decision\n");
    approveDecision(session, ada, "Within budget", AT);
    setDecisionDetails(session, { note: "Pilot with two studios first.", review: { on: "2027-03-01", when: null } });
    expect(decisionStatusText(session)).toBe("Accepted, approved by Ada Lovelace on October 19, 2026");
    const adr = renderAdr(session);
    expect(adr).toContain("- **Status:** Accepted, approved by Ada Lovelace on October 19, 2026");
    expect(adr).toContain("- Comment: Within budget");
    expect(adr).toContain("- Revisit on March 1, 2027");
    const report = renderReport(session);
    expect(report).toContain("## Decision\n\n- Status: Accepted, approved by Ada Lovelace on October 19, 2026");
    expect(report).toContain("- Note: Pilot with two studios first.");
    expect(renderHtml(session, { name: null, logoDataUrl: null, accent: null }, { print: false })).toContain(
      "Accepted, approved by Ada Lovelace on October 19, 2026",
    );

    supersedeDecision(session, ada, { id: "next", title: "Phase 2" }, null, AT);
    expect(renderAdr(session)).toContain("- **Status:** Superseded, superseded by “Phase 2”");
    const french = await completed("fr");
    approveDecision(french, { id: null, name: "Ada" }, null, AT);
    expect(renderAdr(french)).toContain("- **Statut:** Accepté, approuvé par Ada le 19 octobre 2026");
    const japanese = await completed("ja");
    approveDecision(japanese, { id: null, name: null }, null, AT);
    expect(decisionStatusText(japanese)).toBe("承認済み（2026年10月19日に承認）");
  });

  it("exports as CSV with a link to each session", async () => {
    const session = await completed();
    approveDecision(session, ada, "Go", AT);
    const entry = { ...registerEntry(session)!, author: "Ada Lovelace" };
    const csv = renderRegisterCsv([entry], "en", (id) => `https://app.example/#/s/${id}`);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(
      '"Decision","Recommendation","Status","Version","Approved by","Approval date","Comment","Note","Review date","Review condition","Verdict date","Author","Superseded by","Link"',
    );
    expect(row).toContain('"Accepted","Revision 1","Ada Lovelace","2026-10-19","Go"');
    expect(row).toContain(`"https://app.example/#/s/${session.id}"`);
    expect(renderRegisterCsv([], "fr", () => "").split(",")[0]).toBe('"Décision"');
  });
});

describe("comparing two versions", () => {
  it("flag what differs: requirements, feasibility, scores, costs and checks, risks", async () => {
    const session = await withScenario();
    const comparison = compareRevisions(session, 1, 2)!;
    expect(comparison.left.number).toBe(1);
    expect(comparison.right).toMatchObject({ number: 2, reason: "scenario", scenario: cut, current: false });
    expect(comparison.left.current).toBe(true);
    expect(comparison.seats).toEqual(["A", "B"]);
    expect(comparison.diff.recommendation).toBe(false);
    expect(comparison.diff.requirements).toMatchObject({ build: true, run: false, deadline: false, team: true });
    expect(comparison.left.requirements.build?.amount).toBe(15_000);
    expect(comparison.right.requirements.build?.amount).toBe(10_500);
    expect(comparison.diff.options.A).toMatchObject({
      feasibility: false,
      weighted: true,
      scores: ["Time to market"],
      weeks: true,
      build: false,
    });
    expect(comparison.diff.options.A?.checks).toBe(true);
    expect(comparison.diff.options.B).toMatchObject({ weeks: false, scores: [] });
    expect(comparison.diff.risks.changed.map((item) => item.risk)).toEqual(["Launch slips past September"]);
    expect(comparison.diff.count).toBeGreaterThanOrEqual(6);
    // The compliance assessment is compared too, requirement by requirement.
    expect(comparison.compliance).toContain("gdpr_processors");
    expect(comparison.diff.options.B?.compliance).toEqual([]);
    const scenario = session.revisions[1]!.verdict as (typeof session.revisions)[1]["verdict"] & {
      compliance: { requirement: string; seat: string; status: string }[];
    };
    scenario.compliance = scenario.compliance.map((check) =>
      check.requirement === "gdpr_processors" && check.seat === "B" ? { ...check, status: "met" } : check,
    );
    const assessed = compareRevisions(session, 1, 2)!;
    expect(assessed.diff.options.B?.compliance).toEqual(["gdpr_processors"]);
    expect(assessed.diff.count).toBe(comparison.diff.count + 1);
    expect(renderComparison(session, 1, 2)).toMatch(/\| [^|]*data processing agreement[^|]* \| \*\*Partly met\*\* \| \*\*Met\*\* \|/);
    expect(compareRevisions(session, 1, 9)).toBeNull();
    expect(compareRevisions(session, 1, 1)?.diff.count).toBe(0);
  });

  it("render the comparison in Markdown and HTML, the differences highlighted", async () => {
    const session = await withScenario();
    const markdown = renderComparison(session, 1, 2)!;
    expect(markdown).toContain("# Studio booking app: Comparison of two versions");
    expect(markdown).toContain("_Revision 1 and Scenario “Budget cut” · Revision 2, side by side_");
    expect(markdown).toContain("| Build budget | **€15,000** | **€10,500** |");
    expect(markdown).toContain("| Running budget | €400 a month | €400 a month |");
    expect(markdown).toContain("Team size +2<br>Build budget -30%");
    expect(markdown).toContain("| Time to market | **3** | **4** |");
    expect(renderComparison(session, 1, 1)).toContain("The two versions agree on every point compared.");
    expect(renderComparison(session, 1, 7)).toBeNull();

    const html = renderComparisonHtml(session, 1, 2, { name: null, logoDataUrl: null, accent: null }, { print: true })!;
    expect(html).toContain(
      '<td class="differs"><span aria-hidden="true">≠ </span>€10,500<span class="visually-hidden"> (differs)</span></td>',
    );
    expect(html).toContain("window.print()");
    const arabic = await withScenario("ar");
    expect(renderComparisonHtml(arabic, 1, 2, { name: null, logoDataUrl: null, accent: null }, { print: false })).toContain('dir="rtl"');
    expect(comparisonDocument(arabic, 1, 2)?.columns[1]).toContain("«Budget cut»");
  });

  it("name the changes of a scenario in every language", () => {
    expect(changeText({ kind: "budget", target: "build", percent: -30 }, "fr")).toBe("Budget de réalisation -30\u00a0%");
    expect(changeText({ kind: "deadline", delta: -2, unit: "month" }, "en")).toBe("Deadline -2 month(s)");
    expect(changeText({ kind: "team", delta: 2 }, "ar")).toBe("حجم الفريق \u200e+2");
    expect(changeText({ kind: "constraint", text: "On-premises" }, "de")).toBe("Neue harte Vorgabe: On-premises");
  });
});

describe("decision labels", () => {
  it.each(Object.keys(DECISION_LABELS))("%s has every label, with the English placeholders", (locale) => {
    const labels = DECISION_LABELS[locale as keyof typeof DECISION_LABELS];
    expect(Object.keys(labels).sort()).toEqual([...DECISION_LABEL_KEYS].sort());
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of DECISION_LABEL_KEYS) {
      expect(labels[key].trim(), `${locale}: ${key}`).not.toBe("");
      expect(placeholders(labels[key]), `${locale}: ${key}`).toEqual(placeholders(DECISION_LABELS.en[key]));
    }
  });

  it("follow French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [key, value] of Object.entries(DECISION_LABELS.fr)) {
      expect(value, key).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, key).not.toMatch(/«[^  ]/u);
    }
  });
});
