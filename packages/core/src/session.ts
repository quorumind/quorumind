import type { AuditSettings } from "./audit.ts";
import type { ComplianceTemplateId } from "./compliance.ts";
import type { Decision } from "./decisions.ts";
import type { Locale } from "./locales.ts";
import type { OrgProfile } from "./profile.ts";
import type { ProviderKind, Task } from "./providers/types.ts";
import type { RevisionScenario } from "./scenarios.ts";
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
import type { EuropeanMode } from "./sovereignty.ts";
import type { TemplateId } from "./templates.ts";

export type Phase = "interview" | "review" | "debating" | "awaiting_answers" | "complete" | "failed";

/**
 * standard: the models design competing options. express: five questions and one short round.
 * challenge: the person brings their own solution and the models only look for its flaws. audit: the person attaches a
 * document a provider sent them (a quote, a statement of work, an architecture) and the models examine it.
 */
export type Mode = "standard" | "express" | "challenge" | "audit";
export const MODES: readonly Mode[] = ["standard", "express", "challenge", "audit"];

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

/** Seat of the person's own solution in challenge mode, and of the audited document in audit mode. */
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
  /** The verdict revision the call was made for; absent for the debate itself. */
  revision?: number;
}

/**
 * Why a verdict revision exists. debate: the debate's own verdict, always revision 1. client_answers: the client
 * answered a questionnaire. edit: the person stated new facts or corrections. scenario: a "what if" variant.
 */
export type RevisionReason = "debate" | "client_answers" | "edit" | "scenario";

/** One new fact a revision is made from: the answer to a question, or something the person states on its own. */
export interface RevisionFact {
  /** The question it answers; null for a fact stated on its own. */
  question: string | null;
  answer: string;
  /** A remark that comes with the answer. */
  comment: string | null;
}

/** What a revision is made from. Other kinds of revision add their own fields. */
export interface RevisionInputs {
  facts: RevisionFact[];
  /** What changed, in the person's own words. */
  note: string | null;
  /** The questionnaire the answers come from, for a revision from client answers. */
  questionnaireId: string | null;
}

export type CostEstimate = Proposal["monthlyCost"];

/**
 * The running cost of one option as a revision changed it, in the debate's currency. The build cost is not revised
 * here: it is priced from the option's work packages.
 */
export interface CostRevision {
  seat: string;
  monthlyCost: CostEstimate;
}

/** The calendar weeks of one option as a revision changed them: a larger or smaller team, a tighter scope. */
export interface ScheduleRevision {
  seat: string;
  buildWeeks: { low: number; high: number };
}

/**
 * One version of the verdict. The debate's verdict is revision 1; each later one re-runs the arbiter (and, when the
 * facts call for it, a short critique of the options) with new facts, instead of the whole debate.
 */
export interface VerdictRevision {
  number: number;
  createdAt: string;
  reason: RevisionReason;
  inputs: RevisionInputs;
  /** The revision this one starts from; null for the first. */
  basedOn: number | null;
  verdict: Verdict;
  /** The cost estimates the new facts changed. */
  costs: CostRevision[];
  /** The short critique of the options run with the new facts: internal, never in a client document. */
  critiques: { seat: string; data: CritiqueRound }[];
  /** Who asked for it: the user id on a hosted server; null for the local user and for the debate's own verdict. */
  by: string | null;
  /** The build times the new facts changed; absent on the revisions made before they could. */
  schedules?: ScheduleRevision[];
  /** For a "what if" scenario: its title and the changes it tries. */
  scenario?: RevisionScenario;
  /**
   * The requirements this revision ruled on, when they differ from those of the revision it starts from (a scenario
   * changing the budget, the deadline, the team or the constraints). The revisions that start from it inherit them;
   * absent, they are those of the revision before, and in the end the session's own sheet.
   */
  sheet?: RequirementsSheet;
}

