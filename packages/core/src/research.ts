import { z } from "zod";
import { typicalCallCost } from "./pricing.ts";
import { fence, redact } from "./privacy.ts";
import type { FetchLike } from "./providers/http.ts";
import { toStrictJsonSchema, type Verdict } from "./schemas.ts";
import {
  BRAVE_SEARCH_PRICE_USD,
  BraveSearch,
  OPENROUTER_SEARCH_ENGINES,
  OpenRouterSearch,
  type OpenRouterSearchEngine,
  RecordedSearch,
  type SearchKind,
  type SearchProvider,
} from "./search.ts";
import type { Session, SessionError } from "./session.ts";

// Web research: after the requirements are confirmed and before the proposals, a researcher (the interviewer's model)
// lists the facts the debate depends on that may have changed since the models were trained (prices, current versions
// and end of life, regulations, vendor limits), searches the web for each with a short generic query, and states what
// the pages say, each fact with its sources. The participants read the facts with their source ids; a claim of the
// verdict is "verified" only when it cites one of them.

type Env = Record<string, string | undefined>;

/** What a session's research may do: how many searches, and what it may cost (inside the session's cost cap). */
export interface ResearchSettings {
  maxQueries: number;
  /** US dollars, searches and the researcher's calls together; null: only the share of the session's cap. */
  budgetUsd: number | null;
}

export const RESEARCH_TOPICS = ["pricing", "version", "end_of_life", "regulation", "limits", "other"] as const;
export type ResearchTopic = (typeof RESEARCH_TOPICS)[number];

/** A page the research read, numbered for the whole session (S1, S2…). */
export interface Source {
  id: string;
  url: string;
  title: string;
  /** What the page says on the question, as the search engine excerpted it. */
  snippet: string;
  retrievedAt: string;
  /** The question of the research it answers. */
  question: string;
}

/** One search of the research, which is also the session's cache: a query already searched is not searched again. */
export interface ResearchQuery {
  question: string;
  /** What was sent to the search engine, and nothing else. */
  query: string;
  topic: ResearchTopic;
  /** Null until it was searched. */
  searchedAt: string | null;
  /** The ids of the pages found. */
  sources: string[];
  /** Why the search gave nothing: the engine failed, or the budget left no room. */
  error: string | null;
}

/** What the pages say on one question, with the ids of the pages that say it. */
export interface ResearchFact {
  id: string;
  question: string;
  fact: string;
  sources: string[];
}

/**
 * Why the research did not run. european: a European-only debate, and no search engine keeps the queries in Europe.
 * unavailable: no search engine is configured. budget: the cost cap left no room for it.
 */
export type ResearchSkip = "european" | "unavailable" | "budget";

export interface ResearchRecord {
  status: "running" | "done" | "skipped" | "failed";
  skipped: ResearchSkip | null;
  /** Why it failed: the debate went on without it. */
  error: SessionError | null;
  /** The search engine, as usage records name it ("openrouter:exa", "brave", "demo"); null when skipped. */
  engine: string | null;
  kind: SearchKind | null;
  startedAt: string;
  finishedAt: string | null;
  queries: ResearchQuery[];
  facts: ResearchFact[];
}

/** Searches per session unless configured otherwise. */
export const DEFAULT_RESEARCH_QUERIES = 6;
export const MAX_RESEARCH_QUERIES = 12;
/** US dollars per session unless configured otherwise: a few searches and two short calls of the researcher. */
export const DEFAULT_RESEARCH_BUDGET_USD = 0.3;
/** The research never takes more than this share of the session's cost cap: the debate and the verdict come first. */
export const RESEARCH_CAP_SHARE = 0.15;
/** A query is short: anything longer is more likely to carry details of the project. */
export const MAX_QUERY_CHARS = 120;
const MAX_QUERY_WORDS = 16;

