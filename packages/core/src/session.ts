import type { Locale } from "./locales.ts";
import type { ProviderKind, Task } from "./providers/types.ts";
import type { CritiqueRound, InterviewTurn, Proposal, RequirementsSheet, Revision, Verdict } from "./schemas.ts";

export type Phase = "interview" | "review" | "debating" | "awaiting_answers" | "complete" | "failed";

export interface Participant {
  provider: ProviderKind;
  model: string;
}

export interface Answer {
  question: string;
  answer: string;
}

export type InterviewEntry = { kind: "interviewer"; data: InterviewTurn } | { kind: "user"; answers: Answer[] };

export type DebateEntry =
  | { kind: "proposal"; round: 0; seat: string; data: Proposal }
  | { kind: "critiques"; round: number; seat: string; data: CritiqueRound }
  | { kind: "questions"; round: number; questions: string[] }
  | { kind: "answers"; round: number; answers: Answer[] }
  | { kind: "revision"; round: number; seat: string; data: Revision }
  | { kind: "verdict"; data: Verdict };

export interface UsageRecord {
  task: Task;
  seat: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  locale: Locale;
  idea: string;
  demo: boolean;
  phase: Phase;
  /** Number of critique and revision cycles after the blind proposals. */
  rounds: number;
  budgetUsd: number | null;
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant>;
  interview: InterviewEntry[];
  sheet: RequirementsSheet | null;
  /** Set when the person validates the requirements sheet and the debate may start. */
  sheetConfirmedAt: string | null;
  debate: DebateEntry[];
  verdict: Verdict | null;
  usage: UsageRecord[];
  error: { code: string; message: string } | null;
}

export interface NewSessionInput {
  locale: Locale;
  idea: string;
  demo: boolean;
  rounds?: number;
  budgetUsd?: number | null;
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant>;
}

export const MAX_ROUNDS = 3;

export function createSession(input: NewSessionInput): Session {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    locale: input.locale,
    idea: input.idea,
    demo: input.demo,
    phase: "interview",
    rounds: Math.min(MAX_ROUNDS, Math.max(1, input.rounds ?? 1)),
    budgetUsd: input.budgetUsd ?? null,
    interviewer: input.interviewer,
    arbiter: input.arbiter,
    seats: input.seats,
    interview: [],
    sheet: null,
    sheetConfirmedAt: null,
    debate: [],
    verdict: null,
    usage: [],
    error: null,
  };
}

export function totalCost(session: Session): { usd: number; complete: boolean } {
  let usd = 0;
  let complete = true;
  for (const record of session.usage) {
    if (record.costUsd === null) complete = false;
    else usd += record.costUsd;
  }
  return { usd, complete };
}

/** Latest version of each proposal: the revised one when a revision exists. */
export function currentProposals(session: Session): Record<string, Proposal> {
  const proposals: Record<string, Proposal> = {};
  for (const entry of session.debate) {
    if (entry.kind === "proposal") proposals[entry.seat] = entry.data;
    if (entry.kind === "revision") proposals[entry.seat] = entry.data.proposal;
  }
  return proposals;
}

export function allAnswers(session: Session): Answer[] {
  return session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
}
