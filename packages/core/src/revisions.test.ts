import { describe, expect, it } from "vitest";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { DEMO_IDEA, DEMO_SCRIPT } from "./demo.ts";
import { DebateEngine, type ProviderSet, type RevisionRequest } from "./engine.ts";
import { setModelPrice } from "./pricing.ts";
import { MockProvider } from "./providers/mock.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError } from "./providers/types.ts";
import { revisionChanges, unchanged } from "./revisions.ts";
import {
  createSession,
  currentProposals,
  isWorking,
  markInterrupted,
  normalizeSession,
  type Session,
  sessionAtRevision,
} from "./session.ts";

const demoProviders = () => providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 });

function engineWith(providers: ProviderSet = demoProviders()) {
  return new DebateEngine({ devil: new MockProvider({ chunkDelayMs: 0 }), ...providers }, { emit: () => {}, save: () => {} });
}

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

const answers: RevisionRequest = {
  reason: "client_answers",
  inputs: {
    facts: [
      {
        question: "Which SMS provider meets the cost assumption?",
        answer: "Brevo, about €0.04 per SMS",
        comment: "Already under contract",
      },
    ],
    note: null,
    questionnaireId: "q1",
  },
  by: "agency-user",
};

/** A provider that answers like the demo but costs money, or fails on the arbiter's new ruling. */
class Priced implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model: string;
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  private readonly failOn: string | null;
  constructor(model: string, failOn: string | null = null) {
    this.model = model;
    this.failOn = failOn;
  }
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (request.task === this.failOn) throw new ProviderError("The provider is down.", false, { code: "provider_unavailable" });
    return { ...(await this.inner.generate(request)), model: this.model };
  }
}

