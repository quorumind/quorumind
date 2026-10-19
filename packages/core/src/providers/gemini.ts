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

export interface GeminiOptions {
  apiKey?: string;
  /** Required: Gemini model identifiers change often, so none is assumed. */
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** When a stalled or endless call fails, to be tried again: CLOUD_TIMEOUTS unless set. */
  timeouts?: Timeouts;
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/** Google Gemini through its REST API, streamed as server-sent events. */
export class GeminiProvider implements LlmProvider {
  readonly kind = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeouts: Timeouts;

  constructor(options: GeminiOptions) {
    this.model = options.model.replace(/^models\//, "");
    this.apiKey = options.apiKey ?? "";
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeouts = options.timeouts ?? CLOUD_TIMEOUTS;
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?alt=sse`;
    // Thinking is left to the model's default: the thinking settings differ between
    // Gemini generations, and a wrong one makes the whole request fail.
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
        maxOutputTokens: request.maxTokens,
      },
    };

    const call = watch(request.signal, this.timeouts);
    try {
      return await this.stream(url, body, request, call, onDelta);
    } finally {
      call.done();
    }
  }

  private async stream(
    url: string,
    body: object,
    request: GenerateRequest,
    call: Watch,
    onDelta?: (text: string) => void,
  ): Promise<GenerateResult> {
    const context = { api: "Gemini", timeouts: this.timeouts };
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: call.signal,
      });
    } catch (error) {
      throw callFailure(error, call, request.signal, { ...context, interrupted: "Could not reach the Gemini API." });
    }
    if (!response.ok || !response.body) await this.fail(response);

    let text = "";
    let model = this.model;
    let finishReason: string | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let usageSeen = false;
    // What a failed call cost, when the stream reported it: the provider bills it all the same.
    const billed = () => (usageSeen ? { usage, model } : {});
    try {
      for await (const line of readLines(response.body as ReadableStream<Uint8Array>, call.touch)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        const chunk = JSON.parse(data) as GeminiChunk;
        if (chunk.promptFeedback?.blockReason) {
          throw new ProviderError(`Gemini blocked this request (${chunk.promptFeedback.blockReason}).`, false, {
            code: "provider_refused",
          });
        }
        if (chunk.modelVersion) model = chunk.modelVersion;
        if (chunk.usageMetadata) {
          const meta = chunk.usageMetadata;
          usage = {
            inputTokens: meta.promptTokenCount ?? 0,
            // Thinking tokens are billed as output.
            outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
          };
          usageSeen = true;
        }
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;
        if (candidate.finishReason) finishReason = candidate.finishReason;
        const delta = (candidate.content?.parts ?? [])
          .filter((part) => !part.thought && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw callFailure(error, call, request.signal, { ...context, interrupted: "The Gemini stream was interrupted.", billed: billed() });
    }

    if (finishReason === "MAX_TOKENS") {
      throw new ProviderError("The answer is incomplete (max_output_tokens).", true, billed());
    }
    if (finishReason && finishReason !== "STOP" && finishReason !== "FINISH_REASON_UNSPECIFIED") {
      // SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT…: the model would not write this answer.
      throw new ProviderError(`Gemini stopped the answer (${finishReason}).`, false, { code: "provider_refused", ...billed() });
    }
    return { text, model, usage, ...(usageSeen ? {} : { usageMissing: true as const }) };
  }

  private async fail(response: Response): Promise<never> {
    const message = await errorMessage(response);
    const status = response.status;
    const code = providerErrorCode(status);
    if (status === 401 || status === 403) throw new ProviderError("The Gemini API key was rejected.", false, { code });
    if (status === 400) throw new ProviderError(`Gemini rejected the request: ${message}`, false);
    if (status === 429 || status >= 500) {
      const wait = retryAfterMs(response.headers);
      throw new ProviderError(`Gemini is unavailable right now: ${message}`, true, {
        code,
        ...(wait === undefined ? {} : { retryAfterMs: wait }),
      });
    }
    throw new ProviderError(`Gemini API error ${status}: ${message}`, false, { code });
  }
}
