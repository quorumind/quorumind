import type {
  Answer,
  ContextDocument,
  Costing,
  Depth,
  EngineEvent,
  Mode,
  OptionChecks,
  RegisterEntry,
  RequirementsSheet,
  ScenarioChange,
  Session,
  TemplateId,
} from "@quorumind/core";

/** The price the host sells a debate at (hosted version), instead of what the providers charge. */
export interface PriceQuote {
  /** In `currency`; 0 when the person's plan covers it. */
  amount: number;
  currency: string;
  label: string;
}

/** What the server computed about the options' costs: their costing and their budget and deadline checks. */
export interface SessionCosts {
  costings?: Record<string, Costing>;
  checks?: Record<string, OptionChecks>;
}

export interface SessionState extends SessionCosts {
  session: Session;
  /** True while a model is working on the session. */
  busy: boolean;
  /** The host's price of the debate, when it sets one. */
  price?: PriceQuote | null;
  /** False when the host keeps provider costs to itself: the session's calls then carry no cost. */
  providerCosts?: boolean;
}

export interface SessionSummary {
  id: string;
  idea: string;
  phase: string;
  updatedAt: string;
  /** In a workspace's shared history (hosted version): whether the caller started it, and who did otherwise. */
  mine?: boolean;
  author?: { name: string | null; email: string | null } | null;
}

/** A row of the decision register, as the server sends it. */
export type DecisionRow = RegisterEntry & { author: { name: string | null; email: string | null } | null; mine: boolean; canEdit: boolean };

export interface QuorumindConfig {
  locales: { code: string }[];
  live: { lineup: unknown; estimateUsd?: { low: number; high: number } | null } | null;
  templates?: string[];
  personas?: string[];
  /** False on the hosted version: debates have a price, provider costs are not shown. */
  providerCosts?: boolean;
}

export interface NewSession {
  locale: string;
  idea: string;
  demo: boolean;
  mode?: Mode;
  template?: TemplateId | null;
  depth?: Depth;
  rounds?: number;
  budgetUsd?: number | null;
  challenge?: string | null;
  context?: ContextDocument[];
  redact?: boolean;
}

/** An error answered by the Quorumind server, or the server being unreachable (status 0). */
export class QuorumindError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "QuorumindError";
    this.status = status;
    this.code = code;
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Sent as a bearer token, for the hosted version. */
  token?: string | null;
  fetch?: typeof fetch;
}

/** Talks to a running Quorumind server over its HTTP API. It never calls a model provider itself. */
export class QuorumindClient {
  readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token || null;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Where a person can follow the session in the Quorumind interface. */
  sessionUrl(id: string) {
    return `${this.baseUrl}/#/s/${id}`;
  }

  config() {
    return this.json<QuorumindConfig>("GET", "/api/config");
  }

  async listSessions() {
    return (await this.json<{ sessions: SessionSummary[] }>("GET", "/api/sessions")).sessions;
  }

  async createSession(input: NewSession) {
    return (await this.json<{ session: Session }>("POST", "/api/sessions", input)).session;
  }

  getSession(id: string) {
    return this.json<SessionState>("GET", `/api/sessions/${encodeURIComponent(id)}`);
  }

  async answerInterview(id: string, answers: Answer[]) {
    await this.json("POST", `/api/sessions/${encodeURIComponent(id)}/interview`, { answers });
  }

  /** `ignoreProfile` debates without the organisation profile. */
  async confirmSheet(id: string, sheet: RequirementsSheet, ignoreProfile?: boolean) {
    await this.json("PUT", `/api/sessions/${encodeURIComponent(id)}/sheet`, {
      sheet,
      ...(ignoreProfile === undefined ? {} : { ignoreProfile }),
    });
  }

  async answerDebate(id: string, answers: Answer[]) {
    await this.json("POST", `/api/sessions/${encodeURIComponent(id)}/answers`, { answers });
  }

