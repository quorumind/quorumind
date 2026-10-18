import type { Locale } from "./locales.ts";
import type { OrgProfile } from "./profile.ts";
import type { ProviderKind, Task } from "./providers/types.ts";
import type {
  Audience,
  Brief,
  Compliance,
  CritiqueRound,
  InterviewTurn,
  Probe,
  Proposal,
  RequirementsSheet,
  Revision,
  Verdict,
} from "./schemas.ts";
import type { TemplateId } from "./templates.ts";

export type Phase = "interview" | "review" | "debating" | "awaiting_answers" | "complete" | "failed";

/**
 * standard: the models design competing options. express: five questions and one short round.
 * challenge: the person brings their own solution and the models only look for its flaws.
 */
export type Mode = "standard" | "express" | "challenge";
export const MODES: readonly Mode[] = ["standard", "express", "challenge"];

/** How hard the models think: maps to each provider's reasoning effort. */
export type Depth = "quick" | "standard" | "deep";
export const DEPTHS: readonly Depth[] = ["quick", "standard", "deep"];

export interface Participant {
  provider: ProviderKind;
  model: string;
}

/** A debating model, with the expert role it plays: a preset id or free text. */
export interface Seat extends Participant {
  persona: string | null;
}

/** Seat of the person's own solution in challenge mode. */
export const USER_SEAT = "U";
/** Seat of the devil's advocate: it criticises every option and proposes none. */
export const DEVIL_SEAT = "devil";
export const PROPOSER_SEATS = ["A", "B", "C", "D"] as const;

/** A document the person attached to frame the project: treated as data, never as instructions. */
export interface ContextDocument {
  id: string;
  kind: "file" | "url" | "github" | "text";
  /** Title shown to the person and the models: the file name, the page title, the repository. */
  name: string;
  text: string;
  /** Where the text comes from: the file name, the page address or the repository address. */
  source?: string;
  /** The text was cut to MAX_CONTEXT_CHARS when it was imported. */
  truncated?: boolean;
}

/** Documents a session can carry. The server, the interface and the MCP server all use these limits. */
export const MAX_CONTEXT_DOCUMENTS = 5;
/** Characters kept from one document. The prompts read a shorter share of it (see CONTEXT_BUDGET). */
export const MAX_CONTEXT_CHARS = 100_000;
/** Largest file the server reads, uploaded or fetched from the web. */
export const MAX_CONTEXT_FILE_BYTES = 10 * 1024 * 1024;

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
  | { kind: "probe"; round: number; data: Probe }
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
  mode: Mode;
  template: TemplateId | null;
  depth: Depth;
  phase: Phase;
  /** Number of critique and revision cycles after the blind proposals. */
  rounds: number;
  budgetUsd: number | null;
  /**
   * Set when the remaining rounds were skipped so that the verdict fits in the cost cap: the rounds every participant
   * finished before the arbiter ruled.
   */
  shortened: { rounds: number } | null;
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Seat>;
  devil: Seat | null;
  /** The person's own solution, in challenge mode. */
  challenge: string | null;
  context: ContextDocument[];
  /** Mask e-mails, phone numbers, card numbers and secrets before anything is sent to a provider. */
  redact: boolean;
  /** Session this one was started from, when the person revisits an earlier decision. */
  parentId: string | null;
  /**
   * The organisation profile in force when the session was created, kept as it was then so that later edits do not
   * change its report; null when there was none.
   */
  profile: OrgProfile | null;
  /** The person chose to debate without the profile. */
  ignoreProfile: boolean;
  /**
   * The one currency of every amount of the debate (costs, rates, budget checks), fixed when the requirements sheet is
   * confirmed; null before (debateCurrency then tells which it will be).
   */
  currency: string | null;
  /** Send an e-mail when the debate ends or waits for an answer (when the server can send mail). */
  notify: boolean;
  interview: InterviewEntry[];
  sheet: RequirementsSheet | null;
  /** Set when the person validates the requirements sheet and the debate may start. */
  sheetConfirmedAt: string | null;
  debate: DebateEntry[];
  verdict: Verdict | null;
  /** The verdict rewritten for other readers, generated on demand. */
  briefs: Partial<Record<Audience, Brief>>;
  usage: UsageRecord[];
  error: SessionError | null;
}

