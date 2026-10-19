import { describe, expect, it, vi } from "vitest";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { DEMO_IDEA } from "./demo.ts";
import { BudgetExceededError, DebateEngine, type EngineEvent, type ProviderSet, retryDelay } from "./engine.ts";
import { setModelPrice } from "./pricing.ts";
import { MockProvider } from "./providers/mock.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import { createSession, currentProposals, type Session, totalCost } from "./session.ts";

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

  // Each call reports what it cost; the price table gives the typical cost of a call not made yet
  // (critique 1.00, revision 1.50, verdict 2.00, twice that for the demo's verdict, which assesses its GDPR requirement),
  // which is what the engine estimates with.
  const COSTS: Partial<Record<GenerateRequest["task"], number>> = { interview: 0.1, proposal: 1, critique: 1, revision: 1, verdict: 1 };
  const reporting = (): LlmProvider => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    return {
      kind: "openrouter",
      model: "reporting-test-model",
      generate: async (request, onDelta) => ({
        ...(await inner.generate(request, onDelta)),
        model: "reporting-test-model",
        costUsd: COSTS[request.task] ?? 0,
      }),
    };
  };

  async function toDebate(budgetUsd: number) {
    setModelPrice("reporting-test-model", { input: 0, output: 500 });
    const provider = reporting();
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, budgetUsd);
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    await engine.confirmSheet(session, session.sheet!);
    return { engine, session };
  }

  it("skips the rounds that would leave no room for the verdict, and says so in the report", async () => {
    // 2.20 spent after the proposals; the critiques (2.00) and the verdict's reserve (5.00) would pass 7.
    const { engine, session } = await toDebate(7);
    await engine.runDebate(session);
    expect(session.phase).toBe("complete");
    expect(session.shortened).toEqual({ rounds: 0 });
    expect(session.debate.some((entry) => entry.kind === "critiques")).toBe(false);
    expect(session.usage.map((record) => record.task)).toEqual(["interview", "interview", "proposal", "proposal", "verdict"]);
    expect(renderReport(session)).toContain("The debate was shortened to stay within its budget: 0 of the 1 planned round(s)");
    session.locale = "fr";
    expect(renderReport(session)).toContain("Le débat a été écourté pour rester dans son budget");
  });

  it("does not start a verdict that cannot fit, and runs the skipped rounds once the cap is raised", async () => {
    const { engine, session } = await toDebate(3);
    await engine.runDebate(session);
    expect(session.phase).toBe("failed");
    expect(session.error).toMatchObject({ code: "budget_exceeded", params: { spentUsd: 2.2, budgetUsd: 3 } });
    expect(session.usage.some((record) => record.task === "verdict")).toBe(false);

    // Retrying with the same cap fails again at once, without calling a model.
    await engine.resume(session);
    await engine.runDebate(session);
    expect(session.error?.code).toBe("budget_exceeded");
    expect(session.usage).toHaveLength(4);

    await engine.resume(session, { budgetUsd: 20 });
    expect(session.shortened).toBeNull();
    await engine.runDebate(session);
    while (session.phase === "awaiting_answers") {
      await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
      await engine.runDebate(session);
    }
    expect(session.phase).toBe("complete");
    expect(session.shortened).toBeNull();
    expect(session.debate.some((entry) => entry.kind === "critiques")).toBe(true);
    expect(renderReport(session)).not.toContain("shortened");
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

  /** Fails its first `failures` calls after a full answer, as a token limit does: the provider reports what it billed. */
  const truncating = (failures: number): LlmProvider & { calls: number } => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    const provider = {
      kind: "anthropic" as const,
      model: "priced-test-model",
      calls: 0,
      async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
        provider.calls++;
        if (provider.calls <= failures) {
          throw new ProviderError("The answer was cut off by the token limit.", true, {
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
            model: "priced-test-model",
          });
        }
        return {
          ...(await inner.generate(request, onDelta)),
          model: "priced-test-model",
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        };
      },
    };
    return provider;
  };

  it("records a call the provider billed before it failed, and counts it against the cap", async () => {
    setModelPrice("priced-test-model", { input: 1, output: 0 });
    const provider = truncating(1);
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, 5);
    await engine.startInterview(session);
    expect(session.phase).toBe("interview");
    expect(session.usage.map(({ task, costUsd, failed }) => ({ task, costUsd, failed }))).toEqual([
      { task: "interview", costUsd: 1, failed: true },
      { task: "interview", costUsd: 1, failed: undefined },
    ]);
    expect(totalCost(session)).toEqual({ usd: 2, complete: true });
    expect(new Set(session.usage.map((record) => record.id)).size).toBe(2);
  });

  it("does not retry a failed call when another one would pass the cap", async () => {
    setModelPrice("priced-test-model", { input: 1, output: 0 });
    const provider = truncating(2);
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, 1.5);
    await engine.startInterview(session);
    expect(provider.calls).toBe(1);
    expect(session.phase).toBe("failed");
    expect(session.error).toMatchObject({ code: "budget_exceeded", params: { spentUsd: 1, budgetUsd: 1.5 } });
    expect(session.usage).toHaveLength(1);
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

  it("stops the calls in flight when asked, records what they may cost, and resumes from there", async () => {
    let started = 0;
    const hanging: LlmProvider = {
      kind: "mock",
      model: "mock",
      generate(request) {
        started++;
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new ProviderError("The request was cancelled.", false)), { once: true });
        });
      },
    };
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const controller = new AbortController();
    const events: EngineEvent[] = [];
    const engine = new DebateEngine(
      { interviewer: mock, arbiter: mock, proposers: { A: hanging, B: hanging }, devil: mock },
      { emit: (_id, event) => events.push(event), save: () => {} },
      { signal: controller.signal },
    );
    const { session } = setup();
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    await engine.confirmSheet(session, session.sheet!);
    const usage = session.usage.length;
    const running = engine.runDebate(session);
    await vi.waitFor(() => expect(started).toBe(2));
    controller.abort();
    await running;
    expect(session.phase).toBe("failed");
    expect(session.error).toEqual({ code: "stopped", message: "The session was stopped." });
    // The provider bills the prompt of a cancelled call: both are recorded as failed, with an estimate.
    const stopped = session.usage.slice(usage);
    expect(stopped.map(({ task, seat, failed, estimated }) => ({ task, seat, failed, estimated }))).toEqual([
      { task: "proposal", seat: "A", failed: true, estimated: true },
      { task: "proposal", seat: "B", failed: true, estimated: true },
    ]);
    expect(stopped.every((record) => record.inputTokens > 0 && record.outputTokens === 0)).toBe(true);
    expect(started).toBe(2);

    const { engine: fresh } = setup();
    expect(await fresh.resume(session)).toBe("debate");
    await fresh.runDebate(session);
    expect(session.phase).toBe("awaiting_answers");
  });

  it("tries again an interview turn that asks nothing and gives no sheet, rather than leaving nothing to answer", async () => {
    let calls = 0;
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const empty: LlmProvider = {
      kind: "mock",
      model: "mock",
      async generate(request, onDelta) {
        calls++;
        const result = await mock.generate(request, onDelta);
        if (calls > 1) return result;
        return { ...result, text: JSON.stringify({ ...JSON.parse(result.text), status: "ask", questions: [], sheet: null }) };
      },
    };
    const { engine, session } = setup({ interviewer: empty, arbiter: mock, proposers: { A: mock, B: mock } });
    await engine.startInterview(session);
    expect(calls).toBe(2);
    expect(session.error).toBeNull();
    const turn = session.interview[0];
    expect(turn?.kind === "interviewer" && turn.data.questions.length).toBeGreaterThan(0);
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

describe("saves", () => {
  it("saves one at a time and in order while the calls of a step end together", async () => {
    let inFlight = 0;
    let most = 0;
    const usageSaved: number[] = [];
    const engine = new DebateEngine(providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 }), {
      emit: () => {},
      // A slow store: a save still running when the other proposal ends.
      save: async (session) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        usageSaved.push(session.usage.length);
        inFlight--;
      },
    });
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await runToVerdict(engine, session);
    expect(session.phase).toBe("complete");
    expect(most).toBe(1);
    expect(usageSaved).toEqual([...usageSaved].sort((a, b) => a - b));
    expect(usageSaved.at(-1)).toBe(session.usage.length);
    expect(new Set(session.usage.map((record) => record.id)).size).toBe(session.usage.length);
  });

  it("goes on saving after a save failed", async () => {
    let failing = true;
    const saved: string[] = [];
    const engine = new DebateEngine(providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 }), {
      emit: () => {},
      save: async (session) => {
        if (failing) {
          failing = false;
          throw new Error("The store is down.");
        }
        saved.push(session.phase);
      },
    });
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await engine.startInterview(session);
    expect(session.phase).toBe("failed");
    expect(saved).toEqual(["failed"]);
  });
});

