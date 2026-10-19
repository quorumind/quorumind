import OpenAI from "openai";
import { CLOUD_TIMEOUTS, retryAfterMs, type Timeouts, timeoutMessage, watch } from "./http.ts";
import {
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  ProviderError,
  type ProviderErrorOptions,
  providerErrorCode,
} from "./types.ts";

/** The part of the SDK client the provider uses: a test passes a fake one. */
export type OpenAiClient = Pick<OpenAI, "responses">;

export interface OpenAiOptions {
  apiKey?: string;
  /** Required: OpenAI model identifiers change often, so none is assumed. */
  model: string;
  baseURL?: string;
  /**
   * Sends the requested effort as `reasoning.effort`. Off by default: models without
   * reasoning reject the parameter. Enabled with OPENAI_REASONING=1.
   */
  reasoning?: boolean;
  /** The SDK client to call instead of one made from the key and the address. */
  client?: OpenAiClient;
  /** When a stream that stalls or never ends fails, to be tried again: CLOUD_TIMEOUTS unless set. */
  timeouts?: Timeouts;
}

// Error codes of a failed response, or of an error event in the middle of a stream, that trying again may get past.
const TRANSIENT_CODES = new Set(["server_error", "rate_limit_exceeded", "server_overloaded", "timeout", "internal_error"]);

export class OpenAiProvider implements LlmProvider {
  readonly kind = "openai" as const;
  readonly model: string;
  private readonly client: OpenAiClient;
  private readonly reasoning: boolean;
  private readonly timeouts: Timeouts;

  constructor(options: OpenAiOptions) {
    this.client =
      options.client ??
      new OpenAI({
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      });
    this.model = options.model;
    this.reasoning = options.reasoning ?? false;
    this.timeouts = options.timeouts ?? CLOUD_TIMEOUTS;
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    // The SDK times out a request that gets no answer, not a stream that stops in the middle: the watch does.
    const call = watch(request.signal, this.timeouts);
    try {
      const stream = this.client.responses.stream(
        {
          model: this.model,
          instructions: request.system,
          input: request.messages.map((message) => ({ role: message.role, content: message.content })),
          max_output_tokens: request.maxTokens,
          // The Responses API stores each response by default, for later turns to chain to: nothing here needs that.
          store: false,
          ...(this.reasoning && request.effort ? { reasoning: { effort: request.effort } } : {}),
          text: {
            format: { type: "json_schema", name: request.schemaName, schema: request.schema, strict: true },
          },
        },
        { signal: call.signal },
      );
      stream.on("event", call.touch);
      if (onDelta) {
        stream.on("response.output_text.delta", (event) => onDelta(event.delta));
      }
      const response = await stream.finalResponse();
      const usage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined;
      // An incomplete or failed answer is billed all the same: the error carries what it cost.
      const billed: ProviderErrorOptions = usage ? { usage, model: response.model } : {};
      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason;
        // A filtered answer would be filtered again: only one cut by the token limit is worth another try.
        const refused = reason === "content_filter";
        throw new ProviderError(`The answer is incomplete (${reason ?? "unknown reason"}).`, !refused, {
          code: refused ? "provider_refused" : "provider_error",
          ...billed,
        });
      }
      if (response.status === "failed") {
        const code = response.error?.code ?? null;
        throw new ProviderError(`OpenAI could not answer: ${response.error?.message ?? code ?? "unknown error"}`, transient(code), {
          code: errorCode(code),
          ...billed,
        });
      }
      return { text: response.output_text, model: response.model, usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const expired = call.expired();
      if (expired)
        throw new ProviderError(timeoutMessage("OpenAI", expired, this.timeouts), true, { cause: error, code: "provider_unavailable" });
      throw openAiError(error);
    } finally {
      call.done();
    }
  }
}

const transient = (code: string | null | undefined) => typeof code === "string" && TRANSIENT_CODES.has(code);

function errorCode(code: string | null | undefined): ProviderErrorOptions["code"] {
  if (code === "rate_limit_exceeded") return "provider_rate_limit";
  return transient(code) ? "provider_unavailable" : "provider_error";
}

/** The ProviderError of what the SDK threw, retryable when trying again may succeed. */
export function openAiError(error: unknown): ProviderError {
  const options = (code: ProviderErrorOptions["code"]): ProviderErrorOptions => ({ cause: error, ...(code ? { code } : {}) });
  // The SDK's connection and abort errors extend APIError: they are told apart first.
  if (error instanceof OpenAI.APIUserAbortError) return new ProviderError("The request was cancelled.", false, options(undefined));
  if (error instanceof OpenAI.APIConnectionError) {
    return new ProviderError(`Could not reach the OpenAI API: ${error.message}`, true, options("provider_unavailable"));
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new ProviderError("The OpenAI API key was rejected.", false, options("provider_auth"));
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new ProviderError(`OpenAI rejected the request: ${error.message}`, false, options(undefined));
  }
  if (error instanceof OpenAI.RateLimitError) {
    // A 429 also says the account has no credit left: waiting does not help then.
    if (error.code === "insufficient_quota") {
      return new ProviderError(`The OpenAI account is out of credits: ${error.message}`, false, options("provider_quota"));
    }
  }
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.InternalServerError) {
    const wait = retryAfterMs(error.headers);
    return new ProviderError(`OpenAI is unavailable right now: ${error.message}`, true, {
      ...options(error instanceof OpenAI.RateLimitError ? "provider_rate_limit" : "provider_unavailable"),
      ...(wait === undefined ? {} : { retryAfterMs: wait }),
    });
  }
  if (error instanceof OpenAI.APIError) {
    if (typeof error.status !== "number") {
      // An error event in the middle of the stream.
      const code = error.code ?? error.type ?? null;
      return new ProviderError(`OpenAI stopped the answer: ${error.message}`, transient(code), options(errorCode(code)));
    }
    const status = error.status;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    return new ProviderError(`OpenAI API error ${status}: ${error.message}`, retryable, options(providerErrorCode(status)));
  }
  return new ProviderError("Could not reach the OpenAI API.", true, options("provider_unavailable"));
}
