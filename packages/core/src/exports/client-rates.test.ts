import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "../branding.ts";
import { DEMO_LINEUP, providersFor } from "../config.ts";
import { clientDeliverable, clientProposal, renderClientReport } from "../deliverable.ts";
import { DEMO_IDEA, DEMO_SCRIPT } from "../demo.ts";
import { DebateEngine } from "../engine.ts";
import { mentionsRate, withoutRateSentences } from "../privacy.ts";
import { MockProvider } from "../providers/mock.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "../providers/types.ts";
import { createSession, currentProposals, type Session } from "../session.ts";
import { renderProposalDocx } from "./proposal-docx.ts";
import { renderProposalHtml } from "./proposal-html.ts";
import { readZip } from "./testing.ts";

// The day rates of an agency never reach its client: not through the costing, not through what the models wrote
// after reading them. A distinctive rate makes any leak easy to find.
const RATE = "777";

/** The demo, recording what the arbiter is asked. */
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

async function completed(arbiter: LlmProvider): Promise<{ session: Session; engine: DebateEngine }> {
  const providers = providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 });
  const engine = new DebateEngine(
    { ...providers, arbiter, devil: new MockProvider({ chunkDelayMs: 0 }) },
    { emit: () => {}, save: () => {} },
  );
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet!);
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  return { session, engine };
}

/** Writes rates where proposers and the arbiter put them: assumptions, work packages, the verdict's text. */
function leakRates(session: Session) {
  for (const proposal of Object.values(currentProposals(session))) {
    proposal.assumptions.push(`Senior developer at €${RATE}/day.`);
    proposal.estimate.assumptions.push(`Rates assumed: developer €${RATE}/day, project manager €${RATE} per day.`);
    proposal.estimate.exclusions.push(`Extra work billed at ${RATE} € par jour.`);
    proposal.summary += ` The team is priced at a blended rate of €${RATE}.`;
    const first = proposal.estimate.workPackages[0];
    if (first) first.description += ` Five days of the lead developer at €${RATE} a day.`;
  }
  const verdict = session.verdict!;
  verdict.recommendation.rationale += ` It assumes €${RATE}/day for the lead developer.`;
  for (const option of verdict.options) {
    option.reason += ` Its day rate of €${RATE} is high.`;
    option.conditions.push(`Negotiate the day rate of €${RATE}.`);
  }
  verdict.risks.push({ risk: `The €${RATE}/day rate may rise.`, likelihood: "low", impact: "low", mitigation: "Fix the rates." });
  session.briefs.client = {
    ...DEMO_SCRIPT.briefs.client,
    sections: [...DEMO_SCRIPT.briefs.client.sections, { title: "Price", body: `The build costs €18,000. Each day is billed €${RATE}.` }],
  };
}

describe("day rates and the client", () => {
  it("tell a rate from the other figures of a text", () => {
    for (const text of [
      "€650/day",
      "650 €/jour",
      "$90 per hour",
      "TJM de 600 €",
      "Tagessatz von 800 €",
      "日単価8万円",
      "每人日 ¥3000",
      "Each day is billed €700",
      "Chaque jour est facturé 700 €",
    ]) {
      expect(mentionsRate(text), text).toBe(true);
    }
    for (const text of [
      "€400 per month",
      "€0.25 per transaction for 200 bookings per day",
      "30 person-days",
      "€18,000",
      "€0.04 per SMS",
      "10,000 bookings per day, each at €0.25",
      "200 bookings a day cost €40 in fees",
    ]) {
      expect(mentionsRate(text), text).toBe(false);
    }
    expect(withoutRateSentences("It costs €18,000. It assumes €650/day for a developer. Fees are €0.25 each.")).toBe(
      "It costs €18,000. Fees are €0.25 each.",
    );
  });

  it("never reach the client deliverable, its report or the proposal, whatever the models wrote", async () => {
    const { session } = await completed(new Recorder());
    leakRates(session);
    const deliverable = clientDeliverable(session);
    const proposal = clientProposal(session, { client: "Studio Lumen" });
    const outputs = {
      deliverable: JSON.stringify(deliverable),
      report: renderClientReport(deliverable),
      proposal: JSON.stringify(proposal),
      html: renderProposalHtml(proposal, DEFAULT_BRANDING, { print: false }),
      docx: readZip(await renderProposalDocx(proposal, DEFAULT_BRANDING), "word/document.xml"),
    };
    for (const [name, text] of Object.entries(outputs)) {
      expect(text, name).not.toContain(RATE);
      expect(text, name).not.toMatch(/dailyRate|dayRates/);
    }
    // What does not state a rate is kept.
    expect(deliverable.brief?.sections.at(-1)?.body).toBe("The build costs €18,000.");
    expect(deliverable.recommendation?.rationale).toBe(DEMO_SCRIPT.verdict.recommendation.rationale);
    expect(deliverable.options[0]?.costing?.total.high).toBeGreaterThan(0);
  });

  it("are not shown to the model that writes the client's brief, nor kept in what it wrote", async () => {
    const arbiter = new Recorder();
    const { session, engine } = await completed(arbiter);
    leakRates(session);
    await engine.writeBrief(session, "client");
    const request = arbiter.requests.at(-1)!;
    expect(request.task).toBe("brief");
    const prompt = request.messages.map((message) => message.content).join("\n");
    expect(prompt).not.toContain(RATE);
    expect(prompt).not.toMatch(/"dailyRate"/);
    expect(request.system).toContain("Never state a day rate");

    // A CTO of the agency reads them.
    await engine.writeBrief(session, "cto");
    expect(
      arbiter.requests
        .at(-1)
        ?.messages.map((message) => message.content)
        .join("\n"),
    ).toContain(RATE);
  });
});
