import { afterEach, describe, expect, it, vi } from "vitest";
import { type ModelOption, providerFor, providersFor } from "./config.ts";
import {
  EUROPEAN_SOURCES,
  europeanCatalog,
  europeanEndpoint,
  europeanGateway,
  europeanLineup,
  europeanPolicyFromEnv,
  isEuropean,
  nonEuropeanModels,
} from "./sovereignty.ts";

const option = (provider: ModelOption["provider"], model: string, maker?: string): ModelOption => ({
  provider,
  model,
  label: model,
  local: provider === "ollama",
  ...(maker ? { maker } : {}),
});

const CATALOG: ModelOption[] = [
  option("anthropic", "claude-opus-5-5"),
  option("openrouter", "openai/gpt-6.1-sol", "OpenAI"),
  option("openrouter", "mistralai/mistral-large-4-0", "Mistral"),
  option("openrouter", "mistralai/mistral-medium-3-5", "Mistral"),
  option("gemini", "gemini-4-argon"),
  option("ollama", "llama-x"),
];

describe("European models only", () => {
  it("counts Mistral AI through OpenRouter, local models and the demo as European, and nothing else", () => {
    expect(isEuropean({ provider: "openrouter", model: "mistralai/mistral-large-4-0" })).toBe(true);
    expect(isEuropean({ provider: "ollama", model: "llama-x" })).toBe(true);
    expect(isEuropean({ provider: "mock", model: "mock" })).toBe(true);
    expect(isEuropean({ provider: "openrouter", model: "openai/gpt-6.1-sol" })).toBe(false);
    // A model id that merely contains the maker's name is not one of its models.
    expect(isEuropean({ provider: "openrouter", model: "someone/mistralai-finetune" })).toBe(false);
    expect(isEuropean({ provider: "anthropic", model: "claude-opus-5-5" })).toBe(false);
    expect(isEuropean({ provider: "gemini", model: "gemini-4-argon" })).toBe(false);
    for (const source of EUROPEAN_SOURCES) expect(source.reason.length).toBeGreaterThan(20);
  });

  it("filters the catalog, in its order", () => {
    expect(europeanCatalog(CATALOG).map((entry) => entry.model)).toEqual([
      "mistralai/mistral-large-4-0",
      "mistralai/mistral-medium-3-5",
      "llama-x",
    ]);
  });

  it("builds a default lineup of European models, two different makers when it can", () => {
    expect(europeanLineup(CATALOG)).toEqual({
      interviewer: { provider: "openrouter", model: "mistralai/mistral-large-4-0" },
      arbiter: { provider: "openrouter", model: "mistralai/mistral-large-4-0" },
      seats: {
        A: { provider: "openrouter", model: "mistralai/mistral-large-4-0", persona: null },
        B: { provider: "ollama", model: "llama-x", persona: null },
      },
      devil: null,
    });
    // One maker only: another of its models takes the second seat.
    const mistral = europeanLineup(CATALOG.slice(0, 4));
    expect(mistral?.seats.B?.model).toBe("mistralai/mistral-medium-3-5");
    expect(europeanLineup(CATALOG.slice(0, 2))).toBeNull();
  });

  it("names the models of a lineup that are not European, devil's advocate included", () => {
    const lineup = europeanLineup(CATALOG);
    if (!lineup) throw new Error("no lineup");
    expect(nonEuropeanModels(lineup)).toEqual([]);
    const mixed = { ...lineup, devil: { provider: "anthropic" as const, model: "claude-opus-5-5", persona: null } };
    expect(nonEuropeanModels(mixed)).toEqual(["anthropic:claude-opus-5-5"]);
  });

  it("reads the self-hosted policy from QUORUMIND_EUROPEAN_ONLY", () => {
    expect(europeanPolicyFromEnv({})).toBeNull();
    expect(europeanPolicyFromEnv({ QUORUMIND_EUROPEAN_ONLY: "1" })).toBe("default");
    expect(europeanPolicyFromEnv({ QUORUMIND_EUROPEAN_ONLY: "true" })).toBe("default");
    expect(europeanPolicyFromEnv({ QUORUMIND_EUROPEAN_ONLY: "required" })).toBe("required");
    expect(europeanPolicyFromEnv({ QUORUMIND_EUROPEAN_ONLY: "0" })).toBeNull();
  });

  it("tells whether OpenRouter is reached through its EU region", () => {
    const lineup = europeanLineup(CATALOG.slice(0, 4));
    if (!lineup) throw new Error("no lineup");
    expect(europeanGateway(lineup, {})).toBe("global");
    expect(europeanGateway(lineup, { OPENROUTER_EU_BASE_URL: "https://eu.openrouter.ai/api/v1" })).toBe("eu");
    expect(europeanGateway(lineup, { OPENROUTER_BASE_URL: "https://eu.openrouter.ai/api/v1" })).toBe("eu");
    expect(europeanGateway(lineup, { OPENROUTER_BASE_URL: "not a url" })).toBe("global");
    const local = europeanLineup([option("ollama", "llama-x")]);
    if (!local) throw new Error("no lineup");
    expect(europeanGateway(local, {})).toBeNull();
    expect(europeanEndpoint({ provider: "openrouter", model: "mistralai/mistral-large-4-0" })).toBe("mistral/eu");
    expect(europeanEndpoint({ provider: "ollama", model: "llama-x" })).toBeNull();
  });
});

describe("European routing of OpenRouter requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stream = () =>
    new Response(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: '{"speech":"ok"}' }, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  const request = { task: "proposal" as const, seat: "A", system: "s", messages: [], schema: {}, schemaName: "proposal", maxTokens: 10 };

  it("pins a European-only request to the maker's EU endpoint, through the EU address when one is set", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => stream());
    vi.stubGlobal("fetch", fetchMock);
    const env = { OPENROUTER_API_KEY: "key", OPENROUTER_EU_BASE_URL: "https://eu.openrouter.ai/api/v1" };
    const mistral = { provider: "openrouter" as const, model: "mistralai/mistral-large-4-0" };

    await providerFor(mistral, env, { european: true }).generate(request);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String(init?.body)).provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      only: ["mistral/eu"],
      allow_fallbacks: false,
    });

    // Without European-only, the same model goes through the usual address and routing.
    await providerFor(mistral, env).generate(request);
    const [plainUrl, plainInit] = fetchMock.mock.calls[1] ?? [];
    expect(plainUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String(plainInit?.body)).provider).toEqual({ require_parameters: true, data_collection: "deny" });
  });

  it("routes every role of a European-only session", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => stream());
    vi.stubGlobal("fetch", fetchMock);
    const lineup = europeanLineup(CATALOG.slice(0, 4));
    if (!lineup) throw new Error("no lineup");
    const providers = providersFor({ ...lineup, european: { gateway: "global" } }, { OPENROUTER_API_KEY: "key" });
    await providers.arbiter.generate(request);
    await providers.proposers.B?.generate(request);
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(String(init?.body)).provider.only).toEqual(["mistral/eu"]);
  });
});
