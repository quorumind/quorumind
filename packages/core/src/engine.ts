import type { z } from "zod";
import {
  AUDIT_EXTRACTION,
  AUDIT_FINDINGS,
  type AuditCritiqueInput,
  type AuditExtraction,
  type AuditedVerdict,
  auditUpdateOutput,
  auditVerdictOutput,
} from "./audit.ts";
import { auditedDocuments, auditProposal, settleAudit, settleExtraction, settleFindings } from "./audit-check.ts";
import {
  auditAlternativePrompt,
  auditCriticSystem,
  auditCritiquePrompt,
  auditDevilSystem,
  auditExtractionPrompt,
  auditReassessPrompt,
  auditVerdictPrompt,
} from "./audit-prompts.ts";
import { PRICE_REFERENCE, priceReferenceRule } from "./cloud-prices.ts";
import { activeRequirements, complianceInterviewRule, complianceRule, withTemplateFlags } from "./compliance.ts";
import { COMPLIANCE_UPDATE, COMPLIANCE_VERDICT, settleCompliance, type VerdictWithCompliance } from "./compliance-verdict.ts";
import { checkFacts, debateCurrency, sessionCostings, sessionProfile } from "./costing.ts";
import { InvalidStateError, requireSheet } from "./errors.ts";
import { partialStringField } from "./partial-json.ts";
import { cappedCostOf, costOf, TASK_PROFILE, typicalCappedCost } from "./pricing.ts";
import { fence, redact, withoutRates } from "./privacy.ts";
import { currencyCode } from "./profile.ts";
import {
  answersBlock,
  arbiterSystem,
  briefSystem,
  CONTEXT_BUDGET,
  type ComputedCost,
  challengerSystem,
  checksBlock,
  contextBlock,
  criticSystem,
  devilSystem,
  factsBlock,
  findingsSystem,
  formalizerSystem,
  interviewerSystem,
  probeSystem,
  profileBlock,
  proposalsBlock,
  proposerSystem,
  ratesBlock,
  reassessSystem,
  requirementsBlock,
  researcherSystem,
  reviserSystem,
  revisionCriticSystem,
  scenarioSystem,
} from "./prompts.ts";
import { type ChatMessage, type LlmProvider, ProviderError, type Task, type Usage } from "./providers/types.ts";
import {
  citedSources,
  needsResearch,
  plannedQueries,
  RESEARCH_FINDINGS,
  type ResearchFindings,
  ResearchPlan,
  type ResearchRecord,
  type ResearchSettings,
  researchBlock,
  researchBudget,
  researchRule,
  researchSpent,
  type Source,
  settleClaims,
  settleResearchFacts,
  sourcesBlock,
} from "./research.ts";
import { applyScenario, type RevisionScenario, scenarioFacts } from "./scenarios.ts";
import {
  type Audience,
  Brief,
  CritiqueRound,
  clampScore,
  InterviewTurn,
  Probe,
  Proposal,
  RequirementsSheet,
  Revision,
  toStrictJsonSchema,
  Verdict,
  VerdictUpdate,
} from "./schemas.ts";
import { MAX_RESULTS_PER_QUERY, type SearchHit, type SearchProvider } from "./search.ts";
import {
  type Answer,
  allAnswers,
  alternativeSeat,
  cappedCost,
  criticSeats,
  currentProposals,
  currentRevision,
  currentView,
  DEVIL_SEAT,
  type DebateEntry,
  type Depth,
  firstRevision,
  type PendingRevision,
  proposerSeats,
  type RevisionFact,
  type RevisionInputs,
  type Session,
  type SessionError,
  sessionAtRevision,
  USER_SEAT,
  type UsageRecord,
  type VerdictRevision,
} from "./session.ts";

/** After this many answered turns the interviewer must produce the requirements sheet. */
export const MAX_INTERVIEW_TURNS = 4;
/** An audit's interview only asks what the document cannot tell: two turns at most. */
export const AUDIT_INTERVIEW_TURNS = 2;
const MAX_QUESTIONS_PER_ROUND = 3;

export interface ProviderSet {
  interviewer: LlmProvider;
  arbiter: LlmProvider;
  /** Every debating seat. In challenge mode they criticise the person's solution instead of proposing. */
  proposers: Record<string, LlmProvider>;
  devil?: LlmProvider | null;
  /** Where the research step searches the web; without it, a session that asks for research skips it. */
  search?: SearchProvider | null;
}

const EFFORT: Record<Depth, "low" | "high" | undefined> = { quick: "low", standard: undefined, deep: "high" };

export type EngineEvent =
  | { type: "session"; session: Session }
  | { type: "speaking"; task: Task; seat: string | null }
  | { type: "speech"; task: Task; seat: string | null; text: string }
  | { type: "spoke"; task: Task; seat: string | null };

export interface EngineHooks {
  emit(sessionId: string, event: EngineEvent): void;
  /**
   * Stores the session. An engine never calls it again before the previous call has finished, even when the calls of
   * a step end together: the saves are made in order. Each usage record has a stable id for a hook that bills them.
   */
  save(session: Session): void | Promise<void>;
}

/** What a new verdict revision is made from, and who asks for it. */
export interface RevisionRequest {
  reason: PendingRevision["reason"];
  inputs: RevisionInputs;
  /** The user id on a hosted server; null for the local user. */
  by: string | null;
  /** For a scenario: its title and changes (required), and the revision it branches from (the current one by default). */
  scenario?: RevisionScenario;
  basedOn?: number;
}

export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  readonly params: { spentUsd: number; budgetUsd: number };
  constructor(spentUsd: number, budgetUsd: number) {
    super(`The cost cap of $${dollars(budgetUsd)} is reached ($${dollars(spentUsd)} spent).`);
    this.name = "BudgetExceededError";
    this.params = { spentUsd: roundUsd(spentUsd), budgetUsd: roundUsd(budgetUsd) };
  }
}

export { InvalidStateError } from "./errors.ts";

/**
 * The work in flight was cancelled and the session can be resumed: the person stopped it ("stopped"), or the server
 * is shutting down ("interrupted", when the signal is aborted with that reason).
 */
export class StoppedError extends Error {
  readonly code: "stopped" | "interrupted";
  constructor(code: "stopped" | "interrupted" = "stopped") {
    super(code === "stopped" ? "The session was stopped." : "The server stopped while this session was working.");
    this.name = "StoppedError";
    this.code = code;
  }
}

/** Why a signal stopped the work: the server's shutdown aborts with this reason. */
export const INTERRUPTED = "interrupted";

/** The models that made a call fail, for the interface to name them. */
const failedCalls = new WeakMap<object, { provider: string; model: string }>();

/** The failure of a session from what was thrown: a stable code, its parameters and the English message. */
export function sessionError(error: unknown): SessionError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof StoppedError) return { code: error.code, message };
  if (error instanceof BudgetExceededError) return { code: error.code, message, params: error.params };
  if (error instanceof InvalidStateError) return { code: error.code, message, ...(error.params ? { params: error.params } : {}) };
  const failed = error instanceof Object ? failedCalls.get(error) : undefined;
  // An answer that is not valid JSON even on the second try is the model's failure too.
  if (error instanceof ProviderError || error instanceof SyntaxError) {
    return { code: error instanceof ProviderError ? error.code : "provider_error", message, ...(failed ? { params: failed } : {}) };
  }
  return { code: "internal_error", message };
}

// Four decimals: a call to a small model costs a fraction of a cent.
const roundUsd = (usd: number) => Math.round(usd * 10_000) / 10_000;
// Cents, or four decimals under a dollar: a cap of a few cents must not read as reached when it is not.
const dollars = (usd: number) => usd.toFixed(Math.abs(usd) < 1 ? 4 : 2);

