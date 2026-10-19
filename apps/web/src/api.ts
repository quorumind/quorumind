import type {
  Answer,
  Audience,
  Branding,
  Brief,
  ClientDeliverable,
  ContextDocument,
  Depth,
  Lineup,
  Locale,
  Mode,
  ModelOption,
  OrgProfile,
  PublicQuestionnaire,
  Questionnaire,
  QuestionnaireAnswer,
  QuestionnaireQuestion,
  RequirementsSheet,
  Session,
} from "@quorumind/core";
import type { RevisionComparison } from "@quorumind/core/compare";
import type { ComplianceTemplateId } from "@quorumind/core/compliance";
import type { DecisionStatus, RegisterEntry } from "@quorumind/core/decisions";
import type { ScenarioChange } from "@quorumind/core/scenarios";
import type { EuropeanGateway, EuropeanPolicy } from "@quorumind/core/sovereignty";
import type { TemplateId } from "@quorumind/core/templates";

export type { Answer, Lineup, PublicQuestionnaire, Questionnaire, Session };

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
  /** Compliance templates, combined with the project type. */
  complianceTemplates?: ComplianceTemplateId[];
  /** European models only: the policy of the server or workspace, its default lineup, and how OpenRouter is reached. */
  european?: { policy: EuropeanPolicy; lineup: Lineup | null; gateway: EuropeanGateway };
  personas: string[];
  localOnly: boolean;
  notifications: boolean;
  retentionDays: number | null;
  maxBudgetUsd: number | null;
  /** False when the host keeps provider costs to itself: only calls and tokens are shown. */
  providerCosts: boolean;
  /** False when the host provides the organisation profile (a workspace's, hosted): it is not edited in Settings. */
  profileSettings?: boolean;
  /** True when the server names nobody (self-hosted): the register asks who approves. */
  typedNames?: boolean;
  /** The search engine of the web research (null: none, the option is not offered), and its default for a standard debate. */
  research?: { kind: "openrouter" | "brave" | null; default: boolean };
}

/** An organisation profile as the settings form sends it: the server derives the role ids and the time of the save. */
export type ProfileInput = Omit<OrgProfile, "roles" | "updatedAt"> & { roles: { name: string; dailyRate: number }[] };

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

export type ShareMode = "client" | "full";
export type ShareExpiry = "7d" | "30d" | "never";

export interface Share {
  token: string;
  public: boolean;
  createdAt: string;
  /** client: the decision deliverable only; full: the whole session, without costs or documents. */
  mode: ShareMode;
  expiresAt: string | null;
  hasPassword: boolean;
}

/** What creating or changing a share link sets; a field left out keeps its value. password: null removes it. */
export interface ShareSettings {
  public?: boolean;
  mode?: ShareMode;
  expiresIn?: ShareExpiry;
  password?: string | null;
}

/** What a share link opens on: the decision deliverable (client) or the whole session (full). */
export type SharedView = { share: { mode: "client" }; deliverable: ClientDeliverable } | { share: { mode: "full" }; session: Session };

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
  complianceTemplates: ComplianceTemplateId[];
  europeanOnly: boolean;
  /** Web research before the proposals; left out, the server's default for these settings applies. */
  webResearch?: boolean;
  depth: Depth;
  rounds: number;
  budgetUsd: number | null;
  lineup: Lineup | null;
  challenge: string | null;
  /** Audit mode: the attached documents under audit, and whether to sketch an alternative. */
  audit?: { documentIds: string[]; alternative: boolean } | null;
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
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });

/** A "what if" scenario to try: its title, its question, its changes, and the revision it branches from. */
export interface ScenarioInput {
  title: string;
  question: string | null;
  changes: ScenarioChange[];
  basedOn?: number;
}

/** A row of the decision register, with who started it and whether the caller may change it. */
export type DecisionRow = RegisterEntry & { author: Author | null; mine: boolean; canEdit: boolean; private: boolean };

/** The filters of the register; a field left out keeps every decision. author: a user id, or "me". */
export interface DecisionFilters {
  status?: DecisionStatus;
  author?: string;
  from?: string;
  to?: string;
}

export type DecisionAction = "request" | "approve" | "reject" | "reopen" | "supersede";

const query = (values: Record<string, string | undefined>) => {
  const params = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = params.toString();
  return text ? `?${text}` : "";
};
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) });

/** What creating or changing a questionnaire sets; a field left out keeps its value. password: null removes it. */
export interface QuestionnaireSettings {
  questions?: { id?: string; text: string; why: string | null; origin: QuestionnaireQuestion["origin"] }[];
  client?: string | null;
  message?: string | null;
  password?: string | null;
  expiresIn?: "7d" | "30d";
}

