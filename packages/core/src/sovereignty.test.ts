import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogFromEnv, DEMO_LINEUP, type ModelOption, providerFor, providersFor } from "./config.ts";
import { renderReport } from "./report.ts";
import { createSession } from "./session.ts";
import {
  EUROPEAN_SOURCES,
  europeanCatalog,
  europeanEndpoint,
  europeanGateway,
  europeanLineup,
  europeanPolicyFromEnv,
  isEuropean,
  isOllamaCloudModel,
  isOnPremisesUrl,
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

  it("says so in the report's method box, with how OpenRouter was reached", () => {
    const session = createSession({ locale: "fr", idea: "Idée", demo: false, ...DEMO_LINEUP, european: { gateway: "global" } });
    const report = renderReport(session);
    expect(report).toContain("Modèles européens uniquement : chaque rôle");
    expect(report).toContain("serveurs mondiaux");
    const english = renderReport({ ...session, locale: "en", european: { gateway: "eu" } });
    expect(english).toContain("European models only: every role was played");
    expect(english).toContain("through its EU region");
    expect(renderReport({ ...session, european: null })).not.toContain("Modèles européens uniquement");
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

describe("Ollama on the premises", () => {
  it("tells the machine and private networks from public addresses", () => {
    for (const url of [
      "http://127.0.0.1:11434",
      "http://localhost:11434",
      "http://ollama:11434",
      "http://10.0.3.7:11434",
      "http://172.20.0.2:11434",
      "http://192.168.1.20:11434",
      "http://gpu.lan:11434",
      "http://[::1]:11434",
      "http://[fd12:3456::1]:11434",
      "http://host.docker.internal:11434",
    ]) {
      expect(isOnPremisesUrl(url), url).toBe(true);
    }
    for (const url of [
      "https://ollama.example.com",
      "http://203.0.113.9:11434",
      "http://172.32.0.1:11434",
      "https://ollama.com",
      "not a url",
    ]) {
      expect(isOnPremisesUrl(url), url).toBe(false);
    }
  });

  it("never counts a model Ollama hosts, nor an Ollama away from the premises, as European", () => {
    expect(isOllamaCloudModel("gpt-oss:120b-cloud")).toBe(true);
    expect(isOllamaCloudModel("qwen3-coder:480b-cloud")).toBe(true);
    expect(isOllamaCloudModel("llama-x")).toBe(false);
    expect(isEuropean({ provider: "ollama", model: "gpt-oss:120b-cloud" })).toBe(false);
    const local = { provider: "ollama" as const, model: "llama-x" };
    expect(isEuropean(local, {})).toBe(true);
    expect(isEuropean(local, { OLLAMA_BASE_URL: "http://192.168.1.20:11434" })).toBe(true);
    expect(isEuropean(local, { OLLAMA_BASE_URL: "https://ollama.example.com" })).toBe(false);
    // A server the organisation runs at a public address, said so explicitly.
    expect(isEuropean(local, { OLLAMA_BASE_URL: "https://ollama.example.com", QUORUMIND_OLLAMA_ON_PREMISES: "1" })).toBe(true);
    const lineup = europeanLineup([option("ollama", "llama-x")])!;
    expect(nonEuropeanModels(lineup, { OLLAMA_BASE_URL: "https://ollama.example.com" })).toEqual(["ollama:llama-x"]);
    // A catalog entry built for a remote Ollama says it is not local: the interface filters it out without the environment.
    expect(europeanCatalog([{ ...option("ollama", "llama-x"), local: false }])).toEqual([]);
  });

  it("marks hosted and remote Ollama models as not local in the catalog", async () => {
    const env = { OLLAMA_MODELS: "llama-x,gpt-oss:120b-cloud" };
    expect((await catalogFromEnv(env)).map((entry) => [entry.model, entry.local])).toEqual([
      ["llama-x", true],
      ["gpt-oss:120b-cloud", false],
    ]);
    const remote = await catalogFromEnv({ ...env, OLLAMA_BASE_URL: "https://ollama.example.com" });
    expect(remote.every((entry) => !entry.local)).toBe(true);
  });
});