describe("BudgetExceededError", () => {
  it("states a cap of a few cents without rounding it to the cent", () => {
    expect(new BudgetExceededError(0.0191, 0.0192).message).toBe("The cost cap of $0.0192 is reached ($0.0191 spent).");
    expect(new BudgetExceededError(2.5, 3).message).toBe("The cost cap of $3.00 is reached ($2.50 spent).");
  });
});

describe("retries", () => {
  const limited = (retryAfterMs?: number) =>
    new ProviderError("Slow down.", true, { code: "provider_rate_limit", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });

  it("waits longer before each new try of a rate-limited call, with jitter, and as long as the provider asks", () => {
    const half = () => 0.5;
    expect(retryDelay(limited(), 0, 2_000, half)).toBe(2_000);
    expect(retryDelay(limited(), 1, 2_000, half)).toBe(4_000);
    expect(retryDelay(limited(), 0, 2_000, () => 0)).toBe(1_000);
    expect(retryDelay(limited(), 0, 2_000, () => 0.999)).toBe(2_998);
    expect(retryDelay(limited(), 2, 2_000, half)).toBeNull();
    expect(retryDelay(limited(7_000), 0, 2_000, half)).toBe(7_000);
    // Longer than a session should hang: it fails, to be resumed later.
    expect(retryDelay(limited(120_000), 0, 2_000, half)).toBeNull();
  });

  it("tries an invalid or cut-off answer once more at once, and never what cannot succeed", () => {
    expect(retryDelay(new SyntaxError("Unexpected end"), 0, 2_000)).toBe(0);
    expect(retryDelay(new SyntaxError("Unexpected end"), 1, 2_000)).toBeNull();
    const cut = new ProviderError("The answer was cut off by the token limit.", true);
    expect(retryDelay(cut, 0, 2_000)).toBe(0);
    expect(retryDelay(cut, 1, 2_000)).toBeNull();
    expect(retryDelay(new ProviderError("Bad key.", false, { code: "provider_auth" }), 0, 2_000)).toBeNull();
    expect(retryDelay(new Error("A bug."), 0, 2_000)).toBeNull();
  });

  /** Fails its first calls with a rate limit, then answers like the demo. */
  const throttled = (failures: number) => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    const provider = {
      kind: "mock" as const,
      model: "mock",
      calls: [] as number[],
      async generate(request: GenerateRequest, onDelta?: (text: string) => void) {
        provider.calls.push(Date.now());
        if (provider.calls.length <= failures) throw limited();
        return inner.generate(request, onDelta);
      },
    };
    return provider;
  };

  it("tries a rate-limited call twice more, after a wait", async () => {
    const provider = throttled(2);
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const engine = new DebateEngine(
      { interviewer: provider, arbiter: mock, proposers: { A: mock, B: mock }, devil: mock },
      { emit: () => {}, save: () => {} },
      { retryDelayMs: 20 },
    );
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await engine.startInterview(session);
    expect(session.error).toBeNull();
    expect(provider.calls).toHaveLength(3);
    const [first = 0, second = 0, third = 0] = provider.calls;
    expect(second - first).toBeGreaterThanOrEqual(9);
    expect(third - second).toBeGreaterThanOrEqual(19);
  });

  it("fails with the provider's reason once the tries are spent, and stops waiting when stopped", async () => {
    const provider = throttled(10);
    const mock = new MockProvider({ chunkDelayMs: 0 });
    const controller = new AbortController();
    const engine = new DebateEngine(
      { interviewer: provider, arbiter: mock, proposers: { A: mock, B: mock }, devil: mock },
      { emit: () => {}, save: () => {} },
      { retryDelayMs: 0 },
    );
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await engine.startInterview(session);
    expect(provider.calls).toHaveLength(3);
    expect(session.error?.code).toBe("provider_rate_limit");

    const waiting = new DebateEngine(
      { interviewer: throttled(10), arbiter: mock, proposers: { A: mock, B: mock }, devil: mock },
      { emit: () => {}, save: () => {} },
      { signal: controller.signal, retryDelayMs: 60_000 },
    );
    const other = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    const started = Date.now();
    const running = waiting.startInterview(other);
    setTimeout(() => controller.abort(), 20);
    await running;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(other.error?.code).toBe("stopped");
  });
});

