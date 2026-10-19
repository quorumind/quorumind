import { costOf } from "./pricing.ts";
import { errorMessage, type FetchLike, isAbort } from "./providers/http.ts";
import { OPENROUTER_BASE_URL } from "./providers/openrouter.ts";
import { ProviderError, providerErrorCode } from "./providers/types.ts";

// Web search for the research step: a short, generic query in, a few pages out (address, title, excerpt), with what
// the search cost. Only the query leaves Quorumind: never the requirements, the documents or anything about the person.

/** Where the research step searches the web: OpenRouter's web plugin, the Brave Search API, or the recorded demo. */
export type SearchKind = "openrouter" | "brave" | "demo";

/** One page a search found. */
export interface SearchHit {
  url: string;
  title: string;
  /** What the page says on the query: the excerpt the engine returned, cut to MAX_SNIPPET_CHARS. */
  snippet: string;
  /** When the content was captured, for a recorded result; absent for a live search (it is now). */
  retrievedAt?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** What the search cost in US dollars; null when unknown. */
  costUsd: number | null;
  /** Tokens of the model that read the results, for a search made through a model (OpenRouter). */
  usage: { inputTokens: number; outputTokens: number };
  /** The model or the engine that served the search, as the usage records name it. */
  model: string;
}

export interface SearchProvider {
  readonly kind: SearchKind;
  /** The engine as the usage records and the report name it, e.g. "openrouter:exa" or "brave". */
  readonly name: string;
  /** What one search should cost in US dollars, to keep the research within its budget. */
  readonly estimateUsd: number;
  search(query: string, options?: { maxResults?: number; signal?: AbortSignal }): Promise<SearchResult>;
}

export const MAX_SNIPPET_CHARS = 600;
/** Pages kept per query: enough to cross-check a fact, few enough to keep the findings call short. */
export const MAX_RESULTS_PER_QUERY = 4;

/** OpenRouter's web search engines with a documented price per request (US dollars, up to 10 results). */
export const OPENROUTER_SEARCH_ENGINES = { exa: 0.007, parallel: 0.005 } as const;
export type OpenRouterSearchEngine = keyof typeof OPENROUTER_SEARCH_ENGINES;

/** A cheap, fast model that reads the results of each search; any OpenRouter model id works (QUORUMIND_SEARCH_MODEL). */
export const DEFAULT_SEARCH_MODEL = "google/gemini-3.8-flash";
/** Brave Search API: US dollars per request of its Search plan. */
export const BRAVE_SEARCH_PRICE_USD = 0.005;
export const BRAVE_SEARCH_BASE_URL = "https://api.search.brave.com";

const clip = (text: string, max = MAX_SNIPPET_CHARS) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Only web pages: an engine that returns another scheme, or no address, gives no source. */
function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Hits without repeats: the same page cited twice is kept once, with its first excerpt. */
function uniqueHits(hits: SearchHit[], max: number): SearchHit[] {
  const seen = new Set<string>();
  return hits
    .filter((hit) => {
      const key = hit.url.replace(/#.*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function searchError(response: Response, engine: string, message: string): ProviderError {
  const status = response.status;
  const code = providerErrorCode(status);
  if (status === 401 || status === 403) return new ProviderError(`The ${engine} key was rejected.`, false, { code });
  const retryable = status === 408 || status === 429 || status >= 500;
  return new ProviderError(`${engine} search failed (${status}): ${message}`, retryable, { code });
}

/** A search that has not answered after this long fails: the research goes on without it. */
export const SEARCH_TIMEOUT_MS = 30_000;

/** One search request, cancelled with the caller's signal or after its timeout, which `failure` tells apart. */
function searchCall(engine: string, signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    failure(error: unknown, what: string): ProviderError {
      if (timeout.aborted && !signal?.aborted) {
        return new ProviderError(`${engine} did not answer within ${Math.round(timeoutMs / 1000)} s.`, true, {
          cause: error,
          code: "provider_unavailable",
        });
      }
      if (isAbort(error, signal)) return new ProviderError("The search was cancelled.", false, { cause: error });
      return new ProviderError(what, true, { cause: error, code: "provider_unavailable" });
    },
  };
}

async function send(fetchImpl: FetchLike, url: string, init: RequestInit, call: ReturnType<typeof searchCall>, engine: string) {
  try {
    return await fetchImpl(url, { ...init, signal: call.signal });
  } catch (error) {
    throw call.failure(error, `Could not reach ${engine}.`);
  }
}

/** The JSON body of a search answer, read within the same timeout. */
async function bodyOf<T>(response: Response, call: ReturnType<typeof searchCall>, engine: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw call.failure(error, `${engine}'s search answer is not valid JSON.`);
  }
}

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string; start_index?: number; end_index?: number };
}