/** A revision on its way: the arbiter works on it, or it stopped on `error` and can be asked again. */
export interface PendingRevision {
  /** Each attempt has its own id: a revision asked again after a failure is a new attempt with the same number. */
  id: string;
  number: number;
  reason: Exclude<RevisionReason, "debate">;
  inputs: RevisionInputs;
  basedOn: number;
  by: string | null;
  /** For a scenario: its title and the changes it tries. */
  scenario?: RevisionScenario;
  startedAt: string;
  /** Null while it runs. A failed revision changes nothing: the current verdict stays. */
  error: SessionError | null;
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
  /** Compliance templates (health data, public sector…), on top of the domain template. */
  complianceTemplates: ComplianceTemplateId[];
  /** Set when every role is played by a European model, or one run on the premises (sovereignty.ts). */
  european: EuropeanMode | null;
  /** The date of the reference cloud prices the proposers read, set when the debate starts; null before or without them. */
  priceReference: { asOf: string } | null;
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
  /** The audit settings and what the document commits to, in audit mode. */
  audit: AuditSettings | null;
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
  /** The current verdict: that of the adopted scenario, else that of the latest revision that is not a scenario. */
  verdict: Verdict | null;
  /** Every version of the verdict, oldest first, scenarios included; empty until the arbiter has ruled. */
  revisions: VerdictRevision[];
  /** The scenario adopted as the decision; null keeps the latest revision that is not a scenario. */
  adopted: number | null;
  /** The decision as the register records it: its approval, its note, its review date. Null until one is recorded. */
  decision: Decision | null;
  /** The revision being made, or the last one that failed. */
  revising: PendingRevision | null;
  /** The current verdict rewritten for other readers, generated on demand. */
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
  complianceTemplates?: ComplianceTemplateId[];
  european?: EuropeanMode | null;
  depth?: Depth;
  rounds?: number;
  budgetUsd?: number | null;
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant & { persona?: string | null }>;
  devil?: (Participant & { persona?: string | null }) | null;
  challenge?: string | null;
  /** In audit mode: the documents under audit (every attached one when none is named) and whether to sketch an alternative. */
  audit?: { documentIds?: string[]; alternative?: boolean } | null;
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
    complianceTemplates: input.complianceTemplates ?? [],
    european: input.european ?? null,
    priceReference: null,
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
    audit: mode === "audit" ? auditSettings(input.audit ?? null, input.context ?? []) : null,
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
    revisions: [],
    revising: null,
    adopted: null,
    decision: null,
    briefs: {},
    usage: [],
    error: null,
  };
}

/** The documents under audit are the attached ones named, or every attached one when none is. */
function auditSettings(input: NewSessionInput["audit"], context: ContextDocument[]): AuditSettings {
  const ids = new Set(context.map((doc) => doc.id));
  const named = (input?.documentIds ?? []).filter((id) => ids.has(id));
  return { documentIds: named.length > 0 ? [...new Set(named)] : [...ids], alternative: input?.alternative ?? false, extraction: null };
}

/** Fills the fields added after a session was stored, so older sessions keep working. */
export function normalizeSession(stored: Session): Session {
  const session = { ...stored } as Session & Partial<Session>;
  session.mode ??= "standard";
  session.template ??= null;
  session.complianceTemplates ??= [];
  session.european ??= null;
  session.priceReference ??= null;
  session.depth ??= "standard";
  session.devil ??= null;
  session.challenge ??= null;
  session.audit ??= null;
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
  session.revising ??= null;
  session.adopted ??= null;
  session.decision ??= null;
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
  // Sessions ruled on before revisions existed: their verdict is revision 1.
  session.revisions ??= session.verdict ? [firstRevision(session.verdict, session.updatedAt)] : [];
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
  if (session.revising && !session.revising.error) return true;
  return session.phase === "interview" && session.interview.at(-1)?.kind !== "interviewer";
}

/** Fails a session whose worker is gone, the server having stopped in the middle: it can be resumed from there. */
export function markInterrupted(session: Session, now = new Date()): void {
  const error = { code: "interrupted", message: "The server stopped while this session was working." };
  session.updatedAt = now.toISOString();
  // A revision that did not finish leaves the current verdict as it was.
  if (session.revising && !session.revising.error) {
    session.revising.error = error;
    return;
  }
  session.phase = "failed";
  session.error = error;
}

/**
 * Seats that design and revise an option: none in challenge mode, where the person's solution is the only option, nor in
 * audit mode, where the document is (its alternative, when asked for, is sketched once and not revised).
 */
export function proposerSeats(session: Session): string[] {
  return session.mode === "challenge" || session.mode === "audit" ? [] : Object.keys(session.seats);
}

