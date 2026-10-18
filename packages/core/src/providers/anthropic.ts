import Anthropic from "@anthropic-ai/sdk";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError, providerErrorCode } from "./types.ts";

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export class AnthropicProvider implements LlmProvider {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: NonNullable<AnthropicOptions["effort"]>;

  constructor(options: AnthropicOptions = {}) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "high";
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
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
      if (onDelta) {
        stream.on("text", (delta) => onDelta(delta));
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new ProviderError(`The model declined this request (${message.stop_details?.category ?? "no category"}).`, false, {
          code: "provider_refused",
        });
      }
      if (message.stop_reason === "max_tokens") {
        throw new ProviderError("The answer was cut off by the token limit.", true);
      }
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return {
        text,
        model: message.model,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ProviderError("The Anthropic API key was rejected.", false, { cause: error, code: "provider_auth" });
      }
      if (error instanceof Anthropic.BadRequestError) {
        throw new ProviderError(`Anthropic rejected the request: ${error.message}`, false, { cause: error });
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ProviderError(`Anthropic is unavailable right now: ${error.message}`, true, {
          cause: error,
          code: "provider_rate_limit",
        });
      }
      if (error instanceof Anthropic.InternalServerError) {
        throw new ProviderError(`Anthropic is unavailable right now: ${error.message}`, true, {
          cause: error,
          code: "provider_unavailable",
        });
      }
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError(`Anthropic API error ${error.status}: ${error.message}`, false, {
          cause: error,
          code: typeof error.status === "number" ? providerErrorCode(error.status) : "provider_error",
        });
      }
      throw new ProviderError("Could not reach the Anthropic API.", true, { cause: error, code: "provider_unavailable" });
    }
  }
}
