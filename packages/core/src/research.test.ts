import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { DEMO_IDEA, DEMO_SCRIPT, DEMO_SHEET } from "./demo.ts";
import { DebateEngine, type EngineEvent, type ProviderSet } from "./engine.ts";
import { MockProvider } from "./providers/mock.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import {
  cleanQuery,
  DEMO_RESEARCH_PLAN,
  demoSearchResults,
  plannedQueries,
  RESEARCH_CAP_SHARE,
  type ResearchSettings,
  researchAvailability,
  researchBudget,
  searchFromEnv,
  searchKindFromEnv,
  settleClaims,
  settleResearchFacts,
} from "./research.ts";
import { RESEARCH_LABELS } from "./research-labels.ts";
import { researchNote, researchSection } from "./research-report.ts";
import type { Verdict } from "./schemas.ts";
import { OpenRouterSearch, RecordedSearch, type SearchProvider } from "./search.ts";
import { createSession, type NewSessionInput, normalizeSession, type Session } from "./session.ts";

const RESEARCH: ResearchSettings = { maxQueries: 6, budgetUsd: 0.3 };

/** Counts the searches, and can fail some of them. */
class CountingSearch implements SearchProvider {
  readonly kind = "demo" as const;
  readonly name = "demo";
  readonly estimateUsd: number;
  readonly queries: string[] = [];
  private readonly inner = new RecordedSearch((query) =>
    /stripe|postgres|node|gdpr/i.test(query)
      ? [{ url: `https://example.org/${query.split(" ")[0]?.toLowerCase()}`, title: query, snippet: `About ${query}.` }]
      : [],
  );
  private readonly options: { fail?: RegExp; costUsd?: number; onSearch?: (count: number) => void };
  constructor(options: { fail?: RegExp; costUsd?: number; onSearch?: (count: number) => void } = {}) {
    this.options = options;
    this.estimateUsd = options.costUsd ?? 0;
  }
  async search(query: string, options: { maxResults?: number; signal?: AbortSignal } = {}) {
    this.queries.push(query);
    if (this.options.fail?.test(query)) throw new ProviderError("The engine is down.", true, { code: "provider_unavailable" });
    const result = await this.inner.search(query, options);
    // Told once the search is done: a test can stop the session between two searches.
    this.options.onSearch?.(this.queries.length);
    return { ...result, costUsd: this.options.costUsd ?? 0 };
  }
}

/** Records every model request, answering with the demo script. */
class Recorder implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  readonly requests: GenerateRequest[] = [];
  private readonly mock = new MockProvider({ chunkDelayMs: 0 });
  generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    return this.mock.generate(request);
  }
}

function setup(
  options: {
    search?: SearchProvider | null;
    research?: ResearchSettings | null;
    budgetUsd?: number | null;
    input?: Partial<NewSessionInput>;
  } = {},
) {
  const recorder = new Recorder();
  const providers: ProviderSet = {
    interviewer: recorder,
    arbiter: recorder,
    proposers: { A: recorder, B: recorder },
    devil: recorder,
    search: options.search === undefined ? new CountingSearch() : options.search,
  };
  const events: EngineEvent[] = [];
  const engine = new DebateEngine(providers, { emit: (_id, event) => events.push(event), save: () => {} });
  const session = createSession({
    locale: "en",
    idea: DEMO_IDEA,
    demo: true,
    ...DEMO_LINEUP,
    webResearch: options.research === undefined ? RESEARCH : options.research,
    budgetUsd: options.budgetUsd ?? null,
    ...options.input,
  });
  return { engine, session, recorder, events, providers };
}

async function confirm(engine: DebateEngine, session: Session) {
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000 and €400 a month" }]);
  if (!session.sheet) throw new Error("no sheet");
  await engine.confirmSheet(session, session.sheet);
}

async function runToVerdict(engine: DebateEngine, session: Session) {
  await confirm(engine, session);
  await engine.runDebate(session);
  if (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes, if it fits the cap" }]);
    await engine.runDebate(session);
  }
}