const SCHEMAS = {
  interview: { zod: InterviewTurn, json: toStrictJsonSchema(InterviewTurn), name: "interview_turn", maxTokens: 8_000 },
  research: { zod: ResearchPlan, json: toStrictJsonSchema(ResearchPlan), name: "research_plan", maxTokens: 4_000 },
  proposal: { zod: Proposal, json: toStrictJsonSchema(Proposal), name: "proposal", maxTokens: 12_000 },
  critique: { zod: CritiqueRound, json: toStrictJsonSchema(CritiqueRound), name: "critique_round", maxTokens: 10_000 },
  revision: { zod: Revision, json: toStrictJsonSchema(Revision), name: "revision", maxTokens: 14_000 },
  probe: { zod: Probe, json: toStrictJsonSchema(Probe), name: "probe", maxTokens: 4_000 },
  verdict: { zod: Verdict, json: toStrictJsonSchema(Verdict), name: "verdict", maxTokens: 20_000 },
  reassess: { zod: VerdictUpdate, json: toStrictJsonSchema(VerdictUpdate), name: "verdict_update", maxTokens: 20_000 },
  brief: { zod: Brief, json: toStrictJsonSchema(Brief), name: "brief", maxTokens: 8_000 },
} as const;

/**
 * The schema of a revision's ruling: with the compliance assessment when the debate has requirements, and under a name
 * of its own for a "what if" scenario.
 */
function revisionSchema(scenario: boolean, compliance: boolean): OutputSpec {
  const spec: OutputSpec = compliance ? COMPLIANCE_UPDATE : SCHEMAS.reassess;
  return scenario ? { ...spec, name: spec.name.replace("verdict_update", "scenario_update") } : spec;
}

export class DebateEngine {
  private readonly providers: ProviderSet;
  private readonly hooks: EngineHooks;
  private readonly signal: AbortSignal | undefined;
  private readonly retryDelayMs: number;
  /**
   * The attempt being made with a cap of its own (a verdict revision): its calls are recorded under its id (and the
   * revision's number) and capped by its own budget. A revision asked again after a failure is a new attempt.
   */
  private scope: { attempt: string; revision: number | null; budgetUsd: number | null } | null = null;
  /** The last save asked for: the next one waits for it. */
  private saving: Promise<void> = Promise.resolve();

  /**
   * @param options.signal stops the work: the calls in flight are cancelled and the session fails with the code
   * "stopped", ready to be resumed. A call cut short is recorded as failed, with an estimate of what the provider may
   * bill for it (the prompt it read and the text it sent), since providers bill a cancelled call too.
   * @param options.retryDelayMs the first wait before a call that hit a rate limit or an outage is tried again; each
   * later wait doubles, with jitter, unless the provider says how long to wait. 0 in tests.
   */
  constructor(providers: ProviderSet, hooks: EngineHooks, options: { signal?: AbortSignal; retryDelayMs?: number } = {}) {
    this.providers = providers;
    this.hooks = hooks;
    this.signal = options.signal;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  }

  /** First interviewer turn, from the idea alone. */
  async startInterview(session: Session): Promise<void> {
    if (session.phase !== "interview" || session.interview.length > 0) {
      throw new InvalidStateError("The interview has already started.");
    }
    await this.guard(session, () => this.interviewStep(session));
  }

  async answerInterview(session: Session, answers: Answer[]): Promise<void> {
    if (session.phase !== "interview") throw new InvalidStateError("The interview is over.");
    session.interview.push({ kind: "user", answers });
    await this.persist(session);
    await this.guard(session, () => this.interviewStep(session));
  }

  /**
   * The person validates (and possibly edits) the requirements sheet; the debate can start. `ignoreProfile` debates
   * without the organisation profile. The currency of the debate is fixed here.
   */
  async confirmSheet(session: Session, sheet: RequirementsSheet, options: { ignoreProfile?: boolean } = {}): Promise<void> {
    if (session.phase !== "review") throw new InvalidStateError("There is no requirements sheet to confirm.");
    session.sheet = RequirementsSheet.parse(sheet);
    if (options.ignoreProfile !== undefined) session.ignoreProfile = options.ignoreProfile;
    session.currency = null;
    session.currency = debateCurrency(session);
    session.sheetConfirmedAt = new Date().toISOString();
    session.priceReference = { asOf: PRICE_REFERENCE.asOf };
    session.phase = "debating";
    await this.persist(session);
  }

  async answerDebate(session: Session, answers: Answer[]): Promise<void> {
    if (session.phase !== "awaiting_answers") throw new InvalidStateError("No question is waiting for an answer.");
    const pending = session.debate.findLast((entry) => entry.kind === "questions");
    if (pending?.kind !== "questions") throw new InvalidStateError("No question is waiting for an answer.");
    session.debate.push({ kind: "answers", round: pending.round, answers });
    session.phase = "debating";
    await this.persist(session);
  }

  /**
   * Puts a failed session back where it stopped, so the failed step can run again.
   * Returns what the caller should do next.
   */
  async resume(session: Session, options: { budgetUsd?: number | null } = {}): Promise<"interview" | "review" | "debate"> {
    if (session.phase !== "failed") throw new InvalidStateError("Only a failed session can be resumed.");
    session.error = null;
    // A new cost cap gives the rounds skipped to keep the verdict within the old one another chance.
    if (options.budgetUsd !== undefined) {
      session.budgetUsd = options.budgetUsd;
      if (!session.verdict) session.shortened = null;
    }
    let next: "interview" | "review" | "debate";
    if (!session.sheet) {
      session.phase = "interview";
      next = "interview";
    } else if (!session.sheetConfirmedAt) {
      session.phase = "review";
      next = "review";
    } else {
      const pending = session.debate.findLast((entry) => entry.kind === "questions" || entry.kind === "answers");
      session.phase = pending?.kind === "questions" ? "awaiting_answers" : "debating";
      next = "debate";
    }
    await this.persist(session);
    if (next === "interview") {
      const last = session.interview.at(-1);
      if (!last || last.kind === "user") await this.guard(session, () => this.interviewStep(session));
    }
    return next;
  }

  /** Runs the debate from wherever it stopped until it needs the person or reaches the verdict. */
  async runDebate(session: Session): Promise<void> {
    if (session.phase !== "debating") throw new InvalidStateError("The debate is not running.");
    await this.guard(session, async () => {
      while (session.phase === "debating") {
        this.checkStopped();
        await this.debateStep(session);
      }
    });
  }

  /** Rewrites the verdict for another reader. Failures are thrown to the caller: the session stays complete. */
  /**
   * A brief has a cap of its own, like a revision: the debate's cap covers the debate up to its verdict, which may end
   * a little past it, and a brief must still be written then (the client's is written as soon as the verdict is).
   * `budgetUsd` sets it; by default it is BRIEF_CAP_SHARE of the session's cap, or none without one.
   */
  async writeBrief(session: Session, audience: Audience, options: { budgetUsd?: number | null } = {}): Promise<void> {
    if (session.phase !== "complete" || !session.verdict) throw new InvalidStateError("The verdict is not ready yet.");
    const ruling = session.verdict;
    // The current revision as it stands: an adopted scenario brings its own requirements.
    const shown = currentView(session);
    // A client never reads the agency's day rates: the model that writes for one is not shown them either.
    const client = audience === "client" && session.mode !== "audit";
    const proposals = client ? clientProposals(currentProposals(shown)) : currentProposals(shown);
    const verdict = stripSpeech(client ? withoutRates(ruling) : ruling);
    const budgetUsd =
      options.budgetUsd !== undefined ? options.budgetUsd : session.budgetUsd === null ? null : session.budgetUsd * BRIEF_CAP_SHARE;
    this.scope = { attempt: globalThis.crypto.randomUUID(), revision: null, budgetUsd };
    let written: Brief;
    try {
      written = await this.call(session, "brief", null, this.providers.arbiter, {
        system: briefSystem(session.locale, audience),
        messages: [
          {
            role: "user",
            content: [
              requirementsBlock(requireSheet(shown)),
              proposalsBlock(proposals, computedCosts(shown)),
              fence("debate", JSON.stringify({ verdict }, null, 2)),
              `Write the brief for this reader: ${audience}.`,
            ].join("\n\n"),
          },
        ],
      });
    } finally {
      this.scope = null;
    }
    // A revision may have replaced the verdict meanwhile: this brief was written for the one before.
    if (session.verdict !== ruling) {
      await this.persist(session);
      throw new InvalidStateError("The verdict changed while its brief was being written.", "verdict_changed");
    }
    session.briefs[audience] = client ? withoutRates(written) : written;
    await this.persist(session);
  }