describe("cost cap with models of unknown price", () => {
  /** A model the price table does not know, reading a million tokens per call. */
  const unpriced = (): LlmProvider => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    return {
      kind: "openai",
      model: "unpriced-test-model",
      generate: async (request, onDelta) => ({
        ...(await inner.generate(request, onDelta)),
        model: "unpriced-test-model",
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      }),
    };
  };

  it("counts their calls at the fallback price, so the cap still stops the session", async () => {
    const provider = unpriced();
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, 5);
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    expect(session.phase).toBe("failed");
    expect(session.usage.map((record) => record.costUsd)).toEqual([null]);
    // $10 per million input tokens: the first call passes a cap of $5, and no other call is made.
    expect(session.error).toMatchObject({ code: "budget_exceeded", params: { spentUsd: 10, budgetUsd: 5 } });
    expect(totalCost(session).complete).toBe(false);
  });

  it("says in the method box how the cap counted them", async () => {
    const provider = unpriced();
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, 100);
    await engine.startInterview(session);
    expect(renderReport(session)).toContain("their calls were counted at $10 per million input tokens and $50 per million output tokens");
    session.budgetUsd = null;
    expect(renderReport(session)).not.toContain("no known price");
  });

  it("estimates the tokens of a call whose stream ended without its usage", async () => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    const silent: LlmProvider = {
      kind: "openrouter",
      model: "priced-test-model",
      generate: async (request, onDelta) => ({
        ...(await inner.generate(request, onDelta)),
        model: "priced-test-model",
        usage: { inputTokens: 0, outputTokens: 0 },
        usageMissing: true,
      }),
    };
    setModelPrice("priced-test-model", { input: 1, output: 0 });
    const { engine, session } = setup({ interviewer: silent, arbiter: silent, proposers: { A: silent, B: silent } });
    await engine.startInterview(session);
    const [record] = session.usage;
    expect(record).toMatchObject({ estimated: true });
    expect(record?.inputTokens).toBeGreaterThan(100);
    expect(record?.outputTokens).toBeGreaterThan(10);
    expect(record?.costUsd).toBeGreaterThan(0);
  });
});

