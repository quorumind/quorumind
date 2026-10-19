import type { ModelPrice } from "../pricing.ts";
import {
  CLOUD_TIMEOUTS,
  callFailure,
  errorMessage,
  type FetchLike,
  readLines,
  retryAfterMs,
  type Timeouts,
  type Watch,
  watch,
} from "./http.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError, providerErrorCode } from "./types.ts";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// How OpenRouter names the app in its rankings and in the account's activity.
const ATTRIBUTION = { "HTTP-Referer": "https://quorumind.com", "X-OpenRouter-Title": "Quorumind" };

const MAKER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  qwen: "Qwen",
};

export interface OpenRouterOptions {
  apiKey?: string;
  /** An OpenRouter model id, "maker/model", e.g. "mistralai/mistral-large-4-0". */
  model: string;
  baseUrl?: string;
  /**
   * Sends the requested effort as `reasoning.effort`. Only for models that reason: the
   * routing below would otherwise find no endpoint that accepts the parameter.
   */
  reasoning?: boolean;
  /**
   * Pins every request to these endpoints, as OpenRouter names them ("mistral/eu"), without falling back to others:
   * European-only debates use it to keep a model on its maker's EU endpoint.
   */
  only?: string[];
  fetch?: FetchLike;
  /** When a stalled or endless call fails, to be tried again: CLOUD_TIMEOUTS unless set. */
  timeouts?: Timeouts;
}

interface OpenRouterChunk {
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number | string; message?: string };
}

/** A model as OpenRouter's public catalog describes it. */
export interface OpenRouterModel {
  id: string;
  /** Readable name, without the maker: "Mistral Large 4". */
  name: string;
  /** Who made the model: "Mistral". */
  maker: string;
  /** US dollars per million tokens, or null when OpenRouter gives no fixed price. */
  price: ModelPrice | null;
  /** Can answer in a strict JSON schema, which every debate step needs. */
  structuredOutputs: boolean;
  /** Accepts a reasoning effort. */
  reasoning: boolean;
}

interface ListedModel {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

/** "mistralai/mistral-large-4-0" is made by Mistral. */
export function openRouterMaker(model: string): string {
  const slug = model.split("/")[0] ?? model;
  return MAKER_NAMES[slug] ?? slug;
}

/** OpenRouter quotes US dollars per token, as strings; the price table is per million tokens. */
function perMillion(value: string | undefined): number | null {
  const perToken = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(perToken) || perToken < 0) return null;
  return Number((perToken * 1_000_000).toFixed(6));
}

function fromListing(listed: ListedModel & { id: string }): OpenRouterModel {
  // Names read "Mistral: Mistral Large 4": the maker, then the model.
  const [maker, name] = (listed.name ?? "").split(/:\s+(.*)/s);
  const input = perMillion(listed.pricing?.prompt);
  const output = perMillion(listed.pricing?.completion);
  const parameters = listed.supported_parameters ?? [];
  return {
    id: listed.id,
    name: name?.trim() || listed.name?.trim() || listed.id.split("/").slice(1).join("/") || listed.id,
    maker: (name && maker?.trim()) || openRouterMaker(listed.id),
    price: input === null || output === null ? null : { input, output },
    structuredOutputs: parameters.includes("structured_outputs"),
    reasoning: parameters.includes("reasoning"),
  };
}

/** Reads OpenRouter's public model list, which needs no key. Throws when it cannot. */
export async function listOpenRouterModels(
  options: { baseUrl?: string; fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<OpenRouterModel[]> {
  const baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${baseUrl}/models`, { signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter's model list answered ${response.status}.`);
    const body = (await response.json()) as { data?: ListedModel[] };
    return (body.data ?? []).filter((model): model is ListedModel & { id: string } => typeof model.id === "string").map(fromListing);
  } finally {
    clearTimeout(timer);
  }
}

/** Models from every maker through OpenRouter's OpenAI-compatible API, streamed as server-sent events. */
export class OpenRouterProvider implements LlmProvider {
  readonly kind = "openrouter" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly reasoning: boolean;
  private readonly only: string[] | null;
  private readonly fetch: FetchLike;
  private readonly timeouts: Timeouts;

