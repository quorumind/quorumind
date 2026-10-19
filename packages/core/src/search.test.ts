import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BraveSearch, OpenRouterSearch, openRouterCitations } from "./search.ts";

const recorded = JSON.parse(readFileSync(join(import.meta.dirname, "testdata", "openrouter-web-search.json"), "utf8")) as {
  query: string;
  response: Record<string, unknown>;
};

/** A fetch that answers with this body and remembers what it was asked. */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("OpenRouter web search", () => {
  it("reads the cited pages from the url_citation annotations, once each, with an excerpt", async () => {
    const { fetch, calls } = fakeFetch(recorded.response);
    const search = new OpenRouterSearch({ apiKey: "key", fetch });
    const result = await search.search(recorded.query);

    expect(result.hits).toEqual([
      {
        url: "https://www.postgresql.org/support/versioning/",
        title: "PostgreSQL: Versioning Policy",
        snippet: expect.stringContaining("supports a major version for 5 years"),
      },
      {
        url: "https://aws.amazon.com/rds/postgresql/",
        title: "Amazon RDS for PostgreSQL",
        // No excerpt from OpenRouter: the sentence that cites the page, without the link.
        snippet: "Managed offers follow the same calendar",
      },
    ]);
    // usage.cost is what the account was charged, the search included.
    expect(result.costUsd).toBe(0.00794);
    expect(result.usage).toEqual({ inputTokens: 3120, outputTokens: 96 });
    expect(result.model).toBe("openrouter:exa:google/gemini-3.8-flash");

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.plugins).toEqual([{ id: "web", engine: "exa", max_results: 4 }]);
    expect(body.stream).toBe(false);
    expect(body.provider).toEqual({ data_collection: "deny" });
    // The query is the only thing of the session that is sent.
    expect(body.messages.at(-1)).toEqual({ role: "user", content: recorded.query });
  });

  it("prices a search from the model and the engine when OpenRouter reports no cost", async () => {
    const response = structuredClone(recorded.response) as { usage: { cost?: number } };
    delete response.usage.cost;
    const { fetch } = fakeFetch(response);
    const result = await new OpenRouterSearch({ apiKey: "key", engine: "parallel", fetch }).search("query");
    // The reading model's price is unknown here: the cost is not guessed.
    expect(result.costUsd).toBeNull();
  });

  it("keeps web pages only and cuts long excerpts", () => {
    const hits = openRouterCitations({
      choices: [
        {
          message: {
            content: "x",
            annotations: [
              { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "bad" } },
              { type: "url_citation", url_citation: { url: "https://example.com/a", title: "", content: "y".repeat(2_000) } },
            ],
          },
        },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("example.com");
    expect(hits[0]?.snippet.length).toBeLessThanOrEqual(600);
  });

  it("explains a rejected key and an unavailable service", async () => {
    await expect(new OpenRouterSearch({ fetch: fakeFetch({ error: { message: "no" } }, 401).fetch }).search("q")).rejects.toMatchObject({
      code: "provider_auth",
      retryable: false,
    });
    await expect(new OpenRouterSearch({ fetch: fakeFetch({ error: { message: "busy" } }, 503).fetch }).search("q")).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

describe("Brave web search", () => {
  it("reads the results, sends the key in its header and prices the request", async () => {
    const { fetch, calls } = fakeFetch({
      web: {
        results: [
          {
            url: "https://nodejs.org/en/about/previous-releases",
            title: "<strong>Node.js</strong> Releases",
            description: "Node.js 24 is the <strong>Active LTS</strong> line &amp; is maintained until April 2028.",
            extra_snippets: ["Major versions enter Active LTS in October."],
          },
          { url: "ftp://example.com", title: "Not a page" },
        ],
      },
    });
    const result = await new BraveSearch({ apiKey: "brave-key", fetch }).search("Node.js release schedule");
    expect(result.hits).toEqual([
      {
        url: "https://nodejs.org/en/about/previous-releases",
        title: "Node.js Releases",
        snippet: "Node.js 24 is the Active LTS line & is maintained until April 2028. … Major versions enter Active LTS in October.",
      },
    ]);
    expect(result.costUsd).toBe(0.005);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("Node.js release schedule");
    expect(new Headers(calls[0]?.init?.headers).get("x-subscription-token")).toBe("brave-key");
  });
});
