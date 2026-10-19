import { describe, expect, it } from "vitest";
import { verdictCompliance } from "./compliance.ts";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { deliveryChecks } from "./costing.ts";
import { DEMO_IDEA, DEMO_SHEET } from "./demo.ts";
import { DebateEngine, type ProviderSet, type RevisionRequest } from "./engine.ts";
import { MockProvider } from "./providers/mock.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "./providers/types.ts";
import { adoptScenario, applyScenario, changeFact, type RevisionScenario, scenarioFacts, scenariosOf, shiftDate } from "./scenarios.ts";
import {
  createSession,
  currentProposals,
  currentRevision,
  currentView,
  revisionLineage,
  revisionSheet,
  type Session,
  sessionAtRevision,
} from "./session.ts";

/** Answers like the demo, and keeps every request it was sent. */
class Recording implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  readonly requests: GenerateRequest[] = [];
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    return this.inner.generate(request);
  }
}

const demoProviders = () => providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 });
const engineWith = (providers: ProviderSet = demoProviders()) =>
  new DebateEngine({ devil: new MockProvider({ chunkDelayMs: 0 }), ...providers }, { emit: () => {}, save: () => {} });

async function completed(): Promise<Session> {
  const engine = engineWith();
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet!);
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  return session;
}

const leaner: RevisionScenario = {
  title: "Leaner and on-premises",
  question: "What if the client hosts it in their own data centre?",
  changes: [
    { kind: "team", delta: 2 },
    { kind: "budget", target: "build", percent: -30 },
    { kind: "deadline", delta: -2, unit: "month" },
    { kind: "constraint", text: "Must run on-premises" },
  ],
};

const scenario = (value: RevisionScenario, basedOn?: number): RevisionRequest => ({
  reason: "scenario",
  inputs: { facts: [], note: value.question, questionnaireId: null },
  by: "ada",
  scenario: value,
  ...(basedOn === undefined ? {} : { basedOn }),
});

const edit: RevisionRequest = {
  reason: "edit",
  inputs: {
    facts: [{ question: "Which SMS provider meets the cost assumption?", answer: "Brevo", comment: null }],
    note: null,
    questionnaireId: null,
  },
  by: null,
};

describe("scenario changes", () => {
  it("move the team, the budgets and the deadline, and add the constraints", () => {
    const { sheet, applied } = applyScenario(DEMO_SHEET, leaner.changes);
    expect(sheet.team.people).toBe(4);
    expect(sheet.budget.build?.amount).toBe(10_500);
    expect(sheet.budget.run?.amount).toBe(400);
    expect(sheet.deadline.duration).toEqual({ amount: 3, unit: "month" });
    expect(sheet.hardConstraints).toContain("Must run on-premises");
    expect(DEMO_SHEET.team.people).toBe(2);
    expect(applied.every((item) => item.applied)).toBe(true);
    expect(applied.map(changeFact)).toEqual([
      "The team grows by 2 people: from 2 people to 4 people.",
      "The build budget is 30% lower: from 15,000 EUR to 10,500 EUR.",
      "The deadline is 2 months earlier: from 5 months to 3 months.",
      "New hard constraint: Must run on-premises.",
    ]);
    expect(scenarioFacts(applied, " What if? ").at(-1)).toEqual({ question: "What if", answer: "What if?", comment: null });
  });

  it("leave for the arbiter what the sheet gives no value for", () => {
    const sheet = { ...DEMO_SHEET, team: { ...DEMO_SHEET.team, people: null }, budget: { ...DEMO_SHEET.budget, build: null } };
    const { sheet: next, applied } = applyScenario(sheet, [
      { kind: "team", delta: 3 },
      { kind: "budget", target: "build", percent: 20 },
    ]);
    expect(next.team.people).toBeNull();
    expect(next.budget.build).toBeNull();
    expect(applied.map((item) => item.applied)).toEqual([false, false]);
    expect(changeFact(applied[0]!)).toBe("The team grows by 3 people (the requirements give no value to apply it to).");
  });

  it("move a deadline date, or count a duration in weeks across units", () => {
    expect(shiftDate("2027-03-31", -1, "month")).toBe("2027-02-28");
    expect(shiftDate("2027-01-15", 2, "week")).toBe("2027-01-29");
    expect(shiftDate("soon", 1, "week")).toBeNull();
    const dated = { ...DEMO_SHEET, deadline: { date: "2027-06-30", duration: null, note: "" } };
    expect(applyScenario(dated, [{ kind: "deadline", delta: -2, unit: "month" }]).sheet.deadline.date).toBe("2027-04-30");
    const weeks = applyScenario(DEMO_SHEET, [{ kind: "deadline", delta: -3, unit: "week" }]).sheet.deadline.duration;
    expect(weeks).toEqual({ amount: 19, unit: "week" });
    // Nothing left: at least a week.
    expect(applyScenario(DEMO_SHEET, [{ kind: "deadline", delta: -9, unit: "month" }]).sheet.deadline.duration).toEqual({
      amount: 1,
      unit: "week",
    });
    // The same constraint twice is kept once; the running budget keeps its period.
    const twice = applyScenario(DEMO_SHEET, [
      { kind: "constraint", text: "Member data hosted in the EU (GDPR)" },
      { kind: "budget", target: "run", percent: 50 },
    ]).sheet;
    expect(twice.hardConstraints).toEqual(DEMO_SHEET.hardConstraints);
    expect(twice.budget.run).toEqual({ amount: 600, currency: "EUR", period: "month" });
  });
});

