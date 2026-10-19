import Anthropic from "@anthropic-ai/sdk";
import {
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  ProviderError,
  type ProviderErrorOptions,
  providerErrorCode,
} from "./types.ts";

/** The part of the SDK client the provider uses: a test passes a fake one. */
export type AnthropicClient = Pick<Anthropic, "beta">;

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** The SDK client to call instead of one made from the key. */
  client?: AnthropicClient;
}

// Errors the API sends in the middle of a stream, as an SSE "error" event without an HTTP status: they are transient.
const TRANSIENT_STREAM_ERRORS = new Set(["overloaded_error", "api_error", "rate_limit_error", "timeout_error"]);

export class AnthropicProvider implements LlmProvider {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private readonly client: AnthropicClient;
  private readonly effort: NonNullable<AnthropicOptions["effort"]>;

  constructor(options: AnthropicOptions = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "high";
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    // What the stream has received so far, for the usage of a call that fails in the middle.
    let received: () => { usage?: { input_tokens?: number | null; output_tokens?: number | null }; model?: string } | undefined = () =>
      undefined;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          output_config: {
            // The debate depth chosen for the session wins over the configured default.
            effort: request.effort ?? this.effort,
            format: { type: "json_schema", schema: request.schema },
          },
          // Server-side fallback: if a safety classifier declines, the API re-runs the
          // request on a suitable model inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: request.signal },
      );
      received = () => stream.currentMessage;
      if (onDelta) {
        stream.on("text", (delta) => onDelta(delta));
      }
      const message = await stream.finalMessage();
      const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
      // A declined or cut-off answer is billed all the same: the error carries what it cost.
      if (message.stop_reason === "refusal") {
        throw new ProviderError(`The model declined this request (${message.stop_details?.category ?? "no category"}).`, false, {
          code: "provider_refused",
          usage,
          model: message.model,
        });
      }
      if (message.stop_reason === "max_tokens") {
        throw new ProviderError("The answer was cut off by the token limit.", true, { usage, model: message.model });
      }
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return { text, model: message.model, usage };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // What the stream reported before it failed: the input is billed once the request was read.
      const partial = received();
      const billed: ProviderErrorOptions = partial?.usage
        ? {
            usage: { inputTokens: partial.usage.input_tokens ?? 0, outputTokens: partial.usage.output_tokens ?? 0 },
            ...(partial.model ? { model: partial.model } : {}),
          }
        : {};
      throw anthropicError(error, billed);
    }
  }
}

/** The ProviderError of what the SDK threw, retryable when trying again may succeed. */
export function anthropicError(error: unknown, billed: ProviderErrorOptions = {}): ProviderError {
  const options = (code: ProviderErrorOptions["code"]): ProviderErrorOptions => ({ cause: error, ...billed, ...(code ? { code } : {}) });
  // The SDK's connection and abort errors extend APIError: they are told apart first.
  if (error instanceof Anthropic.APIUserAbortError) return new ProviderError("The request was cancelled.", false, options(undefined));
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`Could not reach the Anthropic API: ${error.message}`, true, options("provider_unavailable"));
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("The Anthropic API key was rejected.", false, options("provider_auth"));
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(`Anthropic rejected the request: ${error.message}`, false, options(undefined));
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError(`Anthropic is unavailable right now: ${error.message}`, true, options("provider_rate_limit"));
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderError(`Anthropic is unavailable right now: ${error.message}`, true, options("provider_unavailable"));
  }
  if (error instanceof Anthropic.APIError) {
    if (typeof error.status !== "number") {
      // An error event in the middle of the stream, most often "overloaded_error" under load.
      const body = error.error as { error?: { type?: string; message?: string } } | undefined;
      const type = error.type ?? body?.error?.type ?? null;
      const message = body?.error?.message ?? error.message;
      const transient = type !== null && TRANSIENT_STREAM_ERRORS.has(type);
      return new ProviderError(
        `Anthropic stopped the answer: ${message}`,
        transient,
        options(type === "rate_limit_error" ? "provider_rate_limit" : transient ? "provider_unavailable" : undefined),
      );
    }
    const status = error.status;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    return new ProviderError(`Anthropic API error ${status}: ${error.message}`, retryable, options(providerErrorCode(status)));
  }
  return new ProviderError("Could not reach the Anthropic API.", true, options("provider_unavailable"));
}