describe("search configuration", () => {
  it("is off unless an engine and its key are configured, and never with local models only", () => {
    expect(searchKindFromEnv({})).toBeNull();
    expect(searchKindFromEnv({ QUORUMIND_SEARCH: "openrouter" })).toBeNull();
    expect(searchKindFromEnv({ QUORUMIND_SEARCH: "openrouter", OPENROUTER_API_KEY: "k" })).toBe("openrouter");
    expect(searchKindFromEnv({ QUORUMIND_SEARCH: "brave", BRAVE_SEARCH_API_KEY: "k" })).toBe("brave");
    expect(searchKindFromEnv({ QUORUMIND_SEARCH: "brave", BRAVE_SEARCH_API_KEY: "k", QUORUMIND_LOCAL_ONLY: "1" })).toBeNull();
    expect(researchAvailability({}).default).toBe(false);
  });

  it("never searches for a European-only debate, and replays the recording for the demo", () => {
    const env = { QUORUMIND_SEARCH: "openrouter", OPENROUTER_API_KEY: "k" };
    expect(searchFromEnv(env)).toBeInstanceOf(OpenRouterSearch);
    expect(searchFromEnv(env, { european: true })).toBeNull();
    expect(searchFromEnv({}, { demo: true })).toBeInstanceOf(RecordedSearch);
    expect(providersFor({ ...DEMO_LINEUP, european: { gateway: "eu" } }, env).search).toBeNull();
  });
});

describe("queries sent to the search engine", () => {
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
  session.sheet = { ...DEMO_SHEET, projectName: "Lotus Yoga Booking" };

  it("are short and generic: personal data, the project's name and long text are never sent", () => {
    expect(cleanQuery('Stripe "pricing"\nEurope', session)).toBe("Stripe pricing Europe");
    expect(cleanQuery("contact jane.doe@example.com about Stripe", session)).toBeNull();
    expect(cleanQuery("Lotus Yoga Booking hosting price", session)).toBeNull();
    expect(cleanQuery("word ".repeat(30), session)).toBeNull();
  });

  it("are distinct and limited in number", () => {
    const plan = {
      speech: "",
      queries: [
        ...DEMO_RESEARCH_PLAN.queries,
        { question: "Again?", query: "stripe PRICING european cards, fees", topic: "pricing" as const },
      ],
    };
    expect(plannedQueries(plan, session, 10)).toHaveLength(4);
    expect(plannedQueries(plan, session, 2).map((query) => query.query)).toEqual([
      "Stripe pricing European cards fees",
      "PostgreSQL versioning policy end of life current version",
    ]);
  });
});

describe("verified claims", () => {
  const verdict = (): Verdict =>
    structuredClone({
      ...DEMO_SCRIPT.verdict,
      claims: [
        { claim: "Sourced", confidence: "verified", sources: ["s1"] },
        { claim: "Unknown source", confidence: "verified", sources: ["S9"] },
        { claim: "No source", confidence: "verified", sources: [] },
        { claim: "Estimate", confidence: "estimated", sources: [] },
      ],
    });

  it("are verified only when they cite a source the research found: the others are downgraded to estimated", () => {
    const ruled = verdict();
    settleClaims(ruled, [{ id: "S1" }]);
    expect(ruled.claims.map((claim) => [claim.confidence, claim.sources])).toEqual([
      ["verified", ["S1"]],
      ["estimated", []],
      ["estimated", []],
      ["estimated", []],
    ]);
  });

  it("stored before sources existed cite none, so none stays verified", () => {
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    const legacy = { ...DEMO_SCRIPT.verdict, claims: [{ claim: "Old", confidence: "verified" }] } as unknown as Verdict;
    const { webResearch: _settings, research: _research, sources: _sources, ...stored } = { ...session, verdict: legacy };
    const normalized = normalizeSession(stored as Session);
    expect(normalized.verdict?.claims).toEqual([{ claim: "Old", confidence: "estimated", sources: [] }]);
    expect(normalized.sources).toEqual([]);
    expect(normalized.webResearch).toBeNull();
  });

  it("keep only the facts that cite sources found", () => {
    const facts = settleResearchFacts(
      {
        speech: "",
        facts: [
          { question: "Q1", fact: "Cited.", sources: ["S1", "S1"] },
          { question: "Q2", fact: "Invented.", sources: ["S7"] },
          { question: "Q3", fact: "Bare.", sources: [] },
        ],
      },
      [{ id: "S1", url: "https://a.example", title: "A", snippet: "", retrievedAt: "", question: "Q1" }],
    );
    expect(facts).toEqual([{ id: "F1", question: "Q1", fact: "Cited.", sources: ["S1"] }]);
  });
});