export const ResearchPlan = z.object({
  speech: z.string(),
  queries: z.array(
    z.object({
      question: z.string().describe("The fact the debate needs, as a question, e.g. What does Stripe charge per card payment in the EU?"),
      query: z
        .string()
        .describe("A web search query for it: at most 12 words, generic, naming only public products, vendors, regulations and countries."),
      topic: z.enum(RESEARCH_TOPICS),
    }),
  ),
});
export type ResearchPlan = z.infer<typeof ResearchPlan>;

export const ResearchFindings = z.object({
  speech: z.string(),
  facts: z.array(
    z.object({
      question: z.string().describe("The question of the research this fact answers."),
      fact: z.string().describe("What the sources say, in one or two sentences, with the figures, versions and dates they give."),
      sources: z.array(z.string()).describe("Ids of the sources the fact rests on, e.g. S1."),
    }),
  ),
});
export type ResearchFindings = z.infer<typeof ResearchFindings>;

/** The researcher's second call, which states what the pages found say: its schema, as the engine sends it. */
export const RESEARCH_FINDINGS = {
  zod: ResearchFindings,
  json: toStrictJsonSchema(ResearchFindings),
  name: "research_findings",
  maxTokens: 6_000,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether this server can search the web, and with what: QUORUMIND_SEARCH, with the key of that engine. */
export function searchKindFromEnv(env: Env): Exclude<SearchKind, "demo"> | null {
  if (env.QUORUMIND_LOCAL_ONLY === "1" || env.QUORUMIND_LOCAL_ONLY === "true") return null;
  const kind = env.QUORUMIND_SEARCH?.trim().toLowerCase();
  if (kind === "openrouter" && env.OPENROUTER_API_KEY) return "openrouter";
  if (kind === "brave" && env.BRAVE_SEARCH_API_KEY) return "brave";
  return null;
}

/**
 * The research limits of this server: QUORUMIND_RESEARCH_MAX_QUERIES (1 to 12, 6 by default) and
 * QUORUMIND_RESEARCH_BUDGET_USD (0.3 by default).
 */
export function researchSettingsFromEnv(env: Env): ResearchSettings {
  const queries = Number(env.QUORUMIND_RESEARCH_MAX_QUERIES);
  const budget = Number(env.QUORUMIND_RESEARCH_BUDGET_USD);
  return {
    maxQueries: Number.isFinite(queries) && queries >= 1 ? clamp(Math.round(queries), 1, MAX_RESEARCH_QUERIES) : DEFAULT_RESEARCH_QUERIES,
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_RESEARCH_BUDGET_USD,
  };
}

/**
 * The search engine of a session: the recorded results for the demo, none for a European-only debate (no engine
 * keeps the queries in Europe) or without configuration, else the configured one.
 */
export function searchFromEnv(env: Env, options: { demo?: boolean; european?: boolean; fetch?: FetchLike } = {}): SearchProvider | null {
  if (options.demo) return new RecordedSearch(demoSearchResults);
  if (options.european) return null;
  const fetchOption = options.fetch ? { fetch: options.fetch } : {};
  switch (searchKindFromEnv(env)) {
    case "openrouter": {
      const engine = env.QUORUMIND_SEARCH_ENGINE?.trim().toLowerCase();
      return new OpenRouterSearch({
        apiKey: env.OPENROUTER_API_KEY ?? "",
        ...(env.QUORUMIND_SEARCH_MODEL ? { model: env.QUORUMIND_SEARCH_MODEL.trim() } : {}),
        ...(engine && engine in OPENROUTER_SEARCH_ENGINES ? { engine: engine as OpenRouterSearchEngine } : {}),
        ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
        ...fetchOption,
      });
    }
    case "brave": {
      const price = Number(env.BRAVE_SEARCH_PRICE_USD);
      return new BraveSearch({
        apiKey: env.BRAVE_SEARCH_API_KEY ?? "",
        priceUsd: Number.isFinite(price) && price >= 0 && env.BRAVE_SEARCH_PRICE_USD?.trim() ? price : BRAVE_SEARCH_PRICE_USD,
        ...(env.BRAVE_SEARCH_BASE_URL ? { baseUrl: env.BRAVE_SEARCH_BASE_URL } : {}),
        ...fetchOption,
      });
    }
    default:
      return null;
  }
}

/**
 * Web research on a server, for the interface: the engine it searches with (null: none is configured, research is
 * off), and whether a new session has it ticked. A European-only debate never searches, whatever this says.
 */
export interface ResearchAvailability {
  kind: Exclude<SearchKind, "demo"> | null;
  default: boolean;
}

/** Web research on this server: on by default once an engine is configured, unless `defaultOn` says otherwise. */
export function researchAvailability(env: Env, defaultOn = true): ResearchAvailability {
  const kind = searchKindFromEnv(env);
  return { kind, default: kind !== null && defaultOn };
}

/** A query as typed, compared without case, spacing or punctuation: the cache key of a search. */
export function queryKey(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.+#]+/gu, " ")
    .trim();
}

/**
 * The query sent to the search engine, or null when it must not be: too long, or carrying something of the person
 * (personal data the masking finds, the project's or the organisation's name). Quotes and line breaks are dropped.
 */
export function cleanQuery(query: string, session: Pick<Session, "sheet" | "profile">): string | null {
  const text = query
    .replace(/[\r\n\t"“”«»<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > MAX_QUERY_CHARS || text.split(" ").length > MAX_QUERY_WORDS) return null;
  if (redact(text) !== text) return null;
  const lower = text.toLowerCase();
  const names = [session.sheet?.projectName, session.profile?.name].map((name) => name?.trim().toLowerCase() ?? "");
  if (names.some((name) => name.length >= 4 && lower.includes(name))) return null;
  return text;
}

/** The research of a session, from the plan of its researcher: clean, distinct queries, as many as allowed. */
export function plannedQueries(plan: ResearchPlan, session: Pick<Session, "sheet" | "profile">, maxQueries: number): ResearchQuery[] {
  const seen = new Set<string>();
  const queries: ResearchQuery[] = [];
  for (const item of plan.queries) {
    const query = cleanQuery(item.query, session);
    const question = item.question.replace(/\s+/g, " ").trim();
    if (!query || !question) continue;
    const key = queryKey(query);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ question, query, topic: item.topic, searchedAt: null, sources: [], error: null });
    if (queries.length >= maxQueries) break;
  }
  return queries;
}

/** The facts of the findings that rest on sources the research did find: unknown ids are dropped, then facts without any. */
export function settleResearchFacts(findings: ResearchFindings, sources: Source[]): ResearchFact[] {
  const known = new Set(sources.map((source) => source.id));
  return findings.facts
    .flatMap((item) => {
      const cited = [...new Set(item.sources.map((id) => id.trim().toUpperCase()).filter((id) => known.has(id)))];
      const fact = item.fact.replace(/\s+/g, " ").trim();
      return cited.length > 0 && fact ? [{ question: item.question.trim(), fact, sources: cited }] : [];
    })
    .map((fact, index) => ({ id: `F${index + 1}`, ...fact }));
}

/** The sources the facts of the research rest on: what the participants read, and what a claim may cite. */
export function citedSources(session: Pick<Session, "research" | "sources">): Source[] {
  const cited = new Set((session.research?.facts ?? []).flatMap((fact) => fact.sources));
  return (session.sources ?? []).filter((source) => cited.has(source.id));
}

/**
 * Keeps the claims of a verdict honest: a claim cites only sources the research found, and one marked "verified"
 * without any is downgraded to "estimated". Claims stored before sources existed get an empty list.
 */
export function settleClaims(verdict: Verdict, sources: Pick<Source, "id">[]): void {
  const known = new Set(sources.map((source) => source.id));
  for (const claim of verdict.claims) {
    const cited = [...new Set((claim.sources ?? []).map((id) => id.trim().toUpperCase()).filter((id) => known.has(id)))];
    claim.sources = cited;
    if (claim.confidence === "verified" && cited.length === 0) claim.confidence = "estimated";
  }
}

/** True when the debate still has to do its research: it was asked for and has not finished. */
export function needsResearch(session: Pick<Session, "webResearch" | "research">): boolean {
  return session.webResearch !== null && (session.research === null || session.research.status === "running");
}

/** What the research may still spend: its own budget, within its share of the session's cap. */
export function researchBudget(session: Pick<Session, "webResearch" | "budgetUsd">): number {
  const own = session.webResearch?.budgetUsd ?? Number.POSITIVE_INFINITY;
  const share = session.budgetUsd === null ? Number.POSITIVE_INFINITY : session.budgetUsd * RESEARCH_CAP_SHARE;
  return Math.min(own, share);
}

/** What the research spent: its searches and the researcher's calls. */
export function researchSpent(session: Pick<Session, "usage">): number {
  return session.usage.reduce(
    (sum, record) =>
      sum + ((record.task === "research" || record.task === "search") && record.revision === undefined ? (record.costUsd ?? 0) : 0),
    0,
  );
}

/**
 * What a session's research should cost at most, in US dollars, for the estimate shown before a debate: every
 * search, and the researcher's two calls. Null when the researcher's price is unknown.
 */
export function estimateResearchCost(plan: { researcherModel: string; maxQueries: number; searchUsd: number }): number | null {
  const call = typicalCallCost(plan.researcherModel, "research");
  if (call === null) return null;
  return 2 * call + plan.maxQueries * plan.searchUsd;
}

const date = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);

