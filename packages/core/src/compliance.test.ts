import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "./branding.ts";
import {
  activeRequirements,
  COMPLIANCE_REQUIREMENTS,
  COMPLIANCE_TEMPLATE_IDS,
  COMPLIANCE_TEMPLATES,
  cleanTemplates,
  complianceInterviewRule,
  complianceRule,
  verdictCompliance,
  withTemplateFlags,
} from "./compliance.ts";
import { COMPLIANCE_LABELS, REQUIREMENT_IDS } from "./compliance-labels.ts";
import { complianceRows } from "./compliance-report.ts";
import { COMPLIANCE_VERDICT, settleCompliance, type VerdictWithCompliance } from "./compliance-verdict.ts";
import { DEMO_LINEUP } from "./config.ts";
import { DebateEngine } from "./engine.ts";
import { renderHtml } from "./exports/html.ts";
import { MockProvider } from "./providers/mock.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import type { Compliance } from "./schemas.ts";
import { createSession, type Session } from "./session.ts";

const NO_BOX: Compliance = { gdpr: false, healthData: false, paymentCards: false, accessibility: false, publicSector: false };

/** The demo models, recording every request they receive. */
class Recorder implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  readonly requests: GenerateRequest[] = [];
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    this.requests.push(request);
    return this.inner.generate(request, onDelta);
  }
}

async function debate(options: { complianceTemplates?: Session["complianceTemplates"]; boxes?: Partial<Compliance> } = {}) {
  const recorder = new Recorder();
  const engine = new DebateEngine(
    { interviewer: recorder, arbiter: recorder, proposers: { A: recorder, B: recorder }, devil: recorder },
    { emit: () => {}, save: () => {} },
  );
  const session = createSession({
    locale: "en",
    idea: "A booking app for yoga studios",
    demo: false,
    ...DEMO_LINEUP,
    complianceTemplates: options.complianceTemplates ?? [],
  });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  if (!session.sheet) throw new Error("no sheet");
  const sheet = options.boxes ? { ...session.sheet, compliance: { ...session.sheet.compliance, ...options.boxes } } : session.sheet;
  await engine.confirmSheet(session, sheet);
  await engine.runDebate(session);
  if (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  return { session, requests: recorder.requests };
}

describe("compliance templates", () => {
  it("states every requirement once, with a label in every language", () => {
    const ids = COMPLIANCE_REQUIREMENTS.map((requirement) => requirement.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...REQUIREMENT_IDS].sort());
    for (const id of COMPLIANCE_TEMPLATE_IDS) {
      expect(COMPLIANCE_REQUIREMENTS.some((requirement) => requirement.template === id && requirement.hard)).toBe(true);
      expect(COMPLIANCE_TEMPLATES[id].focus.length).toBeGreaterThan(3);
    }
    for (const [locale, labels] of Object.entries(COMPLIANCE_LABELS)) {
      for (const id of REQUIREMENT_IDS) expect(labels.requirements[id].trim(), `${locale}: ${id}`).not.toBe("");
      for (const id of COMPLIANCE_TEMPLATE_IDS) expect(labels.templates[id].trim(), `${locale}: ${id}`).not.toBe("");
      expect(labels.priceReference, locale).toContain("{date}");
    }
  });

  it("says to check whether a rule applies when it depends on the project", () => {
    for (const id of ["health_hds", "public_secnumcloud", "finance_dora", "finance_pci_dss", "gdpr_dpia", "consumer_accessibility"]) {
      expect(COMPLIANCE_REQUIREMENTS.find((requirement) => requirement.id === id)?.text).toMatch(/[Cc]heck whether/);
    }
  });

  it("follows French typography in the French labels", () => {
    const strings = (value: unknown): string[] =>
      typeof value === "string" ? [value] : Object.values(value as Record<string, unknown>).flatMap(strings);
    for (const value of strings(COMPLIANCE_LABELS.fr)) {
      expect(value).not.toMatch(/[^  ][:;?!»]/u);
      expect(value).not.toMatch(/«[^  ]/u);
    }
  });

  it("brings in the requirements of the chosen templates and of the boxes checked on the sheet", () => {
    const ids = (session: Parameters<typeof activeRequirements>[0]) => activeRequirements(session).map((requirement) => requirement.id);
    expect(ids({ complianceTemplates: [], sheet: null })).toEqual([]);
    expect(ids({ complianceTemplates: ["finance"], sheet: null })).toEqual([
      "finance_dora",
      "finance_dora_providers",
      "finance_pci_dss",
      "finance_aml_records",
    ]);
    // The payment card box brings PCI DSS alone, the health data box the whole health template.
    expect(ids({ complianceTemplates: [], sheet: { compliance: { ...NO_BOX, paymentCards: true } } })).toEqual(["finance_pci_dss"]);
    expect(ids({ complianceTemplates: [], sheet: { compliance: { ...NO_BOX, healthData: true } } })).toEqual(
      COMPLIANCE_REQUIREMENTS.filter((requirement) => requirement.template === "health_data").map((requirement) => requirement.id),
    );
    // Combined with the consumer template, requirements are not repeated.
    const both = ids({ complianceTemplates: ["consumer", "personal_data"], sheet: { compliance: { ...NO_BOX, gdpr: true } } });
    expect(new Set(both).size).toBe(both.length);
    expect(both).toContain("consumer_withdrawal");
    expect(both).toContain("gdpr_transfers");
  });

  it("checks the boxes of the sheet the templates stand for", () => {
    const sheet = { compliance: NO_BOX };
    expect(withTemplateFlags(sheet, [])).toBe(sheet);
    expect(withTemplateFlags(sheet, ["health_data"]).compliance).toEqual({ ...NO_BOX, healthData: true, gdpr: true });
    expect(withTemplateFlags(sheet, ["public_sector"]).compliance).toEqual({ ...NO_BOX, publicSector: true, accessibility: true });
    expect(cleanTemplates(["consumer", "nope", "health_data", "consumer"])).toEqual(["health_data", "consumer"]);
  });

  it("tells the interviewer what to cover, and every other role the requirements", () => {
    expect(complianceInterviewRule([])).toBe("");
    expect(complianceInterviewRule(["health_data"])).toContain("on whose behalf the data is hosted");
    const requirements = activeRequirements({ complianceTemplates: ["health_data"], sheet: null });
    expect(complianceRule([], "design")).toBe("");
    const arbiter = complianceRule(requirements, "arbiter");
    expect(arbiter).toContain("[health_hds] [hard] France, article L.1111-8 of the Public Health Code");
    expect(arbiter).toContain('"not_met" on a hard requirement is infeasible');
    expect(complianceRule(requirements, "critique")).toContain('"blocking"');
  });
});