/** What a questionnaire link opens on: the questions, and the branding of the agency that sent them. */
export interface QuestionnaireView {
  questionnaire: PublicQuestionnaire;
  branding: Branding;
}

const questionnaireHeaders = (access: string | null) => (access ? { "X-Questionnaire-Access": access } : undefined);

export const api = {
  config: () => request<AppConfig>("/api/config"),
  /** `alternative`: an audit that sketches an alternative, which costs one more proposal. `webResearch`: left out, the default. */
  estimate: (lineup: Lineup, rounds: number, mode: Mode, depth: Depth, locale: Locale, alternative = false, webResearch?: boolean) =>
    request<{ estimateUsd: Estimate; price: PriceQuote | null; research?: { default: boolean } }>(
      "/api/estimate",
      post({
        lineup,
        rounds,
        mode,
        depth,
        locale,
        ...(alternative ? { audit: { alternative } } : {}),
        ...(webResearch === undefined ? {} : { webResearch }),
      }),
    ),
  sessions: (mine = false) => request<{ sessions: SessionSummary[]; shared?: boolean }>(`/api/sessions${mine ? "?mine=1" : ""}`),
  session: (id: string) =>
    request<{
      session: Session;
      busy: boolean;
      share: Share | null;
      feedback: Feedback[];
      price: PriceQuote | null;
      /** What the next revision of the verdict costs, when the host sells revisions. */
      revisionPrice?: PriceQuote | null;
      providerCosts: boolean;
      access?: SessionAccess;
    }>(`/api/sessions/${id}`),
  /** A revision of the verdict from facts the person states. */
  revise: (id: string, input: { facts: { question: string | null; answer: string; comment: string | null }[]; note: string | null }) =>
    request<{ accepted: true; revision: number }>(`/api/sessions/${id}/revisions`, post(input)),
  questionnaires: (id: string) => request<{ questionnaires: Questionnaire[] }>(`/api/sessions/${id}/questionnaires`),
  createQuestionnaire: (id: string, settings: QuestionnaireSettings) =>
    request<{ questionnaire: Questionnaire }>(`/api/sessions/${id}/questionnaires`, post(settings)),
  updateQuestionnaire: (id: string, qid: string, settings: QuestionnaireSettings) =>
    request<{ questionnaire: Questionnaire }>(`/api/sessions/${id}/questionnaires/${qid}`, patch(settings)),
  reopenQuestionnaire: (id: string, qid: string) =>
    request<{ questionnaire: Questionnaire }>(`/api/sessions/${id}/questionnaires/${qid}/reopen`, post()),
  deleteQuestionnaire: (id: string, qid: string) => request<void>(`/api/sessions/${id}/questionnaires/${qid}`, { method: "DELETE" }),
  /** "Update the recommendation": a revision of the verdict from the client's answers. */
  reviseFromAnswers: (id: string, qid: string) =>
    request<{ accepted: true; revision: number }>(`/api/sessions/${id}/questionnaires/${qid}/revision`, post()),
  questionnaireWordUrl: (id: string, qid: string) => `/api/sessions/${id}/questionnaires/${qid}/questionnaire.docx`,
  /** The client's side of a questionnaire link; `access` is the token its password gives. */
  questionnaire: (token: string, access: string | null) =>
    request<QuestionnaireView>(`/api/questionnaire/${token}`, { headers: questionnaireHeaders(access) }),
  questionnaireAccess: (token: string, password: string) =>
    request<{ access: string | null; expiresAt: string | null }>(`/api/questionnaire/${token}/access`, post({ password })),
  submitAnswers: (token: string, access: string | null, answers: QuestionnaireAnswer[]) =>
    request<{ questionnaire: PublicQuestionnaire }>(`/api/questionnaire/${token}/answers`, {
      ...post({ answers }),
      headers: questionnaireHeaders(access),
    }),
  sharedQuestionnaireWordUrl: (token: string, access: string | null) =>
    `/api/questionnaire/${token}/questionnaire.docx${access ? `?access=${encodeURIComponent(access)}` : ""}`,
  setPrivate: (id: string, isPrivate: boolean) =>
    request<{ access: SessionAccess }>(`/api/sessions/${id}/visibility`, { method: "PUT", body: JSON.stringify({ private: isPrivate }) }),
  create: (input: NewSessionInput) => request<{ session: Session }>("/api/sessions", post(input)),
  remove: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  answerInterview: (id: string, answers: Answer[]) => request(`/api/sessions/${id}/interview`, post({ answers })),
  /** `ignoreProfile` runs the debate without the organisation profile. */
  confirmSheet: (id: string, sheet: RequirementsSheet, ignoreProfile = false) =>
    request(`/api/sessions/${id}/sheet`, { method: "PUT", body: JSON.stringify({ sheet, ignoreProfile }) }),
  profile: () => request<{ profile: OrgProfile | null }>("/api/profile"),
  /** Saves the organisation profile, or removes it (null). */
  saveProfile: (profile: ProfileInput | null) =>
    request<{ profile: OrgProfile | null }>("/api/profile", { method: "PUT", body: JSON.stringify({ profile }) }),
  branding: () => request<{ branding: Branding }>("/api/branding"),
  saveBranding: (branding: Branding) => request<{ branding: Branding }>("/api/branding", put(branding)),
  answerDebate: (id: string, answers: Answer[]) => request(`/api/sessions/${id}/answers`, post({ answers })),
  /** Retries a failed session, with a new cost cap when `budgetUsd` is given (self-hosted only). */
  resume: (id: string, budgetUsd?: number) => request(`/api/sessions/${id}/resume`, post(budgetUsd === undefined ? {} : { budgetUsd })),
  stop: (id: string) => request<{ session: Session }>(`/api/sessions/${id}/stop`, post()),
  brief: (id: string, audience: Audience) => request<{ brief: Brief }>(`/api/sessions/${id}/brief`, post({ audience })),
  fork: (id: string) => request<{ session: Session }>(`/api/sessions/${id}/fork`, post()),
  share: (id: string, settings: ShareSettings) => request<{ share: Share }>(`/api/sessions/${id}/share`, post(settings)),
  unshare: (id: string) => request<void>(`/api/sessions/${id}/share`, { method: "DELETE" }),
  feedback: (id: string, input: { helpful: boolean | null; kind: "rating" | "error"; comment: string }) =>
    request<{ feedback: Feedback[] }>(`/api/sessions/${id}/feedback`, post(input)),
  /** `access` is the token a protected link gives for its password. */
  shared: (token: string, access: string | null) =>
    request<SharedView>(`/api/shared/${token}`, access ? { headers: { "X-Share-Access": access } } : undefined),
  shareAccess: (token: string, password: string) =>
    request<{ access: string | null; expiresAt: string | null }>(`/api/shared/${token}/access`, post({ password })),
  gallery: () => request<{ sessions: GalleryItem[] }>("/api/gallery"),
  reportUrl: (id: string) => `/api/sessions/${id}/report.md`,
  sharedReportUrl: (token: string, access: string | null = null) =>
    `/api/shared/${token}/report.md${access ? `?access=${encodeURIComponent(access)}` : ""}`,
  exportUrl: () => "/api/export",
  /** A "what if" scenario: a revision of its own, at the price of a revision. */
  scenario: (id: string, input: ScenarioInput) =>
    request<{ accepted: true; revision: number }>(`/api/sessions/${id}/scenarios`, post(input)),
  /** Adopts a scenario as the decision, or goes back to the latest revision (null). */
  adopt: (id: string, revision: number | null) =>
    request<{ adopted: number | null; decision: RegisterEntry | null }>(`/api/sessions/${id}/adopted`, put({ revision })),
  compare: (id: string, a: number, b: number) =>
    request<{ comparison: RevisionComparison }>(`/api/sessions/${id}/compare${query({ a: String(a), b: String(b) })}`),
  compareUrl: (id: string, a: number, b: number, format: "md" | "html" | "pdf") =>
    `/api/sessions/${id}/compare.${format === "md" ? "md" : "html"}${query({ a: String(a), b: String(b), print: format === "pdf" ? "1" : undefined })}`,
  decisions: (filters: DecisionFilters = {}) =>
    request<{ decisions: DecisionRow[]; authors: (Author & { id: string })[]; shared: boolean }>(`/api/decisions${query({ ...filters })}`),
  decisionsCsvUrl: (filters: DecisionFilters, lang: string) => `/api/decisions.csv${query({ ...filters, lang })}`,
  /** A step of the register; `by` names the superseding session. */
  decide: (id: string, action: DecisionAction, input: { comment?: string | null; name?: string | null; by?: string } = {}) =>
    request<{ decision: RegisterEntry }>(`/api/sessions/${id}/decision/${action}`, post(input)),
  /** The note and the review of a decision; a field left out keeps its value. */
  decisionDetails: (id: string, details: { note?: string | null; review?: { on: string | null; when: string | null } }) =>
    request<{ decision: RegisterEntry }>(`/api/sessions/${id}/decision`, put(details)),
};