/** The facts the participants read, each with the ids of its sources, then the sources; "" without any. */
export function researchBlock(session: Pick<Session, "research" | "sources">): string {
  const research = session.research;
  if (!research || research.facts.length === 0) return "";
  const sources = citedSources(session);
  const body = [
    `Found on the web on ${date(research.finishedAt ?? research.startedAt)}. Facts, with the ids of their sources:`,
    ...research.facts.map((fact) => `- ${fact.fact} [${fact.sources.join(", ")}] (question: ${fact.question})`),
    "",
    "Sources:",
    ...sources.map((source) => `- ${source.id}: ${source.title}, ${source.url} (retrieved ${date(source.retrievedAt)})`),
  ];
  return fence("research", body.join("\n"));
}

/** The pages a search found, for the researcher who states the facts: their id, title, address and excerpt. */
export function sourcesBlock(research: ResearchRecord, sources: Source[]): string {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const body = research.queries
    .filter((query) => query.sources.length > 0)
    .map((query) =>
      [
        `Question: ${query.question}`,
        ...query.sources.flatMap((id) => {
          const source = byId.get(id);
          return source ? [`- ${source.id}: ${source.title} (${source.url})\n  ${source.snippet}`] : [];
        }),
      ].join("\n"),
    )
    .join("\n\n");
  return fence("sources", body);
}