/**
 * Why a session stopped. The code is stable and the interface explains it in the person's language, with `params`
 * (the provider and model that failed, the cap reached…); the message is English, for logs and API users.
 */
export interface SessionError {
  code: string;
  message: string;
  params?: Record<string, string | number> | undefined;
}

export interface NewSessionInput {
  locale: Locale;
  idea: string;
  demo: boolean;
  mode?: Mode;
  template?: TemplateId | null;
  depth?: Depth;
  rounds?: number;
  budgetUsd?: number | null;
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant & { persona?: string | null }>;
  devil?: (Participant & { persona?: string | null }) | null;
  challenge?: string | null;
  context?: ContextDocument[];
  redact?: boolean;
  parentId?: string | null;
  notify?: boolean;
  profile?: OrgProfile | null;
  ignoreProfile?: boolean;
}

export const MAX_ROUNDS = 3;

/** The compliance boxes of a requirements sheet, in the order the interfaces show them. */
export const COMPLIANCE_KEYS = [
  "gdpr",
  "healthData",
  "paymentCards",
  "accessibility",
  "publicSector",
] as const satisfies readonly (keyof Compliance)[];

export function createSession(input: NewSessionInput): Session {
  const now = new Date().toISOString();
  const mode = input.mode ?? "standard";
  return {
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    locale: input.locale,
    idea: input.idea,
    demo: input.demo,
    mode,
    template: input.template ?? null,
    depth: input.depth ?? (mode === "express" ? "quick" : "standard"),
    phase: "interview",
    rounds: mode === "express" ? 1 : Math.min(MAX_ROUNDS, Math.max(1, input.rounds ?? 1)),
    budgetUsd: input.budgetUsd ?? null,
    shortened: null,
    interviewer: input.interviewer,
    arbiter: input.arbiter,
    seats: Object.fromEntries(Object.entries(input.seats).map(([seat, value]) => [seat, { ...value, persona: value.persona ?? null }])),
    devil: input.devil ? { ...input.devil, persona: input.devil.persona ?? null } : null,
    challenge: mode === "challenge" ? (input.challenge ?? null) : null,
    context: input.context ?? [],
    redact: input.redact ?? false,
    parentId: input.parentId ?? null,
    profile: input.profile ?? null,
    ignoreProfile: input.ignoreProfile ?? false,
    currency: null,
    notify: input.notify ?? false,
    interview: [],
    sheet: null,
    sheetConfirmedAt: null,
    debate: [],
    verdict: null,
    briefs: {},
    usage: [],
    error: null,
  };
}

/** Fills the fields added after a session was stored, so older sessions keep working. */
export function normalizeSession(stored: Session): Session {
  const session = { ...stored } as Session & Partial<Session>;
  session.mode ??= "standard";
  session.template ??= null;
  session.depth ??= "standard";
  session.devil ??= null;
  session.challenge ??= null;
  session.context ??= [];
  session.redact ??= false;
  session.parentId ??= null;
  session.notify ??= false;
  session.briefs ??= {};
  session.shortened ??= null;
  session.profile ??= null;
  session.ignoreProfile ??= false;
  session.sheet = session.sheet ? normalizeSheet(session.sheet) : null;
  for (const entry of session.interview ?? []) {
    if (entry.kind === "interviewer" && entry.data.sheet) entry.data.sheet = normalizeSheet(entry.data.sheet);
  }
  for (const entry of session.debate ?? []) {
    if (entry.kind === "proposal") normalizeProposal(entry.data);
    if (entry.kind === "revision") normalizeProposal(entry.data.proposal);
  }
  // Proposals made before the single currency each named theirs: the debate keeps the first one's.
  session.currency ??= session.sheetConfirmedAt ? legacyCurrency(session) : null;
  // Verdicts stored before the debate map listed consensus and disagreements separately.
  const legacy = session.verdict as (Verdict & { consensus?: string[]; disagreements?: { topic: string; positions: string[] }[] }) | null;
  if (legacy && !legacy.topics) {
    legacy.topics = [
      ...(legacy.consensus ?? []).map((topic) => ({ topic, status: "agreement" as const, positions: [] })),
      ...(legacy.disagreements ?? []).map((item) => ({
        topic: item.topic,
        status: "divided" as const,
        positions: item.positions.map((position) => ({ seat: "", position })),
      })),
    ];
  }
  session.seats = Object.fromEntries(
    Object.entries(session.seats).map(([seat, value]) => [seat, { ...value, persona: value.persona ?? null }]),
  );
  return session as Session;
}