describe("briefs", () => {
  const priced = (onBrief?: () => void, briefFailures = 0): LlmProvider & { briefs: number } => {
    const inner = new MockProvider({ chunkDelayMs: 0 });
    const provider = {
      kind: "openrouter" as const,
      model: "reporting-test-model",
      briefs: 0,
      async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
        if (request.task === "brief") {
          provider.briefs++;
          onBrief?.();
          if (provider.briefs <= briefFailures) {
            throw new ProviderError("The answer was cut off by the token limit.", true, {
              usage: { inputTokens: 1, outputTokens: 1 },
              costUsd: 0.4,
            });
          }
        }
        const costUsd = request.task === "brief" ? 0.05 : request.task === "interview" ? 0.1 : 1;
        return { ...(await inner.generate(request, onDelta)), model: "reporting-test-model", costUsd };
      },
    };
    return provider;
  };

  async function ruled(provider: LlmProvider) {
    setModelPrice("reporting-test-model", { input: 0, output: 500 });
    const { engine, session } = setup({ interviewer: provider, arbiter: provider, proposers: { A: provider, B: provider } }, 20);
    await runToVerdict(engine, session);
    expect(session.phase).toBe("complete");
    return { engine, session };
  }

  it("are written once the verdict has passed the debate's cap, within an allowance of their own", async () => {
    const { engine, session } = await ruled(priced());
    // The verdict ended past the cap: the debate's cap would refuse any further call.
    session.budgetUsd = totalCost(session).usd - 0.5;
    await engine.writeBrief(session, "client");
    expect(session.briefs.client?.headline).toBeTruthy();
    const record = session.usage.at(-1);
    expect(record).toMatchObject({ task: "brief", costUsd: 0.05 });
    expect(record?.attempt).toEqual(expect.any(String));
    expect(record).not.toHaveProperty("revision");
  });

  it("keep to that allowance when a call fails", async () => {
    const provider = priced(undefined, 2);
    const { engine, session } = await ruled(provider);
    // 10% of a $3 cap: the failed call spent $0.40, so it is not tried again.
    session.budgetUsd = 3;
    await expect(engine.writeBrief(session, "cto")).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(provider.briefs).toBe(1);
    expect(session.briefs.cto).toBeUndefined();
  });

  it("are not kept when a revision replaced the verdict meanwhile", async () => {
    let target: Session | null = null;
    const { engine, session } = await ruled(
      priced(() => {
        if (target?.verdict) target.verdict = { ...target.verdict };
      }),
    );
    target = session;
    await expect(engine.writeBrief(session, "executive")).rejects.toMatchObject({ code: "verdict_changed" });
    expect(session.briefs.executive).toBeUndefined();
  });
});