  /**
   * Records a new revision of the verdict as pending, from new facts: answers to the open questions or corrections,
   * or a "what if" scenario. runRevision then makes it. A revision starts from the current one; a scenario may branch
   * from any earlier revision. A revision that failed is replaced.
   */
  async beginRevision(session: Session, request: RevisionRequest): Promise<PendingRevision> {
    if (session.phase !== "complete" || !session.verdict) throw new InvalidStateError("The verdict is not ready yet.");
    if (session.revising && !session.revising.error) {
      throw new InvalidStateError("The verdict is already being revised. Wait for it to finish.", "session_busy");
    }
    if (request.reason === "scenario" && !request.scenario) throw new InvalidStateError("A scenario needs its title and changes.");
    if (session.revisions.length === 0) session.revisions.push(firstRevision(session.verdict, session.updatedAt));
    const latest = session.revisions.at(-1) as VerdictRevision;
    const basedOn = (request.reason === "scenario" ? request.basedOn : undefined) ?? currentRevision(session)?.number ?? latest.number;
    if (!session.revisions.some((revision) => revision.number === basedOn)) {
      throw new InvalidStateError(`There is no revision ${basedOn} to start from.`, "no_such_revision", { number: basedOn });
    }
    session.revising = {
      id: globalThis.crypto.randomUUID(),
      number: latest.number + 1,
      reason: request.reason,
      inputs: structuredClone(request.inputs),
      basedOn,
      by: request.by,
      ...(request.reason === "scenario" && request.scenario ? { scenario: structuredClone(request.scenario) } : {}),
      startedAt: new Date().toISOString(),
      error: null,
    };
    await this.persist(session);
    return session.revising;
  }

  /**
   * Makes the pending revision: a short critique of the options with the new facts when there is room for it, then
   * the arbiter rules again. Only these calls are made, never the debate. `budgetUsd` caps what they may cost
   * together. A failure leaves the current verdict as it is, the pending revision carrying the error. A scenario
   * becomes a revision beside the others: the current verdict stays until it is adopted. Returns true when the new
   * verdict was produced.
   */
  async runRevision(session: Session, options: { budgetUsd?: number | null } = {}): Promise<boolean> {
    const pending = session.revising;
    if (!pending || pending.error || !session.verdict) throw new InvalidStateError("No revision is waiting to be made.");
    const scenario = pending.reason === "scenario" ? (pending.scenario ?? null) : null;
    this.scope = { attempt: pending.id, revision: pending.number, budgetUsd: options.budgetUsd ?? null };
    try {
      const work = revisionWork(session, pending);
      const critiques = await this.reviewFacts(session, work);
      const prompt = this.reassessPrompt(work, critiques);
      if (this.scope.budgetUsd !== null) {
        const spent = this.spent(session);
        if (spent + this.promptEstimate(prompt, "reassess") > this.scope.budgetUsd)
          throw new BudgetExceededError(spent, this.scope.budgetUsd);
      }
      // With compliance requirements, the new ruling assesses the options against them again (those of the
      // requirements it rules on, a scenario's included). An audit rules again on its audit too.
      const requirements = activeRequirements(work.subject);
      const output =
        session.mode === "audit" ? auditUpdateOutput(requirements.length > 0) : revisionSchema(scenario !== null, requirements.length > 0);
      const { costs, schedules, ...verdict } = await this.call(session, "reassess", null, this.providers.arbiter, prompt, output);
      settleVerdict(session, verdict);
      if ("compliance" in verdict) settleCompliance(verdict as VerdictWithCompliance, requirements);
      const seats = new Set(verdict.options.map((option) => option.seat));
      session.revisions.push({
        number: pending.number,
        createdAt: new Date().toISOString(),
        reason: pending.reason,
        inputs: pending.inputs,
        basedOn: pending.basedOn,
        verdict,
        costs: costs.flatMap((cost) => {
          const monthlyCost = validRange(cost.monthlyCost);
          return seats.has(cost.seat) && monthlyCost ? [{ seat: cost.seat, monthlyCost }] : [];
        }),
        schedules: schedules.flatMap((schedule) => {
          const buildWeeks = validRange(schedule.buildWeeks);
          return seats.has(schedule.seat) && buildWeeks ? [{ seat: schedule.seat, buildWeeks }] : [];
        }),
        critiques,
        by: pending.by,
        ...(scenario ? { scenario } : {}),
        ...(work.changedSheet ? { sheet: work.changedSheet } : {}),
      });
      session.revising = null;
      if (!scenario) {
        // A new revision of the decision's own line: it is the current one, whatever scenario was adopted before.
        session.verdict = verdict;
        session.adopted = null;
        // The reader versions were written for the previous verdict.
        session.briefs = {};
      }
      await this.persist(session);
      return true;
    } catch (error) {
      pending.error = sessionError(this.signal?.aborted ? this.stopped() : error);
      await this.persist(session);
      return false;
    } finally {
      this.scope = null;
    }
  }