/** What each role is told about the research, appended to its instructions like the compliance rules. */
export function researchRule(session: Pick<Session, "research">, role: "design" | "critique" | "arbiter"): string {
  const facts = (session.research?.facts.length ?? 0) > 0;
  if (role === "arbiter") {
    return facts
      ? `\n\nFacts in <research> were found on the web when the debate started, each with the ids of its sources (S1, S2…).
Weigh them over what the proposals or your memory say about prices, versions, end-of-life dates, regulations and vendor limits.
Mark a claim "verified" only when a fact of <research> supports it, and list in its sources the ids of that fact's sources.
Mark every other claim "estimated" or "assumed", with empty sources: a "verified" claim without a source is downgraded.`
      : `\n\nNo web research was done for this debate, so no claim can be verified against a source:
mark every claim "estimated" or "assumed", with empty sources.`;
  }
  if (!facts) return "";
  return role === "design"
    ? `\n\nFacts in <research> were found on the web when the debate started, each with the ids of its sources. Prefer them to what you
remember when they differ (prices, current versions, end-of-life dates, regulations, vendor limits), and cite the ids in brackets, e.g. [S2],
where your option relies on one.`
    : `\n\nFacts in <research> were found on the web when the debate started, each with the ids of its sources. Check the options against
them: an option that relies on an outdated price, version or rule deserves a critique; cite the ids in brackets, e.g. [S2].`;
}