describe("scenarios", () => {
  it("rule on the same options with the changed facts, beside the current verdict", async () => {
    const session = await completed();
    const verdict = session.verdict;
    const arbiter = new Recording();
    const engine = engineWith({ ...demoProviders(), arbiter });
    const pending = await engine.beginRevision(session, scenario(leaner));
    expect(pending).toMatchObject({ number: 2, basedOn: 1, reason: "scenario", scenario: leaner });
    expect(await engine.runRevision(session)).toBe(true);

    const made = session.revisions[1]!;
    expect(made).toMatchObject({ number: 2, reason: "scenario", basedOn: 1, scenario: leaner, by: "ada" });
    expect(made.sheet?.budget.build?.amount).toBe(10_500);
    expect(made.schedules).toEqual([{ seat: "A", buildWeeks: { low: 9, high: 11 } }]);
    // The current verdict stays until the scenario is adopted.
    expect(session.verdict).toBe(verdict);
    expect(currentRevision(session)?.number).toBe(1);
    expect(scenariosOf(session).map((revision) => revision.number)).toEqual([2]);

    // The arbiter read the changed requirements and the checks computed with them, under the scenario's own name.
    const request = arbiter.requests.find((item) => item.task === "reassess")!;
    // The demo sheet checks personal data: the ruling assesses the compliance requirements again.
    expect(request.schemaName).toBe("scenario_update_compliance");
    expect(verdictCompliance(made.verdict).length).toBeGreaterThan(0);
    expect(request.system).toContain('asks "what if"');
    const prompt = request.messages[0]!.content;
    expect(prompt).toContain('"people": 4');
    expect(prompt).toContain("against a build budget of 10,500 EUR");
    expect(prompt).toContain("The build budget is 30% lower: from 15,000 EUR to 10,500 EUR.");
    expect(prompt).toContain("Must run on-premises");

    // Its checks are computed by code with its numbers; the current verdict's stay as they were.
    const view = sessionAtRevision(session, 2)!;
    expect(view.sheet?.team.people).toBe(4);
    expect(currentProposals(view).A?.buildWeeks).toEqual({ low: 9, high: 11 });
    const checks = deliveryChecks(view).A!;
    expect(checks.build).toMatchObject({ budget: 10_500, status: "over" });
    expect(checks.time).toMatchObject({ status: "within" });
    expect(deliveryChecks(session).A?.build?.budget).toBe(15_000);
    expect(currentProposals(session).A?.buildWeeks).toEqual({ low: 12, high: 14 });
  });

  it("branch from an earlier revision, with the costs of that line only", async () => {
    const session = await completed();
    const engine = engineWith();
    await engine.beginRevision(session, edit);
    await engine.runRevision(session);
    expect(currentProposals(session).A?.monthlyCost).toMatchObject({ low: 140, high: 220 });

    await engine.beginRevision(session, scenario({ title: "From the debate", question: "What if we wait?", changes: [] }, 1));
    await engine.runRevision(session);
    await engine.beginRevision(session, scenario({ title: "From the update", question: null, changes: [{ kind: "team", delta: 1 }] }));
    await engine.runRevision(session);
    expect(session.revisions.map((revision) => [revision.number, revision.reason, revision.basedOn])).toEqual([
      [1, "debate", null],
      [2, "edit", 1],
      [3, "scenario", 1],
      [4, "scenario", 2],
    ]);
    expect(revisionLineage(session, 3).map((revision) => revision.number)).toEqual([1, 3]);
    expect(currentProposals(sessionAtRevision(session, 3)!).A?.monthlyCost).toMatchObject({ low: 120, high: 260 });
    expect(currentProposals(sessionAtRevision(session, 4)!).A?.monthlyCost).toMatchObject({ low: 140, high: 220 });
    // A question alone changes no requirement.
    expect(session.revisions[2]?.sheet).toBeUndefined();
    expect(revisionSheet(session, 4)?.team.people).toBe(3);
    // Several scenarios coexist; the current revision is still the update.
    expect(currentRevision(session)?.number).toBe(2);
    await expect(engine.beginRevision(session, scenario(leaner, 9))).rejects.toMatchObject({ code: "no_such_revision" });
    await expect(engine.beginRevision(session, { ...scenario(leaner), scenario: undefined } as RevisionRequest)).rejects.toMatchObject({
      code: "wrong_phase",
    });
  });

  it("can be adopted as the decision, which a later revision builds on", async () => {
    const session = await completed();
    session.briefs.cto = { speech: "", headline: "", summary: "", sections: [], nextSteps: [] };
    const engine = engineWith();
    await engine.beginRevision(session, scenario(leaner));
    await engine.runRevision(session);
    expect(() => adoptScenario(session, 1)).toThrow(RangeError);

    adoptScenario(session, 2);
    expect(session.adopted).toBe(2);
    expect(session.verdict).toBe(session.revisions[1]!.verdict);
    expect(session.briefs).toEqual({});
    expect(currentRevision(session)?.number).toBe(2);
    expect(currentView(session).sheet?.budget.build?.amount).toBe(10_500);
    expect(sessionAtRevision(session, 2)?.briefs).toEqual({});

    // A revision of the decision starts from the adopted scenario, keeps its requirements, and becomes the current one.
    const pending = await engine.beginRevision(session, edit);
    expect(pending.basedOn).toBe(2);
    await engine.runRevision(session);
    expect(session.adopted).toBeNull();
    expect(currentRevision(session)?.number).toBe(3);
    expect(revisionSheet(session, 3)?.budget.build?.amount).toBe(10_500);
    expect(currentView(session).sheet?.hardConstraints).toContain("Must run on-premises");

    adoptScenario(session, 2);
    adoptScenario(session, null);
    expect(currentRevision(session)?.number).toBe(3);
    expect(session.verdict).toBe(session.revisions[2]!.verdict);
  });
});