  /**
   * The short critique of a revision: one critic (the devil's advocate, or the first seat) reads the options with the
   * new facts, when there are facts and the budget leaves room for the arbiter after it.
   */
  private async reviewFacts(session: Session, work: RevisionWork): Promise<VerdictRevision["critiques"]> {
    const { subject } = work;
    const verdict = subject.verdict;
    const facts = work.facts.filter((fact) => fact.answer.trim() || fact.comment?.trim());
    if (!verdict || facts.length === 0) return [];
    const seat =
      session.devil && this.providers.devil ? DEVIL_SEAT : Object.keys(session.seats).find((key) => this.providers.proposers[key]);
    if (!seat) return [];
    const provider = seat === DEVIL_SEAT ? this.devil() : this.proposer(seat);
    const proposals = currentProposals(subject);
    const targets = Object.fromEntries(Object.entries(proposals).filter(([key]) => verdict.options.some((option) => option.seat === key)));
    if (Object.keys(targets).length === 0) return [];
    if (this.scope?.budgetUsd != null) {
      const reserve = this.promptEstimate(this.reassessPrompt(work, []), "reassess");
      if (this.spent(session) + callEstimate(session, "critique", provider.model) + reserve > this.scope.budgetUsd) return [];
    }
    const persona = seat === DEVIL_SEAT ? (session.devil?.persona ?? null) : (session.seats[seat]?.persona ?? null);
    const data = await this.call(session, "critique", seat, provider, {
      system:
        revisionCriticSystem(session.locale, persona) +
        complianceRule(activeRequirements(subject), "critique") +
        researchRule(subject, "critique"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(requireSheet(subject)),
            profileBlock(sessionProfile(subject)),
            proposalsBlock(targets, computedCosts(subject)),
            researchBlock(subject),
            fence("verdict", JSON.stringify(stripSpeech(verdict), null, 2)),
            factsBlock(facts, work.note),
            `Criticise these options in the light of the new facts only. Valid targets: ${Object.keys(targets).join(", ")}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    data.critiques = data.critiques.filter((critique) => critique.target in targets);
    data.questionsForUser = [];
    return [{ seat, data }];
  }

  private reassessPrompt(work: RevisionWork, critiques: VerdictRevision["critiques"]): { system: string; messages: ChatMessage[] } {
    const { subject } = work;
    if (subject.mode === "audit")
      return withResearch(subject, auditReassessPrompt(subject, { facts: work.facts, note: work.note }, critiques), "arbiter");
    const verdict = subject.verdict as Verdict;
    const said = critiques.flatMap((entry) => entry.data.critiques.map((critique) => ({ from: entry.seat, ...critique })));
    const challenge = subject.mode === "challenge";
    return {
      system:
        (work.scenario ? scenarioSystem(subject.locale, challenge) : reassessSystem(subject.locale, challenge)) +
        complianceRule(activeRequirements(subject), "arbiter") +
        researchRule(subject, "arbiter"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(requireSheet(subject)),
            profileBlock(sessionProfile(subject)),
            ratesBlock(sessionProfile(subject), debateCurrency(subject)),
            proposalsBlock(currentProposals(subject), computedCosts(subject)),
            // A scenario changes the numbers the checks are made with: they are computed again for the arbiter.
            work.scenario ? checksBlock(checkFacts(subject)) : "",
            researchBlock(subject),
            fence("verdict", JSON.stringify(stripSpeech(verdict), null, 2)),
            factsBlock(work.facts, work.note),
            contextBlock(subject.context, CONTEXT_BUDGET.critique),
            said.length > 0 ? fence("debate", JSON.stringify(said, null, 2)) : "",
            work.scenario ? "Rule on these options as if this scenario were true." : "Rule again on these options with the new facts.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    };
  }

  private async interviewStep(session: Session) {
    const opening = [
      `Project idea:\n${fence("answers", session.idea)}`,
      session.challenge ? fence("solution", session.challenge) : "",
      profileBlock(sessionProfile(session)),
      contextBlock(session.context, CONTEXT_BUDGET.interview),
    ]
      .filter(Boolean)
      .join("\n\n");
    const messages: ChatMessage[] = [{ role: "user", content: opening }];
    for (const entry of session.interview) {
      if (entry.kind === "interviewer") messages.push({ role: "assistant", content: JSON.stringify(entry.data) });
      else messages.push({ role: "user", content: answersBlock(entry.answers) || "(no answer)" });
    }
    const userTurns = session.interview.filter((entry) => entry.kind === "user").length;
    const express = session.mode === "express";
    const audit = session.mode === "audit";
    const turn = await this.call(session, "interview", null, this.providers.interviewer, {
      system:
        interviewerSystem(session.locale, {
          forceDone: userTurns >= (express ? 1 : audit ? AUDIT_INTERVIEW_TURNS : MAX_INTERVIEW_TURNS),
          express,
          template: session.template,
          challenge: session.mode === "challenge",
          audit,
          today: new Date().toISOString().slice(0, 10),
        }) + complianceInterviewRule(session.complianceTemplates),
      messages,
    });
    session.interview.push({ kind: "interviewer", data: turn });
    if (turn.status === "done" && turn.sheet) {
      session.sheet = withTemplateFlags(turn.sheet, session.complianceTemplates);
      session.phase = "review";
    }
    await this.persist(session);
  }

  private async debateStep(session: Session) {
    const has = (kind: "proposal" | "critiques" | "revision", seat: string, round: number) =>
      session.debate.some((entry) => entry.kind === kind && entry.seat === seat && entry.round === round);

    // The facts the debate depends on are checked on the web first, when the session asks for it.
    if (needsResearch(session)) {
      await this.research(session);
      return;
    }

    if (session.mode === "challenge") {
      if (!has("proposal", USER_SEAT, 0)) {
        await this.formalize(session);
        return;
      }
    } else if (session.mode === "audit") {
      if (!has("proposal", USER_SEAT, 0)) {
        await this.readDocument(session);
        return;
      }
      // The alternative is sketched once the document is read: by then the currency of the debate is settled.
      const alternative = alternativeSeat(session);
      if (alternative && !has("proposal", alternative, 0)) {
        await this.propose(session, alternative);
        return;
      }
    } else {
      const missingProposals = proposerSeats(session).filter((seat) => !has("proposal", seat, 0));
      if (missingProposals.length > 0) {
        await settleAll(missingProposals.map((seat) => this.propose(session, seat)));
        return;
      }
    }

    // Each step of the rounds first checks that the verdict still fits in the cost cap after it: when it would not,
    // the remaining rounds are skipped and the arbiter rules on what was said.
    for (let round = 1; round <= session.rounds && !session.shortened; round++) {
      const missingCritiques = criticSeats(session).filter((seat) => !has("critiques", seat, round));
      if (missingCritiques.length > 0) {
        const critics = missingCritiques.map((seat) => (seat === DEVIL_SEAT ? this.devil() : this.proposer(seat)));
        if (await this.shortenBefore(session, "critique", critics)) break;
        const proposals = currentProposals(session);
        await settleAll(missingCritiques.map((seat) => this.criticise(session, seat, round, proposals)));
        return;
      }
      if (shouldProbe(session, round)) {
        if (await this.shortenBefore(session, "probe", [this.providers.arbiter])) break;
        await this.probe(session, round);
        return;
      }
      const asked = session.debate.some((entry) => entry.kind === "questions" && entry.round === round);
      if (!asked) {
        const questions = collectQuestions(session, round);
        if (questions.length > 0) {
          session.debate.push({ kind: "questions", round, questions });
          session.phase = "awaiting_answers";
          await this.persist(session);
          return;
        }
      }
      const missingRevisions = proposerSeats(session).filter((seat) => !has("revision", seat, round));
      if (missingRevisions.length > 0) {
        const revisers = missingRevisions.map((seat) => this.proposer(seat));
        if (await this.shortenBefore(session, "revision", revisers)) break;
        await settleAll(missingRevisions.map((seat) => this.revise(session, seat, round)));
        return;
      }
    }

    await this.judge(session);
  }

  /**
   * True, and the session marked shortened, when one more step of `task` by these models would leave less than the
   * verdict needs under the cost cap (with a margin: the transcript the arbiter reads still grows).
   */
  private async shortenBefore(session: Session, task: Task, providers: LlmProvider[]): Promise<boolean> {
    if (session.budgetUsd === null) return false;
    const step = providers.reduce((sum, provider) => sum + callEstimate(session, task, provider.model), 0);
    const reserve = VERDICT_MARGIN * this.verdictEstimate(session);
    if (this.spent(session) + step + reserve <= session.budgetUsd) return false;
    session.shortened = { rounds: completedRounds(session) };
    await this.persist(session);
    return true;
  }

  /** What the verdict should cost: its prompt as it stands, and the typical length of a verdict. */
  private verdictEstimate(session: Session): number {
    // An audit's verdict carries the audit, and a verdict with requirements their assessment: both are longer.
    const longer = session.mode === "audit" || activeRequirements(session).length > 0;
    return this.promptEstimate(this.verdictPrompt(session), "verdict", longer ? LONG_VERDICT_OUTPUT : undefined);
  }

  /**
   * What an arbiter's call should cost under a cap: its prompt as it stands, and the typical length of its answer (at
   * CAP_FALLBACK_PRICE when the arbiter's price is unknown).
   */
  private promptEstimate(prompt: { system: string; messages: ChatMessage[] }, task: "verdict" | "reassess", outputTokens?: number): number {
    const chars = prompt.system.length + prompt.messages.reduce((sum, message) => sum + message.content.length, 0);
    return cappedCostOf(this.providers.arbiter.model, {
      inputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
      outputTokens: outputTokens ?? TASK_PROFILE[task].output,
    });
  }

  /**
   * What was spent under the cap that applies: the calls of this attempt during a revision (never those of an attempt
   * that failed before it), the whole session otherwise. A call of unknown cost counts at CAP_FALLBACK_PRICE.
   */
  private spent(session: Session): number {
    const attempt = this.scope?.attempt;
    return session.usage.reduce((sum, record) => sum + (attempt === undefined || record.attempt === attempt ? cappedCost(record) : 0), 0);
  }

  /**
   * The web research, before the proposals: the researcher plans its searches from the requirements sheet alone,
   * Quorumind runs them (a query searched once is not searched again in the session, even after a resume), then the
   * researcher states what the pages say, each fact with its sources. It never stops the debate: when it cannot run,
   * runs out of budget or fails, its record says why and the debate goes on from the models' own knowledge.
   */
  private async research(session: Session) {
    const settings = session.webResearch as ResearchSettings;
    const search = this.providers.search ?? null;
    const researcher = this.providers.interviewer;
    const record: ResearchRecord = session.research ?? {
      status: "running",
      skipped: null,
      error: null,
      engine: search?.name ?? null,
      kind: search?.kind ?? null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      queries: [],
      facts: [],
    };
    session.research = record;
    const finish = async (status: ResearchRecord["status"], update: Partial<ResearchRecord> = {}) => {
      Object.assign(record, { status, finishedAt: new Date().toISOString(), ...update });
      await this.persist(session);
    };
    // A European-only debate keeps every request on its allowed path: no search engine keeps the queries in Europe.
    if (session.european) return finish("skipped", { skipped: "european", engine: null, kind: null });
    if (!search) return finish("skipped", { skipped: "unavailable", engine: null, kind: null });
    const call = () => callEstimate(session, "research", researcher.model);
    const fits = (usd: number) => researchSpent(session) + usd <= researchBudget(session);
    try {
      if (record.queries.length === 0) {
        if (!fits(2 * call() + search.estimateUsd)) return finish("skipped", { skipped: "budget" });
        const plan = await this.call(session, "research", null, researcher, {
          system: researcherSystem(session.locale, { maxQueries: settings.maxQueries, today: new Date().toISOString().slice(0, 10) }),
          // The sheet alone: never the attached documents, the profile or the person's answers.
          messages: [{ role: "user", content: [requirementsBlock(requireSheet(session)), "Plan the research."].join("\n\n") }],
        });
        record.queries = plannedQueries(plan, session, settings.maxQueries);
        await this.persist(session);
      }
      for (const query of record.queries) {
        if (query.searchedAt !== null || query.error !== null) continue;
        this.checkStopped();
        // Each search leaves room for the call that reads what the searches found.
        if (!fits(search.estimateUsd + call())) {
          query.error = "budget";
          continue;
        }
        try {
          this.hooks.emit(session.id, { type: "speaking", task: "search", seat: null });
          const result = await search.search(query.query, {
            maxResults: MAX_RESULTS_PER_QUERY,
            ...(this.signal ? { signal: this.signal } : {}),
          });
          // A search whose cost the engine does not report counts at its estimate, so that the research keeps to its budget.
          this.record(
            session,
            "search",
            null,
            { model: result.model, usage: result.usage, costUsd: result.costUsd ?? search.estimateUsd },
            result.costUsd === null ? { estimated: true } : {},
          );
          query.searchedAt = new Date().toISOString();
          query.sources = addSources(session, result.hits, query.question, query.searchedAt);
          this.hooks.emit(session.id, { type: "spoke", task: "search", seat: null });
        } catch (error) {
          this.checkStopped();
          query.error = error instanceof Error ? error.message : String(error);
        }
        await this.persist(session);
      }
      if (record.facts.length === 0 && record.queries.some((query) => query.sources.length > 0)) {
        if (!fits(call())) return finish("skipped", { skipped: "budget" });
        const findings = (await this.call(
          session,
          "research",
          null,
          researcher,
          {
            system: findingsSystem(session.locale),
            messages: [{ role: "user", content: [sourcesBlock(record, session.sources), "State what the sources say."].join("\n\n") }],
          },
          RESEARCH_FINDINGS,
        )) as unknown as ResearchFindings;
        record.facts = settleResearchFacts(findings, session.sources);
      }
      await finish("done");
    } catch (error) {
      if (error instanceof StoppedError || this.signal?.aborted) throw error;
      if (error instanceof BudgetExceededError) return finish("skipped", { skipped: "budget" });
      await finish("failed", { error: sessionError(error) });
    }
  }

  private async formalize(session: Session) {
    const sheet = requireSheet(session);
    const proposal = await this.call(session, "proposal", USER_SEAT, this.providers.interviewer, {
      system: formalizerSystem(session.locale) + designRules(session),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            ratesBlock(sessionProfile(session), debateCurrency(session)),
            researchBlock(session),
            fence("solution", session.challenge ?? session.idea),
            "Restate this solution.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "proposal", round: 0, seat: USER_SEAT, data: proposal });
    await this.persist(session);
  }

  /**
   * Audit mode: the formalizer restates what the document commits to, and the document becomes option U. A debate
   * whose need names no amount takes the document's currency.
   */
  private async readDocument(session: Session) {
    const audit = session.audit;
    if (!audit) throw new InvalidStateError("This session has no document to audit.");
    const prompt = auditExtractionPrompt(session);
    const read = (await this.call(session, "proposal", USER_SEAT, this.providers.interviewer, prompt, AUDIT_EXTRACTION)) as unknown;
    const extraction = settleExtraction(read as AuditExtraction, auditedDocuments(session));
    const budget = requireSheet(session).budget;
    const currency = currencyCode(extraction.currency);
    if (currency && !budget.build && !budget.run) session.currency = currency;
    audit.extraction = extraction;
    session.debate.push({ kind: "proposal", round: 0, seat: USER_SEAT, data: auditProposal(extraction, debateCurrency(session)) });
    await this.persist(session);
  }

  private async propose(session: Session, seat: string) {
    if (session.mode === "audit") {
      const proposal = await this.call(
        session,
        "proposal",
        seat,
        this.proposer(seat),
        withResearch(session, auditAlternativePrompt(session, seat), "design"),
      );
      session.debate.push({ kind: "proposal", round: 0, seat, data: proposal });
      await this.persist(session);
      return;
    }
    const sheet = requireSheet(session);
    const proposal = await this.call(session, "proposal", seat, this.proposer(seat), {
      system: proposerSystem(session.locale, seat, session.seats[seat]?.persona ?? null) + designRules(session),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            ratesBlock(sessionProfile(session), debateCurrency(session)),
            researchBlock(session),
            contextBlock(session.context, CONTEXT_BUDGET.proposal),
            "Design your solution.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "proposal", round: 0, seat, data: proposal });
    await this.persist(session);
  }

  private async criticise(session: Session, seat: string, round: number, proposals: Record<string, Proposal>) {
    if (session.mode === "audit") {
      await this.examineDocument(session, seat, round);
      return;
    }
    const sheet = requireSheet(session);
    const devil = seat === DEVIL_SEAT;
    const targets = Object.fromEntries(Object.entries(proposals).filter(([other]) => other !== seat));
    const persona = devil ? (session.devil?.persona ?? null) : (session.seats[seat]?.persona ?? null);
    const system =
      session.mode === "challenge" && !devil
        ? challengerSystem(session.locale, seat, persona)
        : devil
          ? devilSystem(session.locale, persona)
          : criticSystem(session.locale, seat, persona);
    // Critics see what was already said in earlier rounds, so they dig deeper instead of repeating it.
    const earlier = session.debate.flatMap((entry) =>
      entry.kind === "critiques" && entry.round < round ? entry.data.critiques.map((critique) => ({ from: entry.seat, ...critique })) : [],
    );
    const probe = latestProbe(session.debate, round);
    const critiques = await this.call(session, "critique", seat, devil ? this.devil() : this.proposer(seat), {
      system: system + complianceRule(activeRequirements(session), "critique") + researchRule(session, "critique"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock(targets, computedCosts(session)),
            researchBlock(session),
            contextBlock(session.context, CONTEXT_BUDGET.critique),
            earlier.length > 0 ? fence("debate", JSON.stringify(earlier, null, 2)) : "",
            probe ? fence("probe", probe.angle) : "",
            `Criticise these proposals. Valid targets: ${Object.keys(targets).join(", ")}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    critiques.critiques = critiques.critiques.filter((critique) => critique.target !== seat && critique.target in proposals);
    session.debate.push({ kind: "critiques", round, seat, data: critiques });
    await this.persist(session);
  }

  /** Audit mode: a critic or the devil's advocate examines the document, every quote checked against it. */
  private async examineDocument(session: Session, seat: string, round: number) {
    const devil = seat === DEVIL_SEAT;
    const persona = devil ? (session.devil?.persona ?? null) : (session.seats[seat]?.persona ?? null);
    const system = devil ? auditDevilSystem(session.locale, persona) : auditCriticSystem(session.locale, seat, persona);
    const provider = devil ? this.devil() : this.proposer(seat);
    const prompt = withResearch(session, auditCritiquePrompt(session, seat, round, system), "critique");
    const found = (await this.call(session, "critique", seat, provider, prompt, AUDIT_FINDINGS)) as unknown;
    session.debate.push({ kind: "critiques", round, seat, data: settleFindings(found as AuditCritiqueInput, auditedDocuments(session)) });
    await this.persist(session);
  }

  private async probe(session: Session, round: number) {
    const sheet = requireSheet(session);
    const critiques = session.debate.flatMap((entry) =>
      entry.kind === "critiques" ? entry.data.critiques.map((critique) => ({ round: entry.round, from: entry.seat, ...critique })) : [],
    );
    const probe = await this.call(session, "probe", null, this.providers.arbiter, {
      system: probeSystem(session.locale),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session), computedCosts(session)),
            contextBlock(session.context, CONTEXT_BUDGET.critique),
            fence("debate", JSON.stringify(critiques, null, 2)),
            "Find the angle nobody examined.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "probe", round, data: probe });
    // The angle is examined in the next round: add one when this was the last.
    if (round === session.rounds) session.rounds += 1;
    await this.persist(session);
  }

  private async revise(session: Session, seat: string, round: number) {
    const sheet = requireSheet(session);
    const own = currentProposals(session)[seat];
    if (!own) throw new InvalidStateError(`Proposal ${seat} is missing.`);
    const received = session.debate.flatMap((entry) =>
      entry.kind === "critiques" && entry.round === round
        ? entry.data.critiques.filter((critique) => critique.target === seat).map((critique) => ({ from: entry.seat, ...critique }))
        : [],
    );
    const revision = await this.call(session, "revision", seat, this.proposer(seat), {
      system: reviserSystem(session.locale, seat, session.seats[seat]?.persona ?? null) + designRules(session),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            ratesBlock(sessionProfile(session), debateCurrency(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock({ [seat]: own }, computedCosts(session)),
            researchBlock(session),
            fence("debate", JSON.stringify(received, null, 2)),
            received.length === 0
              ? "No critique targeted your proposal this round. Confirm or improve it."
              : "Answer these critiques and return your revised proposal.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "revision", round, seat, data: revision });
    await this.persist(session);
  }

  private async judge(session: Session) {
    // The cap is checked against the verdict's estimate: a verdict that cannot fit is not started.
    if (session.budgetUsd !== null) {
      const spent = this.spent(session);
      if (spent + this.verdictEstimate(session) > session.budgetUsd) throw new BudgetExceededError(spent, session.budgetUsd);
    }
    const requirements = activeRequirements(session);
    const prompt = this.verdictPrompt(session);
    // With compliance requirements, the arbiter also assesses every option against each of them.
    // An audit's verdict carries the audit itself.
    const output =
      session.mode === "audit" ? auditVerdictOutput(requirements.length > 0) : requirements.length > 0 ? COMPLIANCE_VERDICT : undefined;
    const verdict = await this.call(session, "verdict", null, this.providers.arbiter, prompt, output);
    settleVerdict(session, verdict);
    if ("compliance" in verdict) settleCompliance(verdict as VerdictWithCompliance, requirements);
    session.debate.push({ kind: "verdict", data: verdict });
    session.verdict = verdict;
    session.revisions = [firstRevision(verdict, new Date().toISOString())];
    session.phase = "complete";
    await this.persist(session);
  }

  private verdictPrompt(session: Session): { system: string; messages: ChatMessage[] } {
    if (session.mode === "audit") return withResearch(session, auditVerdictPrompt(session), "arbiter");
    const sheet = requireSheet(session);
    const transcript = session.debate.flatMap<object>((entry) => {
      if (entry.kind === "critiques") return [{ round: entry.round, from: entry.seat, critiques: entry.data.critiques }];
      if (entry.kind === "probe") return [{ round: entry.round, from: "arbiter", angle: entry.data.angle }];
      if (entry.kind === "revision") {
        return [
          {
            round: entry.round,
            from: entry.seat,
            replies: entry.data.replies,
            withdrawn: entry.data.withdrawn,
            endorses: entry.data.endorses,
          },
        ];
      }
      return [];
    });
    return {
      system:
        arbiterSystem(session.locale, session.mode === "challenge") +
        complianceRule(activeRequirements(session), "arbiter") +
        researchRule(session, "arbiter"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session), computedCosts(session)),
            checksBlock(checkFacts(session)),
            researchBlock(session),
            contextBlock(session.context, CONTEXT_BUDGET.verdict),
            fence("debate", JSON.stringify(transcript, null, 2)),
            "Rule on these options.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    };
  }

  private devil(): LlmProvider {
    if (!this.providers.devil) throw new InvalidStateError("No model is assigned to the devil's advocate.", "invalid_lineup");
    return this.providers.devil;
  }

  private proposer(seat: string): LlmProvider {
    const provider = this.providers.proposers[seat];
    if (!provider) throw new InvalidStateError(`No model is assigned to seat ${seat}.`, "invalid_lineup");
    return provider;
  }

  private async call<K extends keyof typeof SCHEMAS>(
    session: Session,
    task: K,
    seat: string | null,
    provider: LlmProvider,
    prompt: { system: string; messages: ChatMessage[] },
    // Another schema for the task, whose answer extends the usual one (the verdict with its compliance assessment).
    override?: OutputSpec,
  ): Promise<z.infer<(typeof SCHEMAS)[K]["zod"]>> {
    const spec: OutputSpec = override ?? SCHEMAS[task];
    const messages = session.redact
      ? prompt.messages.map((message) => (message.role === "user" ? { ...message, content: redact(message.content) } : message))
      : prompt.messages;
    const promptChars = prompt.system.length + messages.reduce((sum, message) => sum + message.content.length, 0);
    let lastError: unknown;
    for (let attempt = 0; ; attempt++) {
      this.checkStopped();
      this.checkBudget(session);
      this.hooks.emit(session.id, { type: "speaking", task, seat });
      let raw = "";
      let shown = "";
      let recorded: UsageRecord | null = null;
      try {
        const result = await provider.generate(
          {
            task,
            seat,
            system: prompt.system,
            messages,
            ...(EFFORT[session.depth] ? { effort: EFFORT[session.depth] } : {}),
            schema: spec.json,
            schemaName: spec.name,
            maxTokens: spec.maxTokens,
            ...(this.signal ? { signal: this.signal } : {}),
          },
          (delta) => {
            raw += delta;
            const speech = partialStringField(raw, "speech");
            if (speech !== null && speech !== shown) {
              shown = speech;
              this.hooks.emit(session.id, { type: "speech", task, seat, text: speech });
            }
          },
        );
        // A stream that ended without its usage is not a free call: its tokens are estimated from what was sent and read.
        const usage = result.usageMissing
          ? { inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN), outputTokens: Math.ceil(result.text.length / CHARS_PER_TOKEN) }
          : result.usage;
        recorded = this.record(
          session,
          task,
          seat,
          {
            model: result.model,
            usage,
            costUsd: result.costUsd ?? costOf(result.model, usage) ?? costOf(provider.model, usage),
          },
          result.usageMissing ? { estimated: true } : {},
        );
        const parsed = spec.zod.safeParse(JSON.parse(result.text));
        if (!parsed.success) throw new ProviderError(`The ${task} answer does not match its schema.`, true);
        this.hooks.emit(session.id, { type: "spoke", task, seat });
        return parsed.data as z.infer<(typeof SCHEMAS)[K]["zod"]>;
      } catch (error) {
        // A call that fails once the provider took it is billed all the same: it counts against the cap like any other.
        recorded ??= this.recordFailure(session, task, seat, provider, error, { promptChars, received: raw.length });
        // Whatever the provider made of the cancellation, the person stopped the call.
        this.checkStopped();
        lastError = error;
        const delay = retryDelay(error, attempt, this.retryDelayMs);
        if (delay === null) break;
        // Another try must fit in the cap as well: a call that failed after a full answer costs as much again.
        if (recorded?.costUsd) this.checkBudget(session, recorded.costUsd);
        await this.pause(delay);
      }
    }
    if (lastError instanceof Object) failedCalls.set(lastError, { provider: provider.kind, model: provider.model });
    throw lastError;
  }

  /** Records what a call cost, under the revision or the brief it was made for. */
  private record(
    session: Session,
    task: Task,
    seat: string | null,
    call: { model: string; usage: Usage; costUsd: number | null },
    flags: Pick<UsageRecord, "failed" | "estimated"> = {},
  ): UsageRecord {
    const record: UsageRecord = {
      id: globalThis.crypto.randomUUID(),
      task,
      seat,
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      costUsd: call.costUsd,
      ...(this.scope ? { attempt: this.scope.attempt, ...(this.scope.revision === null ? {} : { revision: this.scope.revision }) } : {}),
      ...flags,
    };
    session.usage.push(record);
    return record;
  }

  /**
   * Records a call that failed, when the provider may bill it: the usage it reported (an answer cut by the token limit,
   * declined, or interrupted after usage was sent), else an estimate for a call that was stopped or cut short after the
   * answer started. A call refused before any answer (an HTTP error) costs nothing and is not recorded.
   */
  private recordFailure(
    session: Session,
    task: Task,
    seat: string | null,
    provider: LlmProvider,
    error: unknown,
    sent: { promptChars: number; received: number },
  ): UsageRecord | null {
    if (error instanceof ProviderError && error.usage) {
      const model = error.model ?? provider.model;
      const costUsd = error.costUsd ?? costOf(model, error.usage) ?? costOf(provider.model, error.usage);
      return this.record(session, task, seat, { model, usage: error.usage, costUsd }, { failed: true });
    }
    if (!this.signal?.aborted && sent.received === 0) return null;
    const usage = { inputTokens: Math.ceil(sent.promptChars / CHARS_PER_TOKEN), outputTokens: Math.ceil(sent.received / CHARS_PER_TOKEN) };
    return this.record(
      session,
      task,
      seat,
      { model: provider.model, usage, costUsd: costOf(provider.model, usage) },
      { failed: true, estimated: true },
    );
  }

  /** Waits before a call is tried again; the stop signal ends the wait at once. */
  private async pause(ms: number) {
    if (ms > 0) {
      await new Promise<void>((resolve) => {
        const end = () => {
          clearTimeout(timer);
          this.signal?.removeEventListener("abort", end);
          resolve();
        };
        const timer = setTimeout(end, ms);
        this.signal?.addEventListener("abort", end, { once: true });
      });
    }
    this.checkStopped();
  }

  private stopped() {
    return new StoppedError(this.signal?.reason === INTERRUPTED ? "interrupted" : "stopped");
  }

  private checkStopped() {
    if (this.signal?.aborted) throw this.stopped();
  }

  /** Throws when the cap that applies is reached, or would be by a call of `nextUsd`. */
  private checkBudget(session: Session, nextUsd = 0) {
    const cap = this.scope ? this.scope.budgetUsd : session.budgetUsd;
    if (cap === null) return;
    const spent = this.spent(session);
    if (spent >= cap || spent + nextUsd > cap) throw new BudgetExceededError(spent, cap);
  }

  private async persist(session: Session) {
    session.updatedAt = new Date().toISOString();
    // The calls of a step run side by side and each saves when it ends: the saves wait for one another, so they are
    // made in order and the last one holds everything.
    const save = this.saving.then(() => this.hooks.save(session));
    // A failed save fails the step that made it, not the saves after it.
    this.saving = save.catch(() => {});
    await save;
    this.hooks.emit(session.id, { type: "session", session });
  }

  private async guard(session: Session, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      session.phase = "failed";
      session.error = sessionError(this.signal?.aborted ? this.stopped() : error);
      await this.persist(session);
    }
  }
}

/**
 * How often a call is tried: an answer that is not valid JSON or misses its schema, or that was cut off, once more at
 * once; a call that hit a rate limit or an outage twice more, after a wait. Calls of a step run side by side against
 * the same provider: the jitter keeps their retries from hitting its rate limit together again.
 */
const MAX_ATTEMPTS = 2;
const MAX_TRANSIENT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
/** A provider that asks to wait longer than this is not waited for: the session fails, and can be resumed later. */
const MAX_RETRY_WAIT_MS = 60_000;

/** How long to wait before trying a failed call again, or null when it is not tried again. */
export function retryDelay(error: unknown, attempt: number, baseMs: number, random = Math.random): number | null {
  if (error instanceof SyntaxError) return attempt + 1 < MAX_ATTEMPTS ? 0 : null;
  if (!(error instanceof ProviderError) || !error.retryable) return null;
  const transient = error.code === "provider_rate_limit" || error.code === "provider_unavailable";
  if (attempt + 1 >= (transient ? MAX_TRANSIENT_ATTEMPTS : MAX_ATTEMPTS)) return null;
  if (!transient) return 0;
  if (error.retryAfterMs !== undefined) return error.retryAfterMs <= MAX_RETRY_WAIT_MS ? error.retryAfterMs : null;
  // Exponential backoff with jitter: between half and one and a half times the delay, doubled at each attempt.
  return Math.round(baseMs * 2 ** attempt * (0.5 + random()));
}

// The verdict's estimate is kept with this margin while the rounds run: what the arbiter reads still grows.
const VERDICT_MARGIN = 1.25;
/** The typical answer of an audit's verdict, or of one that assesses compliance requirements: about twice the usual. */
const LONG_VERDICT_OUTPUT = 2 * TASK_PROFILE.verdict.output;
/** The share of a session's cost cap each brief may spend, unless the host gives briefs a cap of their own. */
export const BRIEF_CAP_SHARE = 0.1;
// A rough count, enough for an estimate: about four characters of English or JSON per token.
const CHARS_PER_TOKEN = 4;

/**
 * What one more call of a task by this model should cost under a cap: its last such call, or the typical one (at
 * CAP_FALLBACK_PRICE when the model's price is unknown).
 */
function callEstimate(session: Session, task: Task, model: string): number {
  const last = session.usage.findLast((record) => record.task === task && record.model === model && !record.failed);
  if (last) return cappedCost(last);
  return task in TASK_PROFILE ? typicalCappedCost(model, task as keyof typeof TASK_PROFILE) : 0;
}

/** The rounds every critic and every proposer finished. */
function completedRounds(session: Session): number {
  const has = (kind: "critiques" | "revision", seat: string, round: number) =>
    session.debate.some((entry) => entry.kind === kind && entry.seat === seat && entry.round === round);
  let done = 0;
  for (let round = 1; round <= session.rounds; round++) {
    const critiqued = criticSeats(session).every((seat) => has("critiques", seat, round));
    const revised = proposerSeats(session).every((seat) => has("revision", seat, round));
    if (!critiqued || !revised) break;
    done = round;
  }
  return done;
}

/**
 * Runs the calls of one step side by side and waits for all of them, even when one fails: the answers that arrive
 * are kept (they are paid for), and nothing still writes to the session once it is marked failed.
 */
async function settleAll(calls: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(calls);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}

/** The proposals as a model writing for a client reads them: without the day rates, nor any text that states one. */
function clientProposals(proposals: Record<string, Proposal>): Record<string, Proposal> {
  return Object.fromEntries(
    Object.entries(proposals).map(([seat, proposal]) => {
      const clean = withoutRates(proposal);
      return [seat, { ...clean, estimate: { ...clean.estimate, dayRates: [] } }];
    }),
  );
}

/** The build cost of each option as Quorumind priced it, for the models that read the proposals. */
function computedCosts(session: Session): Record<string, ComputedCost> {
  return Object.fromEntries(
    Object.entries(sessionCostings(session)).map(([seat, costing]) => [
      seat,
      { currency: costing.currency, low: costing.total.low, high: costing.total.high, personDays: costing.days },
    ]),
  );
}

/**
 * What a revision is ruled on: the session as it stood at the revision it starts from, with a scenario's changes
 * applied to its requirements, and the facts the models read.
 */
interface RevisionWork {
  subject: Session;
  facts: RevisionFact[];
  note: string | null;
  scenario: boolean;
  /** The requirements a scenario changed; null when they are those of the revision it starts from. */
  changedSheet: RequirementsSheet | null;
}

function revisionWork(session: Session, pending: PendingRevision): RevisionWork {
  const base = sessionAtRevision(session, pending.basedOn) ?? session;
  const scenario = pending.reason === "scenario" ? pending.scenario : undefined;
  if (!scenario) return { subject: base, facts: pending.inputs.facts, note: pending.inputs.note, scenario: false, changedSheet: null };
  const { sheet, applied } = applyScenario(requireSheet(base), scenario.changes);
  const changed = JSON.stringify(sheet) !== JSON.stringify(base.sheet);
  return {
    subject: changed ? { ...base, sheet } : base,
    facts: scenarioFacts(applied, scenario.question),
    note: "A hypothetical scenario: weigh it as if it were true.",
    scenario: true,
    changedSheet: changed ? sheet : null,
  };
}

/**
 * An audit's prompt with the web research: the facts and their source ids before the rest of the request, and what the
 * role is told about them. The arbiter is always told, since it may verify a claim only against a source.
 */
function withResearch(
  session: Session,
  prompt: { system: string; messages: ChatMessage[] },
  role: "design" | "critique" | "arbiter",
): { system: string; messages: ChatMessage[] } {
  const block = researchBlock(session);
  const [first, ...rest] = prompt.messages;
  return {
    system: prompt.system + researchRule(session, role),
    messages: block && first?.role === "user" ? [{ ...first, content: `${block}\n\n${first.content}` }, ...rest] : prompt.messages,
  };
}

/**
 * Records the pages a search found as sources of the session, numbered S1, S2…: a page found again keeps its first
 * number. Returns their ids.
 */
function addSources(session: Session, hits: SearchHit[], question: string, retrievedAt: string): string[] {
  const ids: string[] = [];
  for (const hit of hits) {
    const known = session.sources.find((source) => source.url === hit.url);
    if (known) {
      if (!ids.includes(known.id)) ids.push(known.id);
      continue;
    }
    const source: Source = {
      id: `S${session.sources.length + 1}`,
      url: hit.url,
      title: hit.title,
      snippet: hit.snippet,
      retrievedAt: hit.retrievedAt ?? retrievedAt,
      question,
    };
    session.sources.push(source);
    ids.push(source.id);
  }
  return ids;
}

/**
 * Keeps a ruling to the options of the debate: unknown seats dropped, scores within 1 to 5, and a claim "verified" only
 * when it cites a source the research found. An audit's quotes are checked against the document.
 */
function settleVerdict(session: Session, verdict: Verdict) {
  settleClaims(verdict, citedSources(session));
  const audited = verdict as Partial<AuditedVerdict>;
  if (session.mode === "audit" && audited.audit) audited.audit = settleAudit(audited.audit, auditedDocuments(session));
  const seats = new Set(Object.keys(currentProposals(session)));
  verdict.options = verdict.options.filter((option) => seats.has(option.seat));
  for (const option of verdict.options) {
    for (const score of option.scores) score.score = clampScore(score.score);
  }
  if (verdict.recommendation.seat !== null && !seats.has(verdict.recommendation.seat)) verdict.recommendation.seat = null;
}

/** A cost range a model gave, or null when it is not one: negative or not a number. */
function validRange<T extends { low: number; high: number }>(range: T | null): T | null {
  if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return null;
  if (range.low < 0 || range.high < 0) return null;
  return range.low <= range.high ? range : { ...range, low: range.high, high: range.low };
}

/** What a call answers with: the schema in both forms, its name and the room the answer gets. */
interface OutputSpec {
  zod: z.ZodType;
  json: { [key: string]: unknown };
  name: string;
  maxTokens: number;
}

/** What the roles that design an option also follow: the compliance requirements and the reference cloud prices. */
function designRules(session: Session): string {
  return complianceRule(activeRequirements(session), "design") + priceReferenceRule() + researchRule(session, "design");
}

function collectQuestions(session: Session, round: number): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const entry of session.debate) {
    if (entry.kind !== "critiques" || entry.round !== round) continue;
    for (const question of entry.data.questionsForUser) {
      const key = question.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        questions.push(question.trim());
      }
    }
  }
  return questions.slice(0, MAX_QUESTIONS_PER_ROUND);
}

/**
 * Soft consensus: every critic of the round found nothing blocking or major. The arbiter then
 * raises an angle nobody examined, once per debate. Express sessions skip it to stay short.
 */
export function shouldProbe(session: Session, round: number): boolean {
  if (session.mode === "express") return false;
  if (session.debate.some((entry) => entry.kind === "probe")) return false;
  const critiques = session.debate.flatMap((entry) => (entry.kind === "critiques" && entry.round === round ? entry.data.critiques : []));
  return !critiques.some((critique) => critique.severity === "blocking" || critique.severity === "major");
}

function latestProbe(debate: DebateEntry[], beforeRound: number) {
  const entry = debate.findLast((item) => item.kind === "probe" && item.round < beforeRound);
  return entry?.kind === "probe" ? entry.data : null;
}

function stripSpeech<T extends { speech: string }>(value: T): Omit<T, "speech"> {
  const { speech: _speech, ...rest } = value;
  return rest;
}
