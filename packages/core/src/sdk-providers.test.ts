import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { type AnthropicClient, AnthropicProvider } from "./providers/anthropic.ts";
import { type OpenAiClient, OpenAiProvider } from "./providers/openai.ts";
import { type GenerateRequest, ProviderError } from "./providers/types.ts";

// The providers built on the vendors' SDKs, with the SDK clients replaced by fakes that stream, answer or throw the
// SDK's own error classes.

const SCHEMA = { type: "object", properties: { speech: { type: "string" } }, required: ["speech"], additionalProperties: false };

const request: GenerateRequest = {
  task: "verdict",
  seat: null,
  system: "You are the arbiter.",
  messages: [{ role: "user", content: "Rule." }],
  schema: SCHEMA,
  schemaName: "verdict",
  maxTokens: 2_000,
};

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

interface AnthropicMessage {
  model: string;
  stop_reason: string;
  stop_details?: { category?: string };
  content: { type: "text"; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * A fake Anthropic client whose stream runs `script`: it sends text deltas, may set what the stream has received so
 * far, and returns the final message or throws.
 */
function anthropicClient(
  script: (stream: {
    text: (delta: string) => void;
    received: (message: Partial<AnthropicMessage>) => void;
    signal: AbortSignal | undefined;
  }) => Promise<AnthropicMessage>,
) {
  const calls: { params: Record<string, unknown>; options: { signal?: AbortSignal } }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options: { signal?: AbortSignal }) {
          calls.push({ params, options });
          const listeners: ((delta: string) => void)[] = [];
          let current: Partial<AnthropicMessage> | undefined;
          return {
            on(event: string, listener: (delta: string) => void) {
              if (event === "text") listeners.push(listener);
              return this;
            },
            get currentMessage() {
              return current;
            },
            finalMessage: () =>
              script({
                text: (delta) => {
                  for (const listener of listeners) listener(delta);
                },
                received: (message) => {
                  current = message;
                },
                signal: options.signal,
              }),
          };
        },
      },
    },
  };
  return { client: client as unknown as AnthropicClient, calls };
}

const message = (overrides: Partial<AnthropicMessage> = {}): AnthropicMessage => ({
  model: "claude-test-1",
  stop_reason: "end_turn",
  content: [{ type: "text", text: '{"speech":"ok"}' }],
  usage: { input_tokens: 1_200, output_tokens: 300 },
  ...overrides,
});

const anthropicStatus = (status: number, type: string, text: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message: text } }, undefined, new Headers());