describe("verdict revisions", () => {
  it("make the debate's verdict revision 1", async () => {
    const session = await completed();
    expect(session.revisions).toHaveLength(1);
    expect(session.revisions[0]).toMatchObject({ number: 1, reason: "debate", basedOn: null, by: null, costs: [], critiques: [] });
    expect(session.revisions[0]?.verdict).toBe(session.verdict);
  });

  it("re-run only a short critique and the arbiter, then keep the earlier verdict readable", async () => {
    const session = await completed();
    session.briefs.client = DEMO_SCRIPT.briefs.client;
    const before = session.usage.length;
    const engine = engineWith();
    const pending = await engine.beginRevision(session, answers);
    expect(pending).toMatchObject({ number: 2, basedOn: 1, reason: "client_answers", by: "agency-user", error: null });
    expect(isWorking(session)).toBe(true);

    expect(await engine.runRevision(session)).toBe(true);
    expect(session.phase).toBe("complete");
    expect(session.revising).toBeNull();
    expect(session.revisions.map((revision) => revision.number)).toEqual([1, 2]);
    const revision = session.revisions[1]!;
    expect(revision.inputs.facts[0]?.answer).toBe("Brevo, about €0.04 per SMS");
    expect(revision.critiques.map((critique) => critique.seat)).toEqual(["devil"]);
    expect(session.verdict).toBe(revision.verdict);
    expect(session.verdict?.openQuestions).toEqual([]);
    // The reader versions were written for the previous verdict.
    expect(session.briefs).toEqual({});

    const calls = session.usage.slice(before);
    expect(calls.map((record) => [record.task, record.revision])).toEqual([
      ["critique", 2],
      ["reassess", 2],
    ]);
    expect(currentProposals(session).A?.monthlyCost).toMatchObject({ low: 140, high: 220 });

    const first = sessionAtRevision(session, 1)!;
    expect(first.verdict?.openQuestions).toEqual(["Which SMS provider meets the cost assumption?"]);
    expect(currentProposals(first).A?.monthlyCost).toMatchObject({ low: 120, high: 260 });
    expect(sessionAtRevision(session, 2)).toBe(session);
    expect(sessionAtRevision(session, 3)).toBeNull();
  });

  it("list what changed since the previous revision", async () => {
    const session = await completed();
    const engine = engineWith();
    await engine.beginRevision(session, answers);
    await engine.runRevision(session);
    expect(revisionChanges(session, 1)).toBeNull();
    const changes = revisionChanges(session, 2)!;
    expect(changes.since).toBe(1);
    expect(changes.recommendation).toBeNull();
    expect(changes.scores).toEqual([{ seat: "A", criterion: "Ease of maintenance", from: 3, to: 4 }]);
    expect(changes.weighted.map((item) => item.seat)).toEqual(["A"]);
    expect(changes.risks.added.map((risk) => risk.risk)).toEqual(["SMS volume grows faster than the members"]);
    expect(changes.risks.removed).toEqual([]);
    expect(changes.costs).toEqual([
      { seat: "A", kind: "monthly", from: expect.objectContaining({ low: 120 }), to: expect.objectContaining({ low: 140, high: 220 }) },
    ]);
    expect(changes.questions.answered).toEqual(["Which SMS provider meets the cost assumption?"]);
    expect(unchanged(changes)).toBe(false);
  });

  it("notice a new recommendation and feasibility", async () => {
    const session = await completed();
    const original = session.verdict!;
    const engine = engineWith();
    await engine.beginRevision(session, { ...answers, reason: "edit" });
    await engine.runRevision(session);
    const latest = session.revisions[1]!.verdict;
    latest.recommendation = { ...latest.recommendation, seat: "B" };
    latest.options = latest.options.map((option) => (option.seat === "B" ? { ...option, feasibility: "feasible" as const } : option));
    const changes = revisionChanges(session, 2)!;
    expect(changes.recommendation).toEqual({ from: original.recommendation.seat, to: "B" });
    expect(changes.feasibility).toEqual([{ seat: "B", from: "conditional", to: "feasible" }]);
  });

  it("skip the critique when no fact was given, only a note", async () => {
    const session = await completed();
    const before = session.usage.length;
    const engine = engineWith();
    await engine.beginRevision(session, {
      reason: "edit",
      inputs: { facts: [], note: "The launch moves to October.", questionnaireId: null },
      by: null,
    });
    await engine.runRevision(session);
    expect(session.usage.slice(before).map((record) => record.task)).toEqual(["reassess"]);
    expect(session.revisions[1]?.critiques).toEqual([]);
  });

  it("refuse to start before the verdict, or while another revision runs", async () => {
    const engine = engineWith();
    const fresh = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await expect(engine.beginRevision(fresh, answers)).rejects.toMatchObject({ code: "wrong_phase" });
    const session = await completed();
    await engine.beginRevision(session, answers);
    await expect(engine.beginRevision(session, answers)).rejects.toMatchObject({ code: "session_busy" });
    await expect(engineWith().runRevision(createSession({ locale: "en", idea: "x", demo: true, ...DEMO_LINEUP }))).rejects.toMatchObject({
      code: "wrong_phase",
    });
  });

  it("leave the verdict as it was when the arbiter fails, and can be asked again", async () => {
    const session = await completed();
    const verdict = session.verdict;
    const failing = engineWith({ ...demoProviders(), arbiter: new Priced("mock", "reassess") });
    await failing.beginRevision(session, answers);
    expect(await failing.runRevision(session)).toBe(false);
    expect(session.phase).toBe("complete");
    expect(session.verdict).toBe(verdict);
    expect(session.revisions).toHaveLength(1);
    expect(session.revising?.error?.code).toBe("provider_unavailable");
    expect(isWorking(session)).toBe(false);

    // Asked again, the failed revision is replaced: the same number, made this time.
    const engine = engineWith();
    expect((await engine.beginRevision(session, answers)).number).toBe(2);
    expect(await engine.runRevision(session)).toBe(true);
    expect(session.revisions).toHaveLength(2);
  });

  it("keep to their own cost cap, not the debate's", async () => {
    setModelPrice("priced-revision", { input: 100, output: 100 });
    const session = await completed();
    session.budgetUsd = 0.000_001;
    const priced = { ...demoProviders(), arbiter: new Priced("priced-revision"), devil: new Priced("priced-revision") };

    const capped = engineWith(priced);
    await capped.beginRevision(session, answers);
    expect(await capped.runRevision(session, { budgetUsd: 0.01 })).toBe(false);
    expect(session.revising?.error?.code).toBe("budget_exceeded");
    // Too expensive to critique first and still rule: only the ruling is tried, which does not fit either.
    expect(session.usage.filter((record) => record.revision === 2)).toEqual([]);

    const engine = engineWith(priced);
    await engine.beginRevision(session, answers);
    expect(await engine.runRevision(session, { budgetUsd: 50 })).toBe(true);
    const spent = session.usage.filter((record) => record.revision === 2);
    expect(spent.length).toBeGreaterThan(0);
    expect(spent.every((record) => (record.costUsd ?? 0) > 0)).toBe(true);
  });

  it("stop as interrupted without failing the session when the server stops", async () => {
    const session = await completed();
    await engineWith().beginRevision(session, answers);
    markInterrupted(session);
    expect(session.phase).toBe("complete");
    expect(session.error).toBeNull();
    expect(session.revising?.error?.code).toBe("interrupted");
  });

  it("give older sessions their verdict as revision 1", async () => {
    const session = await completed();
    const { revisions: _revisions, revising: _revising, ...legacy } = session;
    const normalized = normalizeSession(legacy as Session);
    expect(normalized.revisions).toHaveLength(1);
    expect(normalized.revisions[0]).toMatchObject({ number: 1, reason: "debate", createdAt: session.updatedAt });
    expect(normalized.revising).toBeNull();
    const { revisions: _none, ...unruled } = createSession({ locale: "en", idea: "x", demo: true, ...DEMO_LINEUP });
    expect(normalizeSession(unruled as Session).revisions).toEqual([]);
  });
});