interface OpenRouterCompletion {
  model?: string;
  choices?: { message?: { content?: string | null; annotations?: OpenRouterAnnotation[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number | string; message?: string };
}

/** A markdown link the model wrote to cite a page, with the parentheses around it: "([example.com](https://…))". */
const MARKDOWN_LINK = /\(?\[[^\]]*\]\([^)]*\)\)?/g;

/** The sentence of an answer that ends where a citation starts, without its links. */
function citingSentence(content: string, start: number): string {
  const before = content.slice(0, start).replace(MARKDOWN_LINK, "").trimEnd();
  return (before.split(/(?<=[.!?])\s+/).at(-1) ?? "").replace(/[\s(]+$/, "");
}

/**
 * The pages an OpenRouter answer cites: its url_citation annotations, each with the excerpt OpenRouter adds when it
 * has one, else the sentence of the answer that cites the page.
 */
export function openRouterCitations(completion: OpenRouterCompletion, max = MAX_RESULTS_PER_QUERY): SearchHit[] {
  const message = completion.choices?.[0]?.message;
  const content = message?.content ?? "";
  const hits = (message?.annotations ?? []).flatMap((annotation): SearchHit[] => {
    if (annotation.type !== "url_citation" || !annotation.url_citation) return [];
    const citation = annotation.url_citation;
    const url = webUrl(citation.url);
    if (!url) return [];
    const { start_index: start, end_index: end } = citation;
    const span = typeof start === "number" && typeof end === "number" && end > start ? content.slice(start, end) : "";
    // The span is often the markdown link itself: the excerpt is then the sentence that cites it.
    const cited = span.replace(MARKDOWN_LINK, "").trim() || (typeof start === "number" ? citingSentence(content, start) : "");
    const excerpt = citation.content?.trim() || cited || content.replace(MARKDOWN_LINK, "");
    return [{ url, title: clip(citation.title?.trim() || hostOf(url), 200), snippet: clip(excerpt) }];
  });
  return uniqueHits(hits, max);
}

export interface OpenRouterSearchOptions {
  apiKey?: string;
  /** The model that reads the results; DEFAULT_SEARCH_MODEL when not set. */
  model?: string;
  engine?: OpenRouterSearchEngine;
  baseUrl?: string;
  fetch?: FetchLike;
  /** SEARCH_TIMEOUT_MS unless set. */
  timeoutMs?: number;
}

/**
 * Web search through OpenRouter's web plugin (`plugins: [{ id: "web" }]`): the engine (Exa by default, set explicitly
 * so that no model's native search is used instead) runs the query, a small model reads the results, and the pages
 * come back as url_citation annotations. The reported cost (usage.cost, what the account was charged) includes the
 * search; when it is missing, the model's price plus the engine's documented price per request is used.
 */
export class OpenRouterSearch implements SearchProvider {
  readonly kind = "openrouter" as const;
  readonly name: string;
  readonly estimateUsd: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly engine: OpenRouterSearchEngine;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: OpenRouterSearchOptions = {}) {
    this.apiKey = options.apiKey ?? "";
    this.model = options.model || DEFAULT_SEARCH_MODEL;
    this.engine = options.engine ?? "exa";
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
    this.name = `openrouter:${this.engine}`;
    // The engine's price, and the reading model's share: the results it reads and a short answer.
    this.estimateUsd = OPENROUTER_SEARCH_ENGINES[this.engine] + (costOf(this.model, { inputTokens: 4_000, outputTokens: 400 }) ?? 0.003);
  }

  async search(query: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<SearchResult> {
    const maxResults = options.maxResults ?? MAX_RESULTS_PER_QUERY;
    const body = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "Summarise in at most three sentences what the web results say about the query: give prices, versions and dates exactly as the pages state them, and cite the pages.",
        },
        { role: "user", content: query },
      ],
      max_tokens: 400,
      stream: false,
      plugins: [{ id: "web", engine: this.engine, max_results: maxResults }],
      provider: { data_collection: "deny" },
    };
    const call = searchCall("OpenRouter", options.signal, this.timeoutMs);
    const response = await send(
      this.fetch,
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://quorumind.com",
          "X-OpenRouter-Title": "Quorumind",
        },
        body: JSON.stringify(body),
      },
      call,
      "OpenRouter",
    );
    if (!response.ok) throw searchError(response, "OpenRouter", await errorMessage(response));
    const completion = await bodyOf<OpenRouterCompletion>(response, call, "OpenRouter");
    if (completion.error) {
      const status = typeof completion.error.code === "number" ? completion.error.code : 500;
      throw new ProviderError(`OpenRouter search failed: ${completion.error.message ?? "unknown error"}`, status >= 500 || status === 429, {
        code: providerErrorCode(status),
      });
    }
    const model = completion.model ?? this.model;
    const usage = { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
    const reported = completion.usage?.cost;
    const tokens = costOf(model, usage) ?? costOf(this.model, usage);
    const costUsd = typeof reported === "number" ? reported : tokens === null ? null : tokens + OPENROUTER_SEARCH_ENGINES[this.engine];
    return { hits: openRouterCitations(completion, maxResults), costUsd, usage, model: `${this.name}:${model}` };
  }
}