/** The seat that sketches the alternative approach of an audit, when the person asked for one. */
export function alternativeSeat(session: Session): string | null {
  return session.mode === "audit" && session.audit?.alternative ? (Object.keys(session.seats)[0] ?? null) : null;
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

/**
 * Latest version of each proposal: the revised one when a revision exists, with the running costs and build times
 * changed since by the verdict revisions the current one descends from (never by a scenario beside it).
 */
export function currentProposals(session: Session): Record<string, Proposal> {
  const proposals: Record<string, Proposal> = {};
  for (const entry of session.debate) {
    if (entry.kind === "proposal") proposals[entry.seat] = entry.data;
    if (entry.kind === "revision") proposals[entry.seat] = entry.data.proposal;
  }
  for (const revision of revisionLineage(session, currentRevision(session)?.number ?? null)) {
    for (const cost of revision.costs) {
      const proposal = proposals[cost.seat];
      if (proposal) proposals[cost.seat] = { ...proposal, monthlyCost: cost.monthlyCost };
    }
    for (const schedule of revision.schedules ?? []) {
      const proposal = proposals[schedule.seat];
      if (proposal) proposals[schedule.seat] = { ...proposal, buildWeeks: schedule.buildWeeks };
    }
  }
  return proposals;
}

/** The first revision: the debate's own verdict. */
export function firstRevision(verdict: Verdict, createdAt: string): VerdictRevision {
  return {
    number: 1,
    createdAt,
    reason: "debate",
    inputs: { facts: [], note: null, questionnaireId: null },
    basedOn: null,
    verdict,
    costs: [],
    critiques: [],
    by: null,
  };
}

export const isScenario = (revision: Pick<VerdictRevision, "reason">) => revision.reason === "scenario";

/** The revision the session shows: the adopted scenario, else the latest revision that is not a scenario. */
export function currentRevision(session: Session): VerdictRevision | null {
  const revisions = session.revisions ?? [];
  const adopted = session.adopted == null ? undefined : revisions.find((revision) => revision.number === session.adopted);
  return adopted ?? revisions.findLast((revision) => !isScenario(revision)) ?? revisions.at(-1) ?? null;
}

/**
 * The revisions one descends from, oldest first and itself last: each one's basedOn back to the debate's verdict.
 * Its costs and requirements are those of this line, never of the scenarios beside it. Empty when there is no such
 * revision.
 */
export function revisionLineage(session: Session, number: number | null): VerdictRevision[] {
  const revisions = session.revisions ?? [];
  const line: VerdictRevision[] = [];
  const seen = new Set<number>();
  let next = number === null ? undefined : revisions.find((revision) => revision.number === number);
  while (next && !seen.has(next.number)) {
    seen.add(next.number);
    line.unshift(next);
    const basedOn = next.basedOn;
    next = basedOn === null ? undefined : revisions.find((revision) => revision.number === basedOn);
  }
  return line;
}

/** The requirements a revision ruled on: the latest ones its line of revisions set, else the session's sheet. */
export function revisionSheet(session: Session, number: number): RequirementsSheet | null {
  return revisionLineage(session, number).findLast((revision) => revision.sheet)?.sheet ?? session.sheet;
}

/**
 * The session as it stood at one revision of its verdict, for the report of an earlier version or of a scenario:
 * that verdict, the line of revisions it descends from (so the costs are those of that line), the requirements it
 * ruled on, and no reader brief unless it is the current revision. Null when there is no such revision.
 */
export function sessionAtRevision(session: Session, number: number): Session | null {
  const revision = session.revisions.find((item) => item.number === number);
  if (!revision) return null;
  const current = revision === currentRevision(session);
  const lineage = revisionLineage(session, number);
  const sheet = revisionSheet(session, number);
  // The current revision of a session without branches nor changed requirements: the session itself.
  if (current && lineage.length === session.revisions.length && sheet === session.sheet) return session;
  return {
    ...session,
    sheet,
    verdict: revision.verdict,
    revisions: lineage,
    adopted: isScenario(revision) ? revision.number : null,
    revising: null,
    briefs: current ? session.briefs : {},
  };
}

/** The session as its current revision shows it: with the requirements and the costs of that revision's line. */
export function currentView(session: Session): Session {
  const current = currentRevision(session);
  return (current && sessionAtRevision(session, current.number)) ?? session;
}

export function allAnswers(session: Session): Answer[] {
  return session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
}