  /** Retries a failed session; `budgetUsd` raises its cost cap first. */
  async resume(id: string, budgetUsd?: number) {
    await this.json("POST", `/api/sessions/${encodeURIComponent(id)}/resume`, budgetUsd === undefined ? {} : { budgetUsd });
  }

  /** Stops the work in flight; answers once it has stopped, with the session as it was left. */
  async stop(id: string) {
    return (await this.json<{ session: Session }>("POST", `/api/sessions/${encodeURIComponent(id)}/stop`, {})).session;
  }

  /** Starts a "what if" scenario: a revision of the verdict of its own. Returns its number. */
  async createScenario(id: string, input: { title: string; question: string | null; changes: ScenarioChange[]; basedOn?: number }) {
    return (await this.json<{ revision: number }>("POST", `/api/sessions/${encodeURIComponent(id)}/scenarios`, input)).revision;
  }

  async decisions(filters: { status?: string; author?: string } = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return (await this.json<{ decisions: DecisionRow[] }>("GET", `/api/decisions${query ? `?${query}` : ""}`)).decisions;
  }

  /** A step of the decision register: approve the current version, or ask for its approval. */
  async decide(id: string, action: "approve" | "request", input: { comment: string | null; name: string | null }) {
    return (await this.json<{ decision: RegisterEntry }>("POST", `/api/sessions/${encodeURIComponent(id)}/decision/${action}`, input))
      .decision;
  }

  async text(path: string) {
    return (await this.send("GET", path)).text();
  }

  async bytes(path: string) {
    return Buffer.from(await (await this.send("GET", path)).arrayBuffer());
  }

  /** A download with the file name the server gives it (Content-Disposition), if any. */
  async file(path: string): Promise<{ data: Buffer; name: string | null }> {
    const response = await this.send("GET", path);
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? null;
    return { data: Buffer.from(await response.arrayBuffer()), name };
  }

  /**
   * Follows the live event stream of a session until the signal aborts or the stream ends.
   * Rejects when the stream cannot be opened, so the caller can fall back to polling.
   */
  async events(id: string, signal: AbortSignal, onEvent: (event: EngineEvent) => void): Promise<void> {
    const response = await this.send("GET", `/api/sessions/${encodeURIComponent(id)}/events`, undefined, signal, "text/event-stream");
    if (!response.body) throw new QuorumindError(response.status, "no_stream", "The event stream has no body.");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true }).replace(/\r\n?/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data) as EngineEvent);
          } catch {
            // Pings and unknown payloads are not events.
          }
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }

  private async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    return (await response.json()) as T;
  }

  private async send(method: string, path: string, body?: unknown, signal?: AbortSignal, accept = "application/json") {
    const headers: Record<string, string> = { Accept: accept };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new QuorumindError(
        0,
        "unreachable",
        `Cannot reach Quorumind at ${this.baseUrl}. Start the server (npm start in the Quorumind repository) or set QUORUMIND_URL.`,
      );
    }
    if (!response.ok) throw await toError(response);
    return response;
  }
}

async function toError(response: Response): Promise<QuorumindError> {
  let body: { error?: string; message?: string; issues?: { path?: unknown[]; message?: string }[] } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON: a proxy or an older server.
  }
  const issues = body.issues?.map((issue) => `${(issue.path ?? []).join(".") || "body"}: ${issue.message ?? "invalid"}`).join("; ");
  const fallback =
    response.status === 401 || response.status === 403
      ? "Quorumind refused the request: check QUORUMIND_TOKEN."
      : `Quorumind answered HTTP ${response.status}.`;
  // Signed out, or a token that is wrong, expired or revoked: the server's words, and where to look.
  const message = body.message ?? (issues || fallback);
  const withHint = response.status === 401 && !message.includes("QUORUMIND_TOKEN") ? `${message} Check QUORUMIND_TOKEN.` : message;
  return new QuorumindError(response.status, body.error ?? `http_${response.status}`, withHint);
}