interface BraveResponse {
  web?: { results?: { url?: string; title?: string; description?: string; extra_snippets?: string[] }[] };
}

// Brave marks the query's words in titles and descriptions with <strong>; entities are kept as text.
const plain = (text: string | undefined) =>
  (text ?? "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

export interface BraveSearchOptions {
  apiKey: string;
  /** US dollars per request, BRAVE_SEARCH_PRICE_USD unless the plan says otherwise. */
  priceUsd?: number;
  baseUrl?: string;
  fetch?: FetchLike;
  /** SEARCH_TIMEOUT_MS unless set. */
  timeoutMs?: number;
}

/** The Brave Search API (web search): the pages and their excerpts, priced per request. For a self-hosted server. */
export class BraveSearch implements SearchProvider {
  readonly kind = "brave" as const;
  readonly name = "brave";
  readonly estimateUsd: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: BraveSearchOptions) {
    this.apiKey = options.apiKey;
    this.estimateUsd = options.priceUsd ?? BRAVE_SEARCH_PRICE_USD;
    this.baseUrl = (options.baseUrl ?? BRAVE_SEARCH_BASE_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  }

  async search(query: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<SearchResult> {
    const maxResults = options.maxResults ?? MAX_RESULTS_PER_QUERY;
    const params = new URLSearchParams({ q: query, count: String(maxResults), safesearch: "moderate", extra_snippets: "true" });
    const call = searchCall("Brave Search", options.signal, this.timeoutMs);
    const response = await send(
      this.fetch,
      `${this.baseUrl}/res/v1/web/search?${params}`,
      { headers: { accept: "application/json", "x-subscription-token": this.apiKey } },
      call,
      "Brave Search",
    );
    if (!response.ok) throw searchError(response, "Brave Search", await errorMessage(response));
    const body = await bodyOf<BraveResponse>(response, call, "Brave Search");
    const hits = (body.web?.results ?? []).flatMap((result): SearchHit[] => {
      const url = webUrl(result.url);
      if (!url) return [];
      const snippet = [plain(result.description), ...(result.extra_snippets ?? []).slice(0, 2).map(plain)].filter(Boolean).join(" … ");
      return [{ url, title: clip(plain(result.title) || hostOf(url), 200), snippet: clip(snippet) }];
    });
    return { hits: uniqueHits(hits, maxResults), costUsd: this.estimateUsd, usage: { inputTokens: 0, outputTokens: 0 }, model: this.name };
  }
}

/** Replays recorded results, by query: the demo and the tests search nothing for real. */
export class RecordedSearch implements SearchProvider {
  readonly kind = "demo" as const;
  readonly name = "demo";
  readonly estimateUsd = 0;
  private readonly results: (query: string) => SearchHit[];

  constructor(results: (query: string) => SearchHit[]) {
    this.results = results;
  }

  async search(query: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<SearchResult> {
    if (options.signal?.aborted) throw new ProviderError("The search was cancelled.", false);
    const hits = this.results(query).slice(0, options.maxResults ?? MAX_RESULTS_PER_QUERY);
    return { hits, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, model: this.name };
  }
}