describe("AnthropicProvider", () => {
  it("streams the answer and reports its usage and model", async () => {
    const { client, calls } = anthropicClient(async (stream) => {
      stream.text('{"speech":');
      stream.text('"ok"}');
      return message();
    });
    const deltas: string[] = [];
    const caller = new AbortController();
    const signal = caller.signal;
    const result = await new AnthropicProvider({ client, model: "claude-test" }).generate({ ...request, effort: "low", signal }, (delta) =>
      deltas.push(delta),
    );
    expect(deltas).toEqual(['{"speech":', '"ok"}']);
    expect(result).toEqual({ text: '{"speech":"ok"}', model: "claude-test-1", usage: { inputTokens: 1_200, outputTokens: 300 } });
    expect(calls[0]?.params).toMatchObject({
      model: "claude-test",
      max_tokens: 2_000,
      system: "You are the arbiter.",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
    // The call is cancelled with the caller's signal, or when its stream stalls.
    caller.abort();
    expect(calls[0]?.options.signal?.aborted).toBe(true);
  });

  it("thinks with the configured effort when the session sets none", async () => {
    const { client, calls } = anthropicClient(async () => message());
    await new AnthropicProvider({ client, effort: "max" }).generate(request);
    expect(calls[0]?.params).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "max" } });
  });

  it("does not retry a refusal, and carries what it cost", async () => {
    const { client } = anthropicClient(async () => message({ stop_reason: "refusal", stop_details: { category: "cyber" } }));
    const error = await rejection(new AnthropicProvider({ client }).generate(request));
    expect(error).toMatchObject({ retryable: false, code: "provider_refused", usage: { inputTokens: 1_200, outputTokens: 300 } });
    expect(error.message).toMatch(/declined this request \(cyber\)/);
  });

  it("retries an answer cut off by the token limit, and carries what it cost", async () => {
    const { client } = anthropicClient(async () =>
      message({ stop_reason: "max_tokens", usage: { input_tokens: 900, output_tokens: 2_000 } }),
    );
    const error = await rejection(new AnthropicProvider({ client }).generate(request));
    expect(error).toMatchObject({ retryable: true, usage: { inputTokens: 900, outputTokens: 2_000 }, model: "claude-test-1" });
  });

  it("retries a connection error or a timeout", async () => {
    for (const thrown of [new Anthropic.APIConnectionError({ message: "Connection error." }), new Anthropic.APIConnectionTimeoutError()]) {
      const { client } = anthropicClient(async () => {
        throw thrown;
      });
      const error = await rejection(new AnthropicProvider({ client }).generate(request));
      expect(error).toMatchObject({ retryable: true, code: "provider_unavailable" });
      expect(error.message).toMatch(/^Could not reach the Anthropic API: /);
      expect(error.message).not.toMatch(/undefined/);
    }
  });

  it("retries an overloaded error sent in the middle of the stream, with what was billed so far", async () => {
    const { client } = anthropicClient(async (stream) => {
      stream.received({ model: "claude-test-1", usage: { input_tokens: 5_000, output_tokens: 120 } });
      stream.text('{"speech":"The options');
      // What the SDK throws for an SSE "error" event: no HTTP status.
      const body = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
      throw new Anthropic.APIError(undefined, body, undefined, new Headers(), "overloaded_error");
    });
    const error = await rejection(new AnthropicProvider({ client }).generate(request));
    expect(error).toMatchObject({ retryable: true, code: "provider_unavailable", usage: { inputTokens: 5_000, outputTokens: 120 } });
    expect(error.message).toBe("Anthropic stopped the answer: Overloaded");
  });

  it("does not retry an invalid request reported in the middle of the stream", async () => {
    const { client } = anthropicClient(async () => {
      const body = { type: "error", error: { type: "invalid_request_error", message: "Bad schema" } };
      throw new Anthropic.APIError(undefined, body, undefined, new Headers(), "invalid_request_error");
    });
    expect(await rejection(new AnthropicProvider({ client }).generate(request))).toMatchObject({
      retryable: false,
      code: "provider_error",
    });
  });

  it.each([
    [400, "invalid_request_error", false, "provider_error", /Anthropic rejected the request/],
    [401, "authentication_error", false, "provider_auth", /The Anthropic API key was rejected/],
    [403, "permission_error", false, "provider_auth", /The Anthropic API key was rejected/],
    [429, "rate_limit_error", true, "provider_rate_limit", /unavailable right now/],
    [529, "overloaded_error", true, "provider_unavailable", /unavailable right now/],
    [413, "request_too_large", false, "provider_error", /Anthropic API error 413/],
  ])("maps HTTP %i to a ProviderError", async (status, type, retryable, code, text) => {
    const { client } = anthropicClient(async () => {
      throw anthropicStatus(status, type, "Nope");
    });
    const error = await rejection(new AnthropicProvider({ client }).generate(request));
    expect(error).toMatchObject({ retryable, code });
    expect(error.message).toMatch(text);
  });

  it("fails a stream that stops sending, to be tried again", async () => {
    const { client } = anthropicClient(
      (stream) =>
        new Promise((_resolve, reject) => {
          stream.text("{");
          // The SDK reports the abort of its signal as a user abort.
          stream.signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()), { once: true });
        }),
    );
    const error = await rejection(new AnthropicProvider({ client, timeouts: { idleMs: 30, totalMs: 1_000 } }).generate(request));
    expect(error).toMatchObject({ retryable: true, code: "provider_unavailable" });
    expect(error.message).toMatch(/^Anthropic sent nothing for .*: the call stalled.$/);
  });

  it("passes on how long a rate-limited call should wait", async () => {
    const { client } = anthropicClient(async () => {
      const body = { type: "error", error: { type: "rate_limit_error", message: "Slow down" } };
      throw Anthropic.APIError.generate(429, body, undefined, new Headers({ "retry-after": "3" }));
    });
    expect(await rejection(new AnthropicProvider({ client }).generate(request))).toMatchObject({ retryable: true, retryAfterMs: 3_000 });
  });

  it("reports a cancelled call as cancelled, never to retry", async () => {
    const { client } = anthropicClient(async () => {
      throw new Anthropic.APIUserAbortError();
    });
    expect(await rejection(new AnthropicProvider({ client }).generate(request))).toMatchObject({
      retryable: false,
      message: "The request was cancelled.",
    });
  });
});

