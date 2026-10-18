import type {
  Answer,
  Audience,
  Brief,
  ContextDocument,
  Depth,
  Lineup,
  Locale,
  Mode,
  ModelOption,
  RequirementsSheet,
  Session,
} from "@quorumind/core";
import type { TemplateId } from "@quorumind/core/templates";

export type { Answer, Lineup, Session };

type Estimate = { low: number; high: number } | null;

/** The price the host sells a debate at, when it sets one (hosted version). */
export interface PriceQuote {
  /** In `currency`; 0 when the person's plan covers it. */
  amount: number;
  currency: string;
  label: string;
}

export interface AppConfig {
  catalog: ModelOption[];
  live: { lineup: Lineup; estimateUsd: Estimate } | null;
  demo: { lineup: Lineup; idea: string };
  templates: TemplateId[];
  personas: string[];
  localOnly: boolean;
  notifications: boolean;
  retentionDays: number | null;
  maxBudgetUsd: number | null;
  /** False when the host keeps provider costs to itself: only calls and tokens are shown. */
  providerCosts: boolean;
}

export interface SessionSummary {
  id: string;
  idea: string;
  phase: Session["phase"];
  mode?: Mode;
  updatedAt: string;
  /** In a workspace's shared history (hosted version): whether the caller started it, and who did otherwise. */
  mine?: boolean;
  private?: boolean;
  author?: Author | null;
}

/** Who started a session someone else did; null for a former member of the workspace. */
export interface Author {
  name: string | null;
  email: string | null;
}

/** What the caller may do with a session: everything when it is theirs, read and start again from it otherwise. */
export interface SessionAccess {
  mine: boolean;
  canEdit: boolean;
  /** It belongs to a workspace whose members can read it. */
  shared: boolean;
  private: boolean;
  author?: Author | null;
}

export interface Share {
  token: string;
  public: boolean;
  createdAt: string;
}

export interface Feedback {
  helpful: boolean | null;
  kind: "rating" | "error";
  comment: string;
  createdAt: string;
}

export interface GalleryItem extends SessionSummary {
  token: string;
  summary: string | null;
}

export interface NewSessionInput {
  locale: Locale;
  idea: string;
  demo: boolean;
  mode: Mode;
  template: TemplateId | null;
  depth: Depth;
  rounds: number;
  budgetUsd: number | null;
  lineup: Lineup | null;
  challenge: string | null;
  context: ContextDocument[];
  redact: boolean;
  notify: boolean;
}

/** An error answered by the server: a stable code the interface translates (errors.ts), with its parameters. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: Record<string, string | number>;
  constructor(status: number, code: string, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; params?: Record<string, string | number> };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "error", body.message ?? response.statusText, body.params);
  return body as T;
}

const post = (body: unknown = {}) => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  config: () => request<AppConfig>("/api/config"),
  estimate: (lineup: Lineup, rounds: number, mode: Mode, depth: Depth, locale: Locale) =>
    request<{ estimateUsd: Estimate; price: PriceQuote | null }>("/api/estimate", post({ lineup, rounds, mode, depth, locale })),
  sessions: (mine = false) => request<{ sessions: SessionSummary[]; shared?: boolean }>(`/api/sessions${mine ? "?mine=1" : ""}`),
  session: (id: string) =>
    request<{
      session: Session;
      busy: boolean;
      share: Share | null;
      feedback: Feedback[];
      price: PriceQuote | null;
      providerCosts: boolean;
      access?: SessionAccess;
    }>(`/api/sessions/${id}`),
  setPrivate: (id: string, isPrivate: boolean) =>
    request<{ access: SessionAccess }>(`/api/sessions/${id}/visibility`, { method: "PUT", body: JSON.stringify({ private: isPrivate }) }),
  create: (input: NewSessionInput) => request<{ session: Session }>("/api/sessions", post(input)),
  remove: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  answerInterview: (id: string, answers: Answer[]) => request(`/api/sessions/${id}/interview`, post({ answers })),
  confirmSheet: (id: string, sheet: RequirementsSheet) =>
    request(`/api/sessions/${id}/sheet`, { method: "PUT", body: JSON.stringify({ sheet }) }),
  answerDebate: (id: string, answers: Answer[]) => request(`/api/sessions/${id}/answers`, post({ answers })),
  /** Retries a failed session, with a new cost cap when `budgetUsd` is given (self-hosted only). */
  resume: (id: string, budgetUsd?: number) => request(`/api/sessions/${id}/resume`, post(budgetUsd === undefined ? {} : { budgetUsd })),
  stop: (id: string) => request<{ session: Session }>(`/api/sessions/${id}/stop`, post()),
  brief: (id: string, audience: Audience) => request<{ brief: Brief }>(`/api/sessions/${id}/brief`, post({ audience })),
  fork: (id: string) => request<{ session: Session }>(`/api/sessions/${id}/fork`, post()),
  share: (id: string, isPublic: boolean) => request<{ share: Share }>(`/api/sessions/${id}/share`, post({ public: isPublic })),
  unshare: (id: string) => request<void>(`/api/sessions/${id}/share`, { method: "DELETE" }),
  feedback: (id: string, input: { helpful: boolean | null; kind: "rating" | "error"; comment: string }) =>
    request<{ feedback: Feedback[] }>(`/api/sessions/${id}/feedback`, post(input)),
  shared: (token: string) => request<{ session: Session }>(`/api/shared/${token}`),
  gallery: () => request<{ sessions: GalleryItem[] }>("/api/gallery"),
  reportUrl: (id: string) => `/api/sessions/${id}/report.md`,
  sharedReportUrl: (token: string) => `/api/shared/${token}/report.md`,
  exportUrl: () => "/api/export",
};