  constructor(options: OpenRouterOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey ?? "";
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
    this.reasoning = options.reasoning ?? false;
    this.only = options.only && options.only.length > 0 ? options.only : null;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeouts = options.timeouts ?? CLOUD_TIMEOUTS;
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    // Usage, with the exact cost of the call, comes with the last chunk of every stream.
    const body = {
      model: this.model,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      max_tokens: request.maxTokens,
      stream: true,
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, schema: request.schema, strict: true },
      },
      // Only endpoints that honour every parameter here, the schema first, and that keep no data.
      provider: {
        require_parameters: true,
        data_collection: "deny",
        ...(this.only ? { only: this.only, allow_fallbacks: false } : {}),
      },
      ...(this.reasoning && request.effort ? { reasoning: { effort: request.effort, exclude: true } } : {}),
    };

    const call = watch(request.signal, this.timeouts);
    try {
      return await this.stream(body, request, call, onDelta);
    } finally {
      call.done();
    }
  }

  private async stream(body: object, request: GenerateRequest, call: Watch, onDelta?: (text: string) => void): Promise<GenerateResult> {
    const context = { api: "OpenRouter", timeouts: this.timeouts };
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, ...ATTRIBUTION },
        body: JSON.stringify(body),
        signal: call.signal,
      });
    } catch (error) {
      throw callFailure(error, call, request.signal, { ...context, interrupted: "Could not reach the OpenRouter API." });
    }
    if (!response.ok || !response.body) await this.fail(response);

    let text = "";
    let model = this.model;
    let finishReason: string | null | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let usageSeen = false;
    let costUsd: number | undefined;
    // What a failed call cost, when the stream reported it before failing: the provider bills it all the same.
    const billed = () => (usageSeen ? { usage, model, ...(costUsd === undefined ? {} : { costUsd }) } : {});
    try {
      for await (const line of readLines(response.body as ReadableStream<Uint8Array>, call.touch)) {
        // Comment lines (": OPENROUTER PROCESSING") keep the connection alive while a model thinks.
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data) as OpenRouterChunk;
        if (chunk.model) model = chunk.model;
        if (chunk.usage) {
          usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
          usageSeen = true;
          if (typeof chunk.usage.cost === "number") costUsd = chunk.usage.cost;
        }
        if (chunk.error) {
          // Once the stream has started, errors arrive as a chunk of their own, not as an HTTP status.
          const code = typeof chunk.error.code === "number" ? chunk.error.code : 500;
          throw new ProviderError(`OpenRouter stopped the answer: ${chunk.error.message ?? "unknown error"}`, retryable(code), {
            code: providerErrorCode(code),
            ...billed(),
          });
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta?.content;
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw callFailure(error, call, request.signal, {
        ...context,
        interrupted: "The OpenRouter stream was interrupted.",
        billed: billed(),
      });
    }

    if (finishReason === "length") throw new ProviderError("The answer is incomplete (max_tokens).", true, billed());
    if (finishReason === "content_filter") {
      throw new ProviderError("The model declined this request (content filter).", false, { code: "provider_refused", ...billed() });
    }
    // OpenRouter credits are US dollars.
    return { text, model, usage, ...(costUsd === undefined ? {} : { costUsd }), ...(usageSeen ? {} : { usageMissing: true as const }) };
  }

  private async fail(response: Response): Promise<never> {
    const message = await errorMessage(response);
    const status = response.status;
    const code = providerErrorCode(status);
    if (status === 401 || status === 403) throw new ProviderError("The OpenRouter API key was rejected.", false, { code });
    if (status === 402) throw new ProviderError(`The OpenRouter account is out of credits: ${message}`, false, { code });
    if (status === 400) throw new ProviderError(`OpenRouter rejected the request: ${message}`, false);
    if (status === 404) {
      throw new ProviderError(
        `OpenRouter has no endpoint for ${this.model} that supports a strict JSON schema without keeping data${this.only ? ` among ${this.only.join(", ")}` : ""}: ${message}`,
        false,
      );
    }
    if (retryable(status)) {
      const wait = retryAfterMs(response.headers);
      throw new ProviderError(`OpenRouter is unavailable right now: ${message}`, true, {
        code,
        ...(wait === undefined ? {} : { retryAfterMs: wait }),
      });
    }
    throw new ProviderError(`OpenRouter API error ${status}: ${message}`, false, { code });
  }
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