describe("the research step", () => {
  it("runs after the sheet is confirmed and before the proposals, then the participants read the facts with their ids", async () => {
    const { engine, session, recorder, events } = setup();
    await runToVerdict(engine, session);

    expect(session.phase).toBe("complete");
    expect(session.research?.status).toBe("done");
    expect(session.research?.queries.map((query) => query.searchedAt !== null)).toEqual([true, true, true, true]);
    expect(session.sources.map((source) => source.id)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(session.sources[0]).toMatchObject({ question: "What does Stripe charge per card payment in the EU?" });
    expect(session.research?.facts.map((fact) => fact.sources)).toEqual([["S1"], ["S2"], ["S3"], ["S4"]]);

    const tasks = recorder.requests.map((request) => request.task);
    expect(tasks.indexOf("research")).toBeLessThan(tasks.indexOf("proposal"));
    expect(tasks.filter((task) => task === "research")).toHaveLength(2);
    expect(session.usage.filter((record) => record.task === "search")).toHaveLength(4);
    expect(events.some((event) => event.type === "speaking" && event.task === "search")).toBe(true);

    // The plan reads the sheet alone, never the documents or the profile.
    const plan = recorder.requests.find((request) => request.schemaName === "research_plan");
    expect(plan?.messages[0]?.content).toContain("<requirements>");
    expect(plan?.messages[0]?.content).not.toContain("<context>");
    for (const task of ["proposal", "critique", "revision", "verdict"] as const) {
      const request = recorder.requests.find((item) => item.task === task);
      expect(request?.messages[0]?.content, task).toContain("<research>");
      expect(request?.messages[0]?.content, task).toContain("[S1]");
    }
    // The demo verdict's two sourced claims stay verified.
    expect(session.verdict?.claims.filter((claim) => claim.confidence === "verified").map((claim) => claim.sources)).toEqual([
      ["S1"],
      ["S2"],
    ]);
  });

  it("is not run when the session does not ask for it, and the arbiter then verifies nothing", async () => {
    const { engine, session, recorder } = setup({ research: null });
    await runToVerdict(engine, session);
    expect(session.research).toBeNull();
    expect(recorder.requests.some((request) => request.task === "research")).toBe(false);
    expect(session.verdict?.claims.some((claim) => claim.confidence === "verified")).toBe(false);
    expect(recorder.requests.find((request) => request.task === "verdict")?.system).toContain("no claim can be verified");
  });

  it("is skipped for a European-only debate: nothing is searched, and the report says why", async () => {
    const search = new CountingSearch();
    const { engine, session, recorder } = setup({ search });
    session.european = { gateway: "eu" };
    await runToVerdict(engine, session);
    expect(session.research).toMatchObject({ status: "skipped", skipped: "european" });
    expect(search.queries).toEqual([]);
    expect(recorder.requests.some((request) => request.task === "research")).toBe(false);
    expect(researchNote(session)).toBe(RESEARCH_LABELS.en.methodEuropean);
    expect(renderReport(session)).toContain("no search engine keeps the queries in Europe");
  });

  it("is skipped when no search engine is configured", async () => {
    const { engine, session } = setup({ search: null });
    await runToVerdict(engine, session);
    expect(session.research).toMatchObject({ status: "skipped", skipped: "unavailable" });
    expect(session.phase).toBe("complete");
  });

  it("makes no more searches than allowed", async () => {
    const search = new CountingSearch();
    const { engine, session } = setup({ search, research: { maxQueries: 2, budgetUsd: 1 } });
    await runToVerdict(engine, session);
    expect(search.queries).toHaveLength(2);
    expect(session.research?.queries).toHaveLength(2);
  });

  it("stays within its budget and its share of the cost cap", async () => {
    expect(researchBudget({ webResearch: { maxQueries: 6, budgetUsd: 0.3 }, budgetUsd: 1 })).toBeCloseTo(RESEARCH_CAP_SHARE);
    expect(researchBudget({ webResearch: { maxQueries: 6, budgetUsd: 0.3 }, budgetUsd: null })).toBe(0.3);

    // Each search costs 0.04 and the budget is 0.1: two searches fit with the room the findings need.
    const search = new CountingSearch({ costUsd: 0.04 });
    const { engine, session } = setup({ search, research: { maxQueries: 6, budgetUsd: 0.1 } });
    await runToVerdict(engine, session);
    expect(search.queries).toHaveLength(2);
    expect(session.research?.queries.map((query) => query.error)).toEqual([null, null, "budget", "budget"]);
    expect(session.research?.status).toBe("done");
    const spent = session.usage.filter((record) => record.task === "search").reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
    expect(spent).toBeLessThanOrEqual(0.1);
  });

  it("is skipped when the budget leaves no room to start", async () => {
    const search = new CountingSearch({ costUsd: 1 });
    const { engine, session } = setup({ search, research: { maxQueries: 6, budgetUsd: 0.5 } });
    await runToVerdict(engine, session);
    expect(session.research).toMatchObject({ status: "skipped", skipped: "budget" });
    expect(search.queries).toEqual([]);
    expect(researchNote(session)).toBe(RESEARCH_LABELS.en.methodBudget);
  });

  it("goes on without the searches that fail", async () => {
    const search = new CountingSearch({ fail: /postgres/i });
    const { engine, session } = setup({ search });
    await runToVerdict(engine, session);
    expect(session.research?.status).toBe("done");
    expect(session.research?.queries[1]?.error).toBe("The engine is down.");
    // The demo's fact on PostgreSQL cites S2, which is now the Node.js page: the ids follow what was found.
    expect(session.sources).toHaveLength(3);
  });

  it("never searches a query twice in a session, even when it is stopped and resumed", async () => {
    const controller = new AbortController();
    const search = new CountingSearch({ onSearch: (count) => count === 2 && controller.abort() });
    const { providers, session } = setup({ search });
    const engine = new DebateEngine(providers, { emit: () => {}, save: () => {} }, { signal: controller.signal });
    await confirm(engine, session);
    await engine.runDebate(session);
    expect(session.phase).toBe("failed");
    expect(session.error?.code).toBe("stopped");
    expect(session.research?.status).toBe("running");

    const resumed = new DebateEngine(providers, { emit: () => {}, save: () => {} });
    await resumed.resume(session);
    await resumed.runDebate(session);
    if (session.phase === "awaiting_answers") {
      await resumed.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
      await resumed.runDebate(session);
    }
    expect(session.research?.status).toBe("done");
    expect(new Set(search.queries).size).toBe(search.queries.length);
    expect(search.queries).toHaveLength(4);
  });

  it("does not stop the debate when the researcher fails", async () => {
    const failing: LlmProvider = {
      kind: "mock",
      model: "mock",
      generate: async (request, onDelta) => {
        if (request.task === "research") throw new ProviderError("Refused.", false, { code: "provider_refused" });
        return new MockProvider({ chunkDelayMs: 0 }).generate(request, onDelta);
      },
    };
    const { session, providers } = setup();
    const engine = new DebateEngine({ ...providers, interviewer: failing }, { emit: () => {}, save: () => {} });
    await runToVerdict(engine, session);
    expect(session.phase).toBe("complete");
    expect(session.research).toMatchObject({ status: "failed", error: { code: "provider_refused" } });
    expect(researchNote(session)).toBe(RESEARCH_LABELS.en.methodFailed);
  });
});

describe("the facts with their sources", () => {
  it("reach the rulings of a revision and of a what-if scenario", async () => {
    const { engine, session, recorder } = setup();
    await runToVerdict(engine, session);
    await engine.beginRevision(session, {
      reason: "scenario",
      inputs: { facts: [], note: "What if the budget were 30% lower?", questionnaireId: null },
      by: null,
      scenario: {
        title: "Leaner",
        question: "What if the budget were 30% lower?",
        changes: [{ kind: "budget", target: "build", percent: -30 }],
      },
    });
    expect(await engine.runRevision(session)).toBe(true);
    const ruling = recorder.requests.findLast((request) => request.task === "reassess");
    expect(ruling?.messages[0]?.content).toContain("<research>");
    expect(ruling?.system).toContain('Mark a claim "verified" only when a fact of <research> supports it');
    expect(session.verdict?.claims.filter((claim) => claim.confidence === "verified").every((claim) => claim.sources.length > 0)).toBe(
      true,
    );
  });

  it("reach the alternative, the findings and the ruling of an audit", async () => {
    const quote = readFileSync(join(import.meta.dirname, "../../../bench/fixtures/web-agency-quote.md"), "utf8");
    const { engine, session, recorder } = setup({
      input: {
        mode: "audit",
        context: [{ id: "quote", kind: "file", name: "Quote.pdf", text: quote, source: "Quote.pdf" }],
        audit: { alternative: true },
      },
    });
    await runToVerdict(engine, session);
    expect(session.phase).toBe("complete");
    expect(session.research?.status).toBe("done");
    for (const task of ["proposal", "critique", "verdict"] as const) {
      const request = recorder.requests.findLast((item) => item.task === task);
      expect(request?.messages[0]?.content, task).toContain("<research>");
      expect(request?.system, task).toContain("<research>");
    }
  });
});

describe("the report", () => {
  it("lists the numbered sources with their dates, cites them inline and says when the research was done", async () => {
    const { engine, session } = setup({ search: new RecordedSearch(demoSearchResults) });
    await runToVerdict(engine, session);
    const report = renderReport(session);
    expect(report).toContain("## Web research");
    expect(report).toContain("## Sources");
    expect(report).toContain("1. [Stripe pricing (France)](<https://stripe.com/fr/pricing>), retrieved on June 15, 2026");
    expect(report).toMatch(/Stripe charges 1\.5% \+ €0\.25 per payment with a standard EEA card \[1\] _\(verified\)_/);
    expect(report).toContain("Web research was done on");
    expect(researchSection(session)?.sources).toHaveLength(4);
  });

  it("says that no research was done when the session had none", () => {
    const session = createSession({ locale: "fr", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    expect(renderReport(session)).toContain(RESEARCH_LABELS.fr.methodOff);
  });
});

describe("research labels", () => {
  it.each(Object.keys(RESEARCH_LABELS))("%s has every label", (locale) => {
    const labels = RESEARCH_LABELS[locale as keyof typeof RESEARCH_LABELS];
    expect(Object.keys(labels).sort()).toEqual(Object.keys(RESEARCH_LABELS.en).sort());
    for (const [key, value] of Object.entries(labels)) {
      expect(value.trim(), `${locale}: ${key}`).not.toBe("");
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(RESEARCH_LABELS.en[key as keyof typeof RESEARCH_LABELS.en]));
    }
  });

  it("follows French typography: a no-break space before : ; ? ! and inside « »", () => {
    for (const [key, value] of Object.entries(RESEARCH_LABELS.fr)) {
      expect(value, key).not.toMatch(/[^  ][:;?!»]/u);
      expect(value, key).not.toMatch(/«[^  ]/u);
    }
  });
});
