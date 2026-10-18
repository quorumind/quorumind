import OpenAI from "openai";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError, providerErrorCode } from "./types.ts";

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
}

export class OpenAiProvider implements LlmProvider {
  readonly kind = "openai" as const;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly reasoning: boolean;

  constructor(options: OpenAiOptions) {
    this.client = new OpenAI({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.model = options.model;
    this.reasoning = options.reasoning ?? false;
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
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
        { signal: request.signal },
      );
      if (onDelta) {
        stream.on("response.output_text.delta", (event) => onDelta(event.delta));
      }
      const response = await stream.finalResponse();
      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason;
        throw new ProviderError(`The answer is incomplete (${reason ?? "unknown reason"}).`, true, {
          code: reason === "content_filter" ? "provider_refused" : "provider_error",
        });
      }
      return {
        text: response.output_text,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof OpenAI.AuthenticationError) {
        throw new ProviderError("The OpenAI API key was rejected.", false, { cause: error, code: "provider_auth" });
      }
      if (error instanceof OpenAI.BadRequestError) {
        throw new ProviderError(`OpenAI rejected the request: ${error.message}`, false, { cause: error });
      }
      if (error instanceof OpenAI.RateLimitError) {
        throw new ProviderError(`OpenAI is unavailable right now: ${error.message}`, true, { cause: error, code: "provider_rate_limit" });
      }
      if (error instanceof OpenAI.InternalServerError) {
        throw new ProviderError(`OpenAI is unavailable right now: ${error.message}`, true, { cause: error, code: "provider_unavailable" });
      }
      if (error instanceof OpenAI.APIError) {
        throw new ProviderError(`OpenAI API error ${error.status}: ${error.message}`, false, {
          cause: error,
          code: typeof error.status === "number" ? providerErrorCode(error.status) : "provider_error",
        });
      }
      throw new ProviderError("Could not reach the OpenAI API.", true, { cause: error, code: "provider_unavailable" });
    }
  }
}