// The recorded research of the demo: the questions the debate on the yoga studios' app depends on, the pages found
// for them and what they say. Recorded once; the demo and the tests replay it.

export const DEMO_RESEARCH_DATE = "2026-06-15T09:00:00.000Z";

const DEMO_PAGES: { match: RegExp; hit: { url: string; title: string; snippet: string } }[] = [
  {
    match: /stripe/i,
    hit: {
      url: "https://stripe.com/fr/pricing",
      title: "Stripe pricing (France)",
      snippet: "Standard pricing: 1.5% + €0.25 for standard European Economic Area cards, with no setup or monthly fees.",
    },
  },
  {
    match: /postgres/i,
    hit: {
      url: "https://www.postgresql.org/support/versioning/",
      title: "PostgreSQL: Versioning Policy",
      snippet:
        "PostgreSQL 18, first released in September 2025, is supported until November 2030; each major version is supported for 5 years.",
    },
  },
  {
    match: /node/i,
    hit: {
      url: "https://nodejs.org/en/about/previous-releases",
      title: "Node.js Releases",
      snippet: "Node.js 24 is the Active LTS release line; it is maintained until April 2028.",
    },
  },
  {
    match: /gdpr|processor/i,
    hit: {
      url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
      title: "Regulation (EU) 2016/679 (General Data Protection Regulation)",
      snippet:
        "Article 28: processing by a processor shall be governed by a contract that sets out the subject matter, duration, nature and purpose of the processing.",
    },
  },
];

/** The recorded pages of the demo for a query: the one page that matches it, or none. */
export function demoSearchResults(query: string) {
  const page = DEMO_PAGES.find((entry) => entry.match.test(query));
  return page ? [{ ...page.hit, retrievedAt: DEMO_RESEARCH_DATE }] : [];
}

export const DEMO_RESEARCH_PLAN: ResearchPlan = {
  speech:
    "Before the proposals, I am checking four facts the options will rest on: the card fees, the support dates of the database and of the runtime, and the GDPR rule on processors.",
  queries: [
    { question: "What does Stripe charge per card payment in the EU?", query: "Stripe pricing European cards fees", topic: "pricing" },
    {
      question: "Until when is the current PostgreSQL major version supported?",
      query: "PostgreSQL versioning policy end of life current version",
      topic: "end_of_life",
    },
    {
      question: "Which Node.js version is the current LTS, and until when?",
      query: "Node.js release schedule LTS end of life",
      topic: "version",
    },
    {
      question: "What does the GDPR require from a processor?",
      query: "GDPR article 28 processor contract requirements",
      topic: "regulation",
    },
  ],
};

export const DEMO_RESEARCH_FINDINGS: ResearchFindings = {
  speech: "Four facts found, each from the page that states it: the card fees, two support dates and the processor contract.",
  facts: [
    {
      question: "What does Stripe charge per card payment in the EU?",
      fact: "Stripe charges 1.5% + €0.25 per payment with a standard EEA card, without setup or monthly fees.",
      sources: ["S1"],
    },
    {
      question: "Until when is the current PostgreSQL major version supported?",
      fact: "PostgreSQL 18 (September 2025) is supported until November 2030.",
      sources: ["S2"],
    },
    {
      question: "Which Node.js version is the current LTS, and until when?",
      fact: "Node.js 24 is the active LTS line, maintained until April 2028.",
      sources: ["S3"],
    },
    {
      question: "What does the GDPR require from a processor?",
      fact: "Every processor of personal data must sign a contract that sets out the processing (GDPR, article 28).",
      sources: ["S4"],
    },
  ],
};