describe("compliance in the debate", () => {
  it("passes the requirements to every role, and asks the arbiter for its assessment", async () => {
    const { session, requests } = await debate({ complianceTemplates: ["health_data"] });
    const interview = requests.find((request) => request.task === "interview");
    expect(interview?.system).toContain("Compliance: the person chose these compliance templates: health data.");
    // The template checks the boxes it stands for.
    expect(session.sheet?.compliance.healthData).toBe(true);
    for (const task of ["proposal", "critique", "revision", "verdict"] as const) {
      const request = requests.find((item) => item.task === task);
      expect(request?.system, task).toContain("[health_hds] [hard]");
    }
    const verdict = requests.find((request) => request.task === "verdict");
    expect(verdict?.schemaName).toBe(COMPLIANCE_VERDICT.name);
    expect(JSON.stringify(verdict?.schema)).toContain('"not_applicable"');
    // The demo's assessment covers personal data, which the health template brings in through its boxes.
    expect(verdictCompliance(session.verdict).length).toBeGreaterThan(0);
    expect(verdictCompliance(session.verdict).every((check) => check.requirement.startsWith("gdpr_"))).toBe(true);
  });

  it("keeps the usual verdict when no requirement applies", async () => {
    const { session, requests } = await debate({ boxes: { gdpr: false } });
    expect(requests.find((request) => request.task === "verdict")?.schemaName).toBe("verdict");
    expect(requests.find((request) => request.task === "proposal")?.system).not.toContain("Compliance requirements");
    expect(session.verdict && "compliance" in session.verdict).toBe(false);
    expect(renderReport(session)).not.toContain("## Compliance\n");
  });

  it("makes infeasible an option that fails a hard requirement, and does not recommend it", async () => {
    const { session } = await debate();
    const verdict = structuredClone(session.verdict) as VerdictWithCompliance;
    const requirements = activeRequirements(session);
    verdict.recommendation.seat = "A";
    verdict.compliance = [
      { requirement: "[gdpr_transfers]", seat: "A", status: "not_met", reason: "Member data goes to a US host without a transfer tool." },
      { requirement: "gdpr_transfers", seat: "A", status: "met", reason: "A repeat, dropped." },
      { requirement: "gdpr_rights", seat: "B", status: "not_met", reason: "Not a hard requirement." },
      { requirement: "unknown", seat: "A", status: "met", reason: "Dropped." },
      { requirement: "gdpr_retention", seat: "Z", status: "met", reason: "Dropped." },
    ];
    settleCompliance(verdict, requirements);
    expect(verdict.compliance.map((check) => `${check.requirement}/${check.seat}`)).toEqual(["gdpr_transfers/A", "gdpr_rights/B"]);
    const a = verdict.options.find((option) => option.seat === "A");
    expect(a?.feasibility).toBe("infeasible");
    expect(a?.reason).toContain("without a transfer tool");
    expect(verdict.options.find((option) => option.seat === "B")?.feasibility).not.toBe("infeasible");
    expect(verdict.recommendation.seat).toBeNull();
  });

  it("lists every requirement against every option in the report, in the session's language", async () => {
    const { session } = await debate();
    const rows = complianceRows(session);
    expect(rows?.seats).toEqual(["A", "B"]);
    expect(rows?.rows.map((row) => row.requirement.id)).toEqual(
      COMPLIANCE_REQUIREMENTS.filter((requirement) => requirement.flag === "gdpr").map((requirement) => requirement.id),
    );

    const report = renderReport(session);
    expect(report).toContain("## Compliance\n");
    expect(report).toContain("| Requirement | Option A | Option B |");
    expect(report).toContain(
      "| Every provider that processes personal data signs a data processing agreement (GDPR, art. 28). _(hard constraint)_ | **Met**:",
    );
    expect(report).toContain("**Does not apply**: No sensitive data on a large scale");

    const french = renderReport({ ...session, locale: "fr" });
    expect(french).toContain("## Conformité\n");
    expect(french).toContain("**Respectée**");
    expect(french).toContain("_(non négociable)_");

    const html = renderHtml(session, DEFAULT_BRANDING, { print: false });
    expect(html).toContain('<section class="compliance"><h2>Compliance</h2>');
    expect(html).toContain('<span class="chip conditional">Partly met</span>');
  });

  it("shows an assessed requirement as not assessed for an option the arbiter skipped", async () => {
    const { session } = await debate();
    const verdict = session.verdict as VerdictWithCompliance;
    verdict.compliance = verdict.compliance.filter((check) => check.seat !== "B");
    expect(renderReport(session)).toContain("| **Not assessed** |");
  });
});