interface OpenAiResponse {
  model: string;
  status: string;
  output_text: string;
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string; message?: string } | null;
  usage?: { input_tokens: number; output_tokens: number };
}

/** A fake OpenAI client whose stream runs `script`: it sends text deltas and returns the final response or throws. */
function openAiClient(script: (text: (delta: string) => void) => Promise<OpenAiResponse>) {
  const calls: { params: Record<string, unknown>; options: { signal?: AbortSignal } }[] = [];
  const client = {
    responses: {
      stream(params: Record<string, unknown>, options: { signal?: AbortSignal }) {
        calls.push({ params, options });
        const listeners: ((event: { delta: string }) => void)[] = [];
        return {
          on(event: string, listener: (event: { delta: string }) => void) {
            if (event === "response.output_text.delta") listeners.push(listener);
            return this;
          },
          finalResponse: () =>
            script((delta) => {
              for (const listener of listeners) listener({ delta });
            }),
        };
      },
    },
  };
  return { client: client as unknown as OpenAiClient, calls };
}

const response = (overrides: Partial<OpenAiResponse> = {}): OpenAiResponse => ({
  model: "gpt-test-1",
  status: "completed",
  output_text: '{"speech":"ok"}',
  usage: { input_tokens: 800, output_tokens: 200 },
  ...overrides,
});

const openAiStatus = (status: number, code: string, text: string) =>
  OpenAI.APIError.generate(status, { error: { code, message: text, type: code } }, undefined, new Headers());

