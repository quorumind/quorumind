import { describe, expect, it } from "vitest";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { DEMO_IDEA } from "./demo.ts";
import { DebateEngine, type EngineEvent, type ProviderSet } from "./engine.ts";
import { setModelPrice } from "./pricing.ts";
import { MockProvider } from "./providers/mock.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import { createSession, currentProposals, type Session } from "./session.ts";

function setup(providers: ProviderSet = providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 }), budgetUsd: number | null = null) {
  const events: EngineEvent[] = [];
  const saved: string[] = [];
  // The demo lineup has a devil's advocate: give it the demo model when a test brings its own providers.
  const engine = new DebateEngine(
    { devil: new MockProvider({ chunkDelayMs: 0 }), ...providers },
    {
      emit: (_id, event) => events.push(event),
      save: (session) => {
        saved.push(session.phase);
      },
    },
  );
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, budgetUsd, ...DEMO_LINEUP });
  return { engine, session, events, saved };
}

async function runToVerdict(engine: DebateEngine, session: Session) {
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000 and €400 a month" }]);
  if (!session.sheet) throw new Error("no sheet");
  await engine.confirmSheet(session, session.sheet);
  await engine.runDebate(session);
  if (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes, if it fits the cap" }]);
    await engine.runDebate(session);
  }
}

describe("DebateEngine with the demo script", () => {
  it("asks questions first, then produces the requirements sheet", async () => {
    const { engine, session } = setup();
    await engine.startInterview(session);
    expect(session.phase).toBe("interview");
    const first = session.interview[0];
    expect(first?.kind === "interviewer" && first.data.questions.length).toBeGreaterThan(0);

    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    expect(session.phase).toBe("review");
    expect(session.sheet?.hardConstraints.length).toBeGreaterThan(0);
  });

  it("pauses for the person's answers during the debate, then reaches a verdict", async () => {
    const { engine, session } = setup();
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    await engine.confirmSheet(session, session.sheet!);
    await engine.runDebate(session);

    expect(session.phase).toBe("awaiting_answers");
    const proposals = session.debate.filter((entry) => entry.kind === "proposal");
    expect(proposals).toHaveLength(2);

    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
    await engine.runDebate(session);
    expect(session.phase).toBe("complete");
    expect(session.verdict?.recommendation.seat).toBe("A");
    expect(Object.keys(currentProposals(session))).toEqual(["A", "B"]);
    expect(session.error).toBeNull();
  });

  it("streams each role's speech as it is written", async () => {
    const providers = providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 });
    const { engine, session, events } = setup(providers);
    await engine.startInterview(session);
    const speeches = events.filter((event) => event.type === "speech");
    expect(speeches.length).toBeGreaterThan(1);
    const last = speeches.at(-1);
    expect(last?.type === "speech" && last.text.startsWith("A booking app")).toBe(true);
  });

  it("renders the report in the session's language", async () => {
    const { engine, session } = setup();
    session.locale = "fr";
    await runToVerdict(engine, session);
    const report = renderReport(session);
    expect(report).toContain("_Rapport de décision");
    expect(report).toContain("## Recommandation");
    expect(report).toContain("Faisable sous conditions");

    session.locale = "ar";
    expect(renderReport(session)).toContain("تقرير القرار");
  });
});

class PricedProvider implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "priced-test-model";
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    const result = await this.inner.generate(request, onDelta);
    return { ...result, model: this.model, usage: { inputTokens: 1_000_000, outputTokens: 0 } };
  }
}