type LegacySheet = Omit<RequirementsSheet, "users" | "budget" | "team" | "deadline" | "compliance"> & {
  users: RequirementsSheet["users"] | string;
  budget: RequirementsSheet["budget"] | string;
  team: RequirementsSheet["team"] | string;
  deadline: RequirementsSheet["deadline"] | string | null;
  compliance?: RequirementsSheet["compliance"];
};

/**
 * A sheet stored before budget, team, deadline and load had fields of their own: the free text each was becomes its
 * note, the structured values stay unknown, and no compliance box is checked.
 */
export function normalizeSheet(stored: RequirementsSheet): RequirementsSheet {
  const sheet = stored as LegacySheet;
  if (
    typeof sheet.users !== "string" &&
    typeof sheet.budget !== "string" &&
    typeof sheet.team !== "string" &&
    sheet.deadline !== null &&
    typeof sheet.deadline !== "string" &&
    sheet.compliance
  ) {
    return stored;
  }
  return {
    ...sheet,
    users: typeof sheet.users === "string" ? { launch: null, oneYear: null, note: sheet.users } : sheet.users,
    budget: typeof sheet.budget === "string" ? { build: null, run: null, note: sheet.budget } : sheet.budget,
    team: typeof sheet.team === "string" ? { people: null, skills: [], note: sheet.team } : sheet.team,
    deadline:
      sheet.deadline === null || typeof sheet.deadline === "string"
        ? { date: null, duration: null, note: sheet.deadline ?? "" }
        : sheet.deadline,
    compliance: sheet.compliance ?? { gdpr: false, healthData: false, paymentCards: false, accessibility: false, publicSector: false },
  };
}

/** A proposal stored before work packages: no estimate to price, its build cost kept as the model gave it. */
function normalizeProposal(proposal: Proposal) {
  const stored = proposal as Proposal & Partial<Pick<Proposal, "estimate" | "buildWeeks">>;
  stored.estimate ??= { workPackages: [], dayRates: [], assumptions: [], exclusions: [] };
  stored.buildWeeks ??= null;
}

function legacyCurrency(session: Session): string | null {
  for (const proposal of Object.values(currentProposals(session))) {
    const currency = (proposal.monthlyCost as { currency?: string }).currency ?? proposal.buildCost?.currency;
    if (currency) return currency;
  }
  return null;
}

/**
 * True when the models owe the next move: the debate runs, or the interviewer has to answer. The session then has a
 * worker on the server, or had one when the server stopped (see markInterrupted).
 */
export function isWorking(session: Session): boolean {
  if (session.phase === "debating") return true;
  return session.phase === "interview" && session.interview.at(-1)?.kind !== "interviewer";
}

/** Fails a session whose worker is gone, the server having stopped in the middle: it can be resumed from there. */
export function markInterrupted(session: Session, now = new Date()): void {
  session.phase = "failed";
  session.error = { code: "interrupted", message: "The server stopped while this session was working." };
  session.updatedAt = now.toISOString();
}

/** Seats that design an option: none in challenge mode, where the person's solution is the only option. */
export function proposerSeats(session: Session): string[] {
  return session.mode === "challenge" ? [] : Object.keys(session.seats);
}

/** Every participant that criticises in a round, the devil's advocate last. */
export function criticSeats(session: Session): string[] {
  return [...Object.keys(session.seats), ...(session.devil ? [DEVIL_SEAT] : [])];
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