describe("OpenAiProvider", () => {
  it("streams the answer and reports its usage and model, without storing the response", async () => {
    const { client, calls } = openAiClient(async (text) => {
      text('{"speech":');
      text('"ok"}');
      return response();
    });
    const deltas: string[] = [];
    const result = await new OpenAiProvider({ client, model: "gpt-test" }).generate({ ...request, effort: "high" }, (delta) =>
      deltas.push(delta),
    );
    expect(deltas).toEqual(['{"speech":', '"ok"}']);
    expect(result).toEqual({ text: '{"speech":"ok"}', model: "gpt-test-1", usage: { inputTokens: 800, outputTokens: 200 } });
    expect(calls[0]?.params).toMatchObject({
      model: "gpt-test",
      instructions: "You are the arbiter.",
      max_output_tokens: 2_000,
      store: false,
      text: { format: { type: "json_schema", name: "verdict", schema: SCHEMA, strict: true } },
    });
    // Without reasoning support, the effort is not sent: the model would reject it.
    expect(calls[0]?.params).not.toHaveProperty("reasoning");
  });

  it("sends the effort to a model that reasons", async () => {
    const { client, calls } = openAiClient(async () => response());
    await new OpenAiProvider({ client, model: "gpt-test", reasoning: true }).generate({ ...request, effort: "low" });
    expect(calls[0]?.params).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("retries an answer cut off by the token limit, and carries what it cost", async () => {
    const { client } = openAiClient(async () => response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    const error = await rejection(new OpenAiProvider({ client, model: "gpt-test" }).generate(request));
    expect(error).toMatchObject({ retryable: true, code: "provider_error", usage: { inputTokens: 800, outputTokens: 200 } });
  });

  it("does not retry an answer stopped by the content filter", async () => {
    const { client } = openAiClient(async () => response({ status: "incomplete", incomplete_details: { reason: "content_filter" } }));
    const error = await rejection(new OpenAiProvider({ client, model: "gpt-test" }).generate(request));
    expect(error).toMatchObject({ retryable: false, code: "provider_refused", usage: { inputTokens: 800, outputTokens: 200 } });
  });

  it("retries a response that failed on the server's side, not one that failed on the request", async () => {
    const server = openAiClient(async () =>
      response({ status: "failed", output_text: "", error: { code: "server_error", message: "Oops" } }),
    );
    expect(await rejection(new OpenAiProvider({ client: server.client, model: "m" }).generate(request))).toMatchObject({
      retryable: true,
      code: "provider_unavailable",
      message: "OpenAI could not answer: Oops",
    });
    const prompt = openAiClient(async () =>
      response({ status: "failed", output_text: "", error: { code: "invalid_prompt", message: "No" } }),
    );
    expect(await rejection(new OpenAiProvider({ client: prompt.client, model: "m" }).generate(request))).toMatchObject({
      retryable: false,
      code: "provider_error",
    });
  });

  it("retries a connection error or a timeout", async () => {
    for (const thrown of [new OpenAI.APIConnectionError({ message: "Connection error." }), new OpenAI.APIConnectionTimeoutError()]) {
      const { client } = openAiClient(async () => {
        throw thrown;
      });
      const error = await rejection(new OpenAiProvider({ client, model: "m" }).generate(request));
      expect(error).toMatchObject({ retryable: true, code: "provider_unavailable" });
      expect(error.message).toMatch(/^Could not reach the OpenAI API: /);
    }
  });

  it("retries a server error sent in the middle of the stream", async () => {
    const { client } = openAiClient(async (text) => {
      text('{"speech":');
      throw new OpenAI.APIError(undefined, { code: "server_error", message: "The server had an error" }, undefined, undefined);
    });
    const error = await rejection(new OpenAiProvider({ client, model: "m" }).generate(request));
    expect(error).toMatchObject({ retryable: true, code: "provider_unavailable" });
    expect(error.message).toMatch(/^OpenAI stopped the answer: /);
  });

  it.each([
    [400, "invalid_request_error", false, "provider_error", /OpenAI rejected the request/],
    [401, "invalid_api_key", false, "provider_auth", /The OpenAI API key was rejected/],
    [429, "rate_limit_exceeded", true, "provider_rate_limit", /unavailable right now/],
    [429, "insufficient_quota", false, "provider_quota", /out of credits/],
    [503, "server_error", true, "provider_unavailable", /unavailable right now/],
  ])("maps HTTP %i (%s) to a ProviderError", async (status, code, retryable, expected, text) => {
    const { client } = openAiClient(async () => {
      throw openAiStatus(status, code, "Nope");
    });
    const error = await rejection(new OpenAiProvider({ client, model: "m" }).generate(request));
    expect(error).toMatchObject({ retryable, code: expected });
    expect(error.message).toMatch(text);
  });

  it("reports a cancelled call as cancelled, never to retry", async () => {
    const { client } = openAiClient(async () => {
      throw new OpenAI.APIUserAbortError();
    });
    expect(await rejection(new OpenAiProvider({ client, model: "m" }).generate(request))).toMatchObject({
      retryable: false,
      message: "The request was cancelled.",
    });
  });
});