describe("cost cap", () => {
  it("stops the session when the budget is spent", async () => {
    setModelPrice("priced-test-model", { input: 1, output: 0 });
    const priced = new PricedProvider();
    const { engine, session } = setup({ interviewer: priced, arbiter: priced, proposers: { A: priced, B: priced } }, 1.5);
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    expect(session.phase).toBe("review");
    await engine.confirmSheet(session, session.sheet!);
    await engine.runDebate(session);
    expect(session.phase).toBe("failed");
    expect(session.error).toMatchObject({ code: "budget_exceeded", params: { spentUsd: 2, budgetUsd: 1.5 } });
  });

  it("records the cost a provider reports rather than the price table's", async () => {
    setModelPrice("priced-test-model", { input: 1, output: 0 });
    const inner = new PricedProvider();
    const reporting: LlmProvider = {
      kind: "openrouter",
      model: inner.model,
      generate: async (request, onDelta) => ({ ...(await inner.generate(request, onDelta)), costUsd: 0.25 }),
    };
    const { engine, session } = setup({ interviewer: reporting, arbiter: reporting, proposers: { A: reporting, B: reporting } });
    await engine.startInterview(session);
    expect(session.usage.map((record) => record.costUsd)).toEqual([0.25]);
  });
});

class FlakyProvider implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  failures = 0;
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  private readonly failOn: GenerateRequest["task"];
  private remaining: number;
  constructor(failOn: GenerateRequest["task"], remaining: number) {
    this.failOn = failOn;
    this.remaining = remaining;
  }
  async generate(request: GenerateRequest, onDelta?: (text: string) => void) {
    if (request.task === this.failOn && this.remaining > 0) {
      this.remaining--;
      this.failures++;
      throw new ProviderError("Temporary outage", false);
    }
    return this.inner.generate(request, onDelta);
  }
}

describe("failures", () => {
  it("marks the session failed and resumes from the failed step", async () => {
    const flaky = new FlakyProvider("verdict", 1);
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const { engine, session } = setup({ interviewer: mock, arbiter: flaky, proposers: { A: mock, B: mock } });
    await runToVerdict(engine, session);
    expect(session.phase).toBe("failed");
    expect(session.error).toEqual({ code: "provider_error", message: "Temporary outage", params: { provider: "mock", model: "mock" } });
    const proposalsBefore = session.debate.filter((entry) => entry.kind === "proposal").length;

    const next = await engine.resume(session);
    expect(next).toBe("debate");
    await engine.runDebate(session);
    expect(session.phase).toBe("complete");
    expect(session.debate.filter((entry) => entry.kind === "proposal")).toHaveLength(proposalsBefore);
  });

  it("keeps the provider's reason as the error code, without retrying what cannot succeed", async () => {
    const mock = new MockProvider({ chunkDelayMs: 0 });
    let calls = 0;
    const rejected: LlmProvider = {
      kind: "anthropic",
      model: "claude-test",
      async generate() {
        calls++;
        throw new ProviderError("The Anthropic API key was rejected.", false, { code: "provider_auth" });
      },
    };
    const { engine, session } = setup({ interviewer: rejected, arbiter: mock, proposers: { A: mock, B: mock } });
    await engine.startInterview(session);
    expect(calls).toBe(1);
    expect(session.error).toEqual({
      code: "provider_auth",
      message: "The Anthropic API key was rejected.",
      params: { provider: "anthropic", model: "claude-test" },
    });
  });

  it("refuses an action that does not match the phase, with a code", async () => {
    const { engine, session } = setup();
    await expect(engine.answerDebate(session, [])).rejects.toMatchObject({ code: "wrong_phase" });
  });

  it("retries once when an answer is not valid JSON", async () => {
    let calls = 0;
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const broken: LlmProvider = {
      kind: "mock",
      model: "mock",
      async generate(request, onDelta) {
        calls++;
        if (calls === 1) return { text: '{"speech": "cut', model: "mock", usage: { inputTokens: 1, outputTokens: 1 } };
        return mock.generate(request, onDelta);
      },
    };
    const { engine, session } = setup({ interviewer: broken, arbiter: mock, proposers: { A: mock, B: mock } });
    await engine.startInterview(session);
    expect(calls).toBe(2);
    expect(session.phase).toBe("interview");
    expect(session.error).toBeNull();
  });
});
