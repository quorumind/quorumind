export type ProviderKind = "anthropic" | "openai" | "gemini" | "openrouter" | "ollama" | "mock";

/** How hard a model thinks before answering: the debate "depth". */
export type Effort = "low" | "medium" | "high";

export type Task = "interview" | "proposal" | "critique" | "revision" | "probe" | "verdict" | "brief";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  task: Task;
  /** Seat letter for proposers, used by the mock provider and for logging. */
  seat: string | null;
  system: string;
  messages: ChatMessage[];
  /** Strict JSON schema the answer must follow. */
  schema: { [key: string]: unknown };
  schemaName: string;
  maxTokens: number;
  /** How hard the model should think, from the session's depth; absent means the provider's default. */
  effort?: Effort;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  /** Raw JSON text returned by the model. */
  text: string;
  usage: Usage;
  /** Model that actually served the request (may differ after a server-side fallback). */
  model: string;
  /** What the provider charged for this call in US dollars, when it says so. Wins over the price table. */
  costUsd?: number;
}

export interface LlmProvider {
  readonly kind: ProviderKind;
  readonly model: string;
  generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}
