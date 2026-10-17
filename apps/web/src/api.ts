import type { Answer, Lineup, Locale, RequirementsSheet, Session } from "@quorumind/core";

export type { Answer, Lineup, Session };

export interface AppConfig {
  live: { lineup: Lineup; estimateUsd: { low: number; high: number } | null } | null;
  demo: { lineup: Lineup; idea: string };
}

export interface SessionSummary {
  id: string;
  idea: string;
  phase: Session["phase"];
  updatedAt: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "error", body.message ?? response.statusText);
  return body as T;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  sessions: () => request<{ sessions: SessionSummary[] }>("/api/sessions"),
  session: (id: string) => request<{ session: Session; busy: boolean }>(`/api/sessions/${id}`),
  create: (input: { locale: Locale; idea: string; demo: boolean; rounds: number; budgetUsd: number | null }) =>
    request<{ session: Session }>("/api/sessions", { method: "POST", body: JSON.stringify(input) }),
  answerInterview: (id: string, answers: Answer[]) =>
    request(`/api/sessions/${id}/interview`, { method: "POST", body: JSON.stringify({ answers }) }),
  confirmSheet: (id: string, sheet: RequirementsSheet) =>
    request(`/api/sessions/${id}/sheet`, { method: "PUT", body: JSON.stringify({ sheet }) }),
  answerDebate: (id: string, answers: Answer[]) =>
    request(`/api/sessions/${id}/answers`, { method: "POST", body: JSON.stringify({ answers }) }),
  resume: (id: string) => request(`/api/sessions/${id}/resume`, { method: "POST", body: "{}" }),
  reportUrl: (id: string) => `/api/sessions/${id}/report.md`,
};
