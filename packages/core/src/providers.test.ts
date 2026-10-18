import { describe, expect, it, vi } from "vitest";
import { catalogFromEnv, liveLineupFromEnv, providersFor } from "./config.ts";
import { costOf, priceOf } from "./pricing.ts";
import { GeminiProvider } from "./providers/gemini.ts";
import type { FetchLike } from "./providers/http.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import { OpenRouterProvider } from "./providers/openrouter.ts";
import { type GenerateRequest, ProviderError } from "./providers/types.ts";

const SCHEMA = { type: "object", properties: { speech: { type: "string" } }, required: ["speech"], additionalProperties: false };

const request: GenerateRequest = {
  task: "proposal",
  seat: "A",
  system: "You are a proposer.",
  messages: [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Propose." },
  ],
  schema: SCHEMA,
  schemaName: "proposal",
  maxTokens: 1_000,
};

/** A streamed response whose body arrives in the given pieces. */
function streamed(pieces: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, init);
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<FetchLike>(async () => respond());
}

function sentBody(fetchMock: ReturnType<typeof fakeFetch>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

const sse = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\r\n\r\n`;

describe("GeminiProvider", () => {
  const answer = [
    sse({ candidates: [{ content: { parts: [{ text: "Planning...", thought: true }] } }] }),
    sse({ candidates: [{ content: { parts: [{ text: '{"speech":' }] } }], modelVersion: "gemini-test-001" }),
    // A chunk split across two network reads.
    sse({
      candidates: [{ content: { parts: [{ text: '"hello"}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50 },
    }).replace(/(.{20})/, "$1\u0000"),
  ].flatMap((piece) => piece.split("\u0000"));

  it("streams the answer, skipping thoughts, and reports usage", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const provider = new GeminiProvider({ model: "gemini-test", apiKey: "key", fetch: fetchMock });
    const deltas: string[] = [];
    const result = await provider.generate(request, (delta) => deltas.push(delta));

    expect(deltas).toEqual(['{"speech":', '"hello"}']);
    expect(result).toEqual({ text: '{"speech":"hello"}', model: "gemini-test-001", usage: { inputTokens: 120, outputTokens: 80 } });
  });

  it("sends the system prompt, the conversation and the schema as is", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const signal = new AbortController().signal;
    await new GeminiProvider({ model: "gemini-test", apiKey: "key", fetch: fetchMock }).generate({ ...request, signal });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "key" });
    expect(init?.signal).toBe(signal);
    expect(sentBody(fetchMock)).toEqual({
      systemInstruction: { parts: [{ text: "You are a proposer." }] },
      contents: [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "Propose." }] },
      ],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, maxOutputTokens: 1_000 },
    });
  });

  it.each([
    [400, false, /Gemini rejected the request: Bad schema/, "provider_error"],
    [401, false, /The Gemini API key was rejected\./, "provider_auth"],
    [403, false, /The Gemini API key was rejected\./, "provider_auth"],
    [429, true, /unavailable/, "provider_rate_limit"],
    [503, true, /unavailable/, "provider_unavailable"],
  ])("maps HTTP %i to a ProviderError (retryable: %s)", async (status, retryable, message, code) => {
    const fetchMock = fakeFetch(() => Response.json({ error: { code: status, message: "Bad schema" } }, { status }));
    const error = await rejection(new GeminiProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(retryable);
    expect(error.message).toMatch(message);
    expect(error.code).toBe(code);
  });

  it("retries after a network failure", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await rejection(new GeminiProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(true);
  });

  it("retries an answer cut off by the token limit", async () => {
    const fetchMock = fakeFetch(() =>
      streamed([sse({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] })]),
    );
    const error = await rejection(new GeminiProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/incomplete/);
  });

  it("does not retry a blocked answer or prompt", async () => {
    const blocked = fakeFetch(() => streamed([sse({ candidates: [{ finishReason: "SAFETY" }] })]));
    expect(await rejection(new GeminiProvider({ model: "m", fetch: blocked }).generate(request))).toMatchObject({
      retryable: false,
      code: "provider_refused",
    });
    const prompt = fakeFetch(() => streamed([sse({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })]));
    expect(await rejection(new GeminiProvider({ model: "m", fetch: prompt }).generate(request))).toMatchObject({
      retryable: false,
      code: "provider_refused",
    });
  });
});

const ndjson = (line: unknown) => `${JSON.stringify(line)}\n`;

describe("OllamaProvider", () => {
  const answer = [
    ndjson({ model: "llama-test", message: { role: "assistant", content: '{"speech":' }, done: false }),
    ndjson({ model: "llama-test", message: { role: "assistant", content: '"hi"}' }, done: false }).slice(0, 10),
    ndjson({ model: "llama-test", message: { role: "assistant", content: '"hi"}' }, done: false }).slice(10),
    ndjson({
      model: "llama-test",
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 42,
      eval_count: 7,
    }),
  ];

  it("streams the answer and reports usage", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const deltas: string[] = [];
    const result = await new OllamaProvider({ model: "llama-test", fetch: fetchMock }).generate(request, (delta) => deltas.push(delta));
    expect(deltas).toEqual(['{"speech":', '"hi"}']);
    expect(result).toEqual({ text: '{"speech":"hi"}', model: "llama-test", usage: { inputTokens: 42, outputTokens: 7 } });
  });

  it("sends the schema as the format and the system prompt first", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    await new OllamaProvider({ model: "llama-test", baseUrl: "http://gpu-box:11434/", fetch: fetchMock }).generate(request);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://gpu-box:11434/api/chat");
    expect(sentBody(fetchMock)).toEqual({
      model: "llama-test",
      messages: [{ role: "system", content: "You are a proposer." }, ...request.messages],
      stream: true,
      format: SCHEMA,
      options: { num_predict: 1_000 },
      think: false,
    });
  });

  it("explains that Ollama is not running", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    });
    const error = await rejection(new OllamaProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(false);
    expect(error.code).toBe("provider_unavailable");
    expect(error.message).toBe("Ollama is not reachable at http://127.0.0.1:11434. Is it running?");
  });

  it("suggests pulling a missing model", async () => {
    const fetchMock = fakeFetch(() => Response.json({ error: "model 'qwen-x' not found" }, { status: 404 }));
    const error = await rejection(new OllamaProvider({ model: "qwen-x", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/ollama pull qwen-x/);
  });

  it("retries server errors and truncated answers", async () => {
    const failing = fakeFetch(() => Response.json({ error: "out of memory" }, { status: 500 }));
    expect((await rejection(new OllamaProvider({ model: "m", fetch: failing }).generate(request))).retryable).toBe(true);
    const truncated = fakeFetch(() => streamed([ndjson({ message: { content: "{" }, done: true, done_reason: "length" })]));
    expect((await rejection(new OllamaProvider({ model: "m", fetch: truncated }).generate(request))).retryable).toBe(true);
  });
});

describe("catalogFromEnv", () => {
  const noOllama = vi.fn<FetchLike>(async () => {
    throw new TypeError("fetch failed");
  });

  it("is empty without any provider", async () => {
    expect(await catalogFromEnv({}, noOllama)).toEqual([]);
    expect(noOllama).not.toHaveBeenCalled();
  });

  it("lists the default Claude models, the configured model first", async () => {
    const catalog = await catalogFromEnv({ ANTHROPIC_API_KEY: "a", ANTHROPIC_MODEL: "claude-fable-5-1" }, noOllama);
    expect(catalog.map((entry) => entry.model)).toEqual(["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(catalog[1]).toEqual({ provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5", local: false });
  });

  it("needs a model list for OpenAI and Gemini, and registers their prices", async () => {
    const env = {
      ANTHROPIC_API_KEY: "a",
      ANTHROPIC_MODELS: "claude-sonnet-5-5",
      OPENAI_API_KEY: "o",
      OPENAI_MODELS: "gpt-a, gpt-b",
      GEMINI_API_KEY: "g",
      GEMINI_MODELS: "gem-a,gem-b",
      GEMINI_PRICE_INPUT: "1",
      GEMINI_PRICE_OUTPUT: "4",
    };
    const catalog = await catalogFromEnv(env, noOllama);
    expect(catalog.map((entry) => `${entry.provider}:${entry.model}`)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "openai:gpt-a",
      "openai:gpt-b",
      "gemini:gem-a",
      "gemini:gem-b",
    ]);
    expect(costOf("gem-b", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(5);
    expect(await catalogFromEnv({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }, noOllama)).toEqual([]);
  });

  it("discovers the models Ollama has pulled, for free", async () => {
    const fetchMock = fakeFetch(() => Response.json({ models: [{ name: "llama-x:latest" }, { name: "qwen-y:8b" }] }));
    const catalog = await catalogFromEnv({ OLLAMA_BASE_URL: "http://gpu-box:11434" }, fetchMock);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://gpu-box:11434/api/tags");
    expect(catalog).toEqual([
      { provider: "ollama", model: "llama-x:latest", label: "llama-x:latest (Ollama)", local: true },
      { provider: "ollama", model: "qwen-y:8b", label: "qwen-y:8b (Ollama)", local: true },
    ]);
    expect(costOf("qwen-y:8b", { inputTokens: 5_000, outputTokens: 5_000 })).toBe(0);
  });

  it("gives up on Ollama discovery after a timeout", async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn<FetchLike>(
        (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      );
      const pending = catalogFromEnv({ ANTHROPIC_API_KEY: "a", OLLAMA_BASE_URL: "http://127.0.0.1:11434" }, hanging);
      await vi.advanceTimersByTimeAsync(1_600);
      expect((await pending).map((entry) => entry.provider)).toEqual(["anthropic", "anthropic", "anthropic"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses OLLAMA_MODELS without asking Ollama", async () => {
    const catalog = await catalogFromEnv({ OLLAMA_MODELS: "llama-x,qwen-y" }, noOllama);
    expect(catalog.map((entry) => entry.model)).toEqual(["llama-x", "qwen-y"]);
    expect(noOllama).not.toHaveBeenCalled();
  });

  it("keeps only local models in local-only mode", async () => {
    const env = { QUORUMIND_LOCAL_ONLY: "1", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-a", OLLAMA_MODELS: "llama-x" };
    const catalog = await catalogFromEnv(env, noOllama);
    expect(catalog.map((entry) => `${entry.provider}:${entry.model}`)).toEqual(["ollama:llama-x"]);
  });
});

describe("liveLineupFromEnv with the V1 catalog", () => {
  it("seats two vendors, without a devil's advocate by default", () => {
    const lineup = liveLineupFromEnv({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gem-a", OLLAMA_MODELS: "llama-x" });
    expect(lineup).toEqual({
      interviewer: { provider: "gemini", model: "gem-a" },
      arbiter: { provider: "gemini", model: "gem-a" },
      seats: { A: { provider: "gemini", model: "gem-a", persona: null }, B: { provider: "ollama", model: "llama-x", persona: null } },
      devil: null,
    });
  });

  it("picks defaults from a discovered catalog", () => {
    const lineup = liveLineupFromEnv({ QUORUMIND_LOCAL_ONLY: "1" }, [
      { provider: "ollama", model: "llama-x", label: "llama-x", local: true },
      { provider: "ollama", model: "qwen-y", label: "qwen-y", local: true },
    ]);
    expect(lineup?.seats.A?.model).toBe("llama-x");
    expect(lineup?.seats.B?.model).toBe("qwen-y");
    expect(lineup?.arbiter).toEqual({ provider: "ollama", model: "llama-x" });
  });

  it("adds seats C and D and a devil's advocate from the environment", () => {
    const lineup = liveLineupFromEnv({
      ANTHROPIC_API_KEY: "a",
      QUORUMIND_SEAT_C: "ollama:llama-x",
      QUORUMIND_SEAT_D: "gemini:gem-a",
      QUORUMIND_DEVIL: "anthropic:claude-haiku-5-5",
    });
    expect(Object.keys(lineup?.seats ?? {})).toEqual(["A", "B", "C", "D"]);
    expect(lineup?.devil).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", persona: null });
    expect(liveLineupFromEnv({ ANTHROPIC_API_KEY: "a", QUORUMIND_DEVIL: "none" })?.devil).toBeNull();
  });

  it("refuses a cloud model in local-only mode", () => {
    expect(() =>
      liveLineupFromEnv({ QUORUMIND_LOCAL_ONLY: "1", OLLAMA_MODELS: "llama-x", QUORUMIND_ARBITER: "anthropic:claude-opus-5-5" }),
    ).toThrow(/QUORUMIND_LOCAL_ONLY/);
    expect(liveLineupFromEnv({ QUORUMIND_LOCAL_ONLY: "1", ANTHROPIC_API_KEY: "a" })).toBeNull();
  });

  it("builds a provider for every role, including the devil's advocate", () => {
    const lineup = liveLineupFromEnv({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gem-a", QUORUMIND_DEVIL: "ollama:llama-x" });
    const providers = providersFor(lineup!, {});
    expect(providers.proposers.A?.kind).toBe("gemini");
    expect(providers.devil?.kind).toBe("ollama");
    expect(costOf("llama-x", { inputTokens: 10, outputTokens: 10 })).toBe(0);
  });
});

describe("OpenRouterProvider", () => {
  const answer = [
    ": OPENROUTER PROCESSING\n\n",
    sse({ model: "mistralai/mistral-test", choices: [{ delta: { role: "assistant", content: '{"speech":' } }] }),
    sse({ choices: [{ delta: { content: '"bonjour"}' } }] }).replace(/(.{20})/, "$1\u0000"),
    sse({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] }),
    // The usage chunk repeats the finish reason and carries the exact cost.
    sse({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340, cost: 0.00123 },
    }),
    "data: [DONE]\n\n",
  ].flatMap((piece) => piece.split("\u0000"));

  it("streams the answer and reports usage with the cost OpenRouter charged", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const provider = new OpenRouterProvider({ model: "mistralai/mistral-test", apiKey: "key", fetch: fetchMock });
    const deltas: string[] = [];
    const result = await provider.generate(request, (delta) => deltas.push(delta));

    expect(deltas).toEqual(['{"speech":', '"bonjour"}']);
    expect(result).toEqual({
      text: '{"speech":"bonjour"}',
      model: "mistralai/mistral-test",
      usage: { inputTokens: 300, outputTokens: 40 },
      costUsd: 0.00123,
    });
  });

  it("asks for a strict schema, from endpoints that support it and keep no data", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const signal = new AbortController().signal;
    const provider = new OpenRouterProvider({ model: "mistralai/mistral-test", apiKey: "key", fetch: fetchMock });
    await provider.generate({ ...request, effort: "high", signal });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer key",
      "HTTP-Referer": "https://quorumind.com",
      "X-OpenRouter-Title": "Quorumind",
    });
    expect(init?.signal).toBe(signal);
    // Without reasoning support, the effort is not sent: no endpoint would accept it.
    expect(sentBody(fetchMock)).toEqual({
      model: "mistralai/mistral-test",
      messages: [{ role: "system", content: "You are a proposer." }, ...request.messages],
      max_tokens: 1_000,
      stream: true,
      response_format: { type: "json_schema", json_schema: { name: "proposal", schema: SCHEMA, strict: true } },
      provider: { require_parameters: true, data_collection: "deny" },
    });
  });

  it("sends the effort to a model that reasons, without its reasoning text", async () => {
    const fetchMock = fakeFetch(() => streamed(answer));
    const provider = new OpenRouterProvider({ model: "m/reasoner", reasoning: true, fetch: fetchMock });
    await provider.generate({ ...request, effort: "low" });
    expect(sentBody(fetchMock).reasoning).toEqual({ effort: "low", exclude: true });

    await provider.generate(request);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).not.toHaveProperty("reasoning");
  });

  it.each([
    [400, false, /OpenRouter rejected the request: Bad schema/, "provider_error"],
    [401, false, /The OpenRouter API key was rejected\./, "provider_auth"],
    [402, false, /out of credits/, "provider_quota"],
    [404, false, /no endpoint for m that supports a strict JSON schema/, "provider_error"],
    [429, true, /unavailable/, "provider_rate_limit"],
    [502, true, /unavailable/, "provider_unavailable"],
  ])("maps HTTP %i to a ProviderError (retryable: %s)", async (status, retryable, message, code) => {
    const fetchMock = fakeFetch(() => Response.json({ error: { code: status, message: "Bad schema" } }, { status }));
    const error = await rejection(new OpenRouterProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(retryable);
    expect(error.message).toMatch(message);
    expect(error.code).toBe(code);
  });

  it("reports an error sent in the middle of the stream", async () => {
    const fetchMock = fakeFetch(() =>
      streamed([
        sse({ choices: [{ delta: { content: '{"speech":' } }] }),
        sse({ error: { code: "server_error", message: "Provider disconnected" }, choices: [{ delta: {}, finish_reason: "error" }] }),
      ]),
    );
    const error = await rejection(new OpenRouterProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(true);
    expect(error.code).toBe("provider_unavailable");
    expect(error.message).toMatch(/Provider disconnected/);
  });

  it("retries an answer cut off by the token limit", async () => {
    const fetchMock = fakeFetch(() => streamed([sse({ choices: [{ delta: { content: "{" }, finish_reason: "length" }] })]));
    const error = await rejection(new OpenRouterProvider({ model: "m", fetch: fetchMock }).generate(request));
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/incomplete/);
  });
});

describe("catalogFromEnv with OpenRouter", () => {
  const listed = (id: string, name: string, prompt: string, completion: string, parameters: string[]) => ({
    id,
    name,
    pricing: { prompt, completion },
    supported_parameters: parameters,
  });
  const modelList = {
    data: [
      listed("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", "0.000004", "0.00002", ["reasoning", "structured_outputs"]),
      listed("mistralai/mistral-large-4-0", "Mistral: Mistral Large 4", "0.00000068", "0.00000209", ["structured_outputs"]),
      listed("vendor/plain-json", "Vendor: Plain JSON", "0.000001", "0.000001", ["response_format"]),
    ],
  };
  const env = {
    OPENROUTER_API_KEY: "or",
    OPENROUTER_MODELS: "anthropic/claude-opus-5.5, mistralai/mistral-large-4-0, vendor/plain-json, vendor/retired",
  };

  it("names, prices and filters the configured models from OpenRouter's list", async () => {
    const fetchMock = fakeFetch(() => Response.json(modelList));
    const catalog = await catalogFromEnv(env, fetchMock);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/models");
    // A model without strict JSON schemas cannot follow the debate, and a retired one is gone.
    expect(catalog).toEqual([
      { provider: "openrouter", model: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", maker: "Anthropic", local: false },
      { provider: "openrouter", model: "mistralai/mistral-large-4-0", label: "Mistral Large 4", maker: "Mistral", local: false },
    ]);
    expect(priceOf("anthropic/claude-opus-5.5")).toEqual({ input: 4, output: 20 });
    expect(priceOf("mistralai/mistral-large-4-0")).toEqual({ input: 0.68, output: 2.09 });
    expect(priceOf("vendor/plain-json")).toBeNull();
  });

  it("reads the list once and reuses it", async () => {
    const fetchMock = fakeFetch(() => Response.json(modelList));
    await catalogFromEnv(env, fetchMock);
    await catalogFromEnv(env, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers the default models when OPENROUTER_MODELS is not set", async () => {
    const catalog = await catalogFromEnv(
      { OPENROUTER_API_KEY: "or" },
      fakeFetch(() => Response.json(modelList)),
    );
    expect(catalog.map((entry) => entry.model)).toEqual(["anthropic/claude-opus-5.5", "mistralai/mistral-large-4-0"]);
  });

  it("keeps the models, unpriced, when the list cannot be read", async () => {
    const failing = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const catalog = await catalogFromEnv({ OPENROUTER_API_KEY: "or", OPENROUTER_MODELS: "mistralai/mistral-small-x" }, failing);
    expect(catalog).toEqual([
      { provider: "openrouter", model: "mistralai/mistral-small-x", label: "mistral-small-x", maker: "Mistral", local: false },
    ]);
    expect(priceOf("mistralai/mistral-small-x")).toBeNull();
    expect(
      await catalogFromEnv(
        { OPENROUTER_API_KEY: "or" },
        fakeFetch(() => new Response("busy", { status: 503 })),
      ),
    ).toHaveLength(9);
  });

  it("is off without a key and in local-only mode", async () => {
    const fetchMock = fakeFetch(() => Response.json(modelList));
    expect(await catalogFromEnv({ OPENROUTER_MODELS: "anthropic/claude-opus-5.5" }, fetchMock)).toEqual([]);
    expect(await catalogFromEnv({ ...env, QUORUMIND_LOCAL_ONLY: "1", OLLAMA_MODELS: "llama-x" }, fetchMock)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("seats two makers and sends the effort to the models that reason", async () => {
    const fetchMock = fakeFetch(() => Response.json(modelList));
    const catalog = await catalogFromEnv(env, fetchMock);
    const lineup = liveLineupFromEnv(env, catalog);
    expect(lineup?.seats.A?.model).toBe("anthropic/claude-opus-5.5");
    expect(lineup?.seats.B?.model).toBe("mistralai/mistral-large-4-0");

    const chat = fakeFetch(() => streamed([sse({ choices: [{ delta: { content: "{}" }, finish_reason: "stop" }] })]));
    vi.stubGlobal("fetch", chat);
    try {
      const providers = providersFor(lineup!, env);
      await providers.proposers.A?.generate({ ...request, effort: "high" });
      await providers.proposers.B?.generate({ ...request, effort: "high" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(JSON.parse(String(chat.mock.calls[0]?.[1]?.body)).reasoning).toEqual({ effort: "high", exclude: true });
    expect(JSON.parse(String(chat.mock.calls[1]?.[1]?.body))).not.toHaveProperty("reasoning");
    expect(chat.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer or" });
  });
});
