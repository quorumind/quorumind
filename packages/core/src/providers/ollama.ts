import { errorMessage, type FetchLike, isAbort, readLines } from "./http.ts";
import { type GenerateRequest, type GenerateResult, type LlmProvider, ProviderError } from "./types.ts";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface OllamaOptions {
  /** Local model name, as `ollama list` shows it. */
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

interface OllamaLine {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** Local models through Ollama's native API. Nothing leaves the machine. */
export class OllamaProvider implements LlmProvider {
  readonly kind = "ollama" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(options: OllamaOptions) {
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  // The requested effort is ignored: local models have no common setting for it.
  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    const body = {
      model: this.model,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      stream: true,
      format: request.schema,
      options: { num_predict: request.maxTokens },
      // Thinking models would otherwise spend the token budget before the JSON answer.
      // Ollama only rejects `think: true` on models that cannot think.
      think: false,
    };

    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      if (isAbort(error, request.signal)) throw new ProviderError("The request was cancelled.", false, { cause: error });
      throw new ProviderError(`Ollama is not reachable at ${this.baseUrl}. Is it running?`, false, {
        cause: error,
        code: "provider_unavailable",
      });
    }
    if (!response.ok || !response.body) await this.fail(response);

    let text = "";
    let doneReason: string | undefined;
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      for await (const line of readLines(response.body as ReadableStream<Uint8Array>)) {
        if (!line.trim()) continue;
        const data = JSON.parse(line) as OllamaLine;
        if (data.error) throw new ProviderError(`Ollama failed: ${data.error}`, false);
        const delta = data.message?.content ?? "";
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        if (data.done) {
          doneReason = data.done_reason;
          usage.inputTokens = data.prompt_eval_count ?? 0;
          usage.outputTokens = data.eval_count ?? 0;
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (isAbort(error, request.signal)) throw new ProviderError("The request was cancelled.", false, { cause: error });
      throw new ProviderError("The Ollama stream was interrupted.", true, { cause: error, code: "provider_unavailable" });
    }

    if (doneReason === "length") throw new ProviderError("The answer is incomplete (num_predict).", true, { usage, model: this.model });
    // The requested name is reported as is, so the cost lookup (always free) matches it.
    return { text, model: this.model, usage };
  }

  private async fail(response: Response): Promise<never> {
    const message = await errorMessage(response);
    const status = response.status;
    if (status === 404) {
      throw new ProviderError(`Ollama does not have the model "${this.model}" (${message}). Run: ollama pull ${this.model}`, false);
    }
    if (status >= 500) throw new ProviderError(`Ollama is unavailable right now: ${message}`, true, { code: "provider_unavailable" });
    throw new ProviderError(`Ollama rejected the request: ${message}`, false);
  }
}
