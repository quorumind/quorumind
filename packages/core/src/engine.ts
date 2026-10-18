import type { z } from "zod";
import { PRICE_REFERENCE, priceReferenceRule } from "./cloud-prices.ts";
import { activeRequirements, complianceInterviewRule, complianceRule, withTemplateFlags } from "./compliance.ts";
import { COMPLIANCE_UPDATE, COMPLIANCE_VERDICT, settleCompliance, type VerdictWithCompliance } from "./compliance-verdict.ts";
import { checkFacts, debateCurrency, sessionCostings, sessionProfile } from "./costing.ts";
import { partialStringField } from "./partial-json.ts";
import { costOf, TASK_PROFILE, typicalCallCost } from "./pricing.ts";
import { fence, redact } from "./privacy.ts";
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
  formalizerSystem,
  interviewerSystem,
  probeSystem,
  profileBlock,
  proposalsBlock,
  proposerSystem,
  ratesBlock,
  reassessSystem,
  requirementsBlock,
  reviserSystem,
  revisionCriticSystem,
} from "./prompts.ts";
import { type ChatMessage, type LlmProvider, ProviderError, type Task } from "./providers/types.ts";
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
import {
  type Answer,
  allAnswers,
  criticSeats,
  currentProposals,
  DEVIL_SEAT,
  type DebateEntry,
  type Depth,
  firstRevision,
  type PendingRevision,
  proposerSeats,
  type RevisionInputs,
  type Session,
  type SessionError,
  totalCost,
  USER_SEAT,
  type VerdictRevision,
} from "./session.ts";

/** After this many answered turns the interviewer must produce the requirements sheet. */
export const MAX_INTERVIEW_TURNS = 4;
const MAX_QUESTIONS_PER_ROUND = 3;

export interface ProviderSet {
  interviewer: LlmProvider;
  arbiter: LlmProvider;
  /** Every debating seat. In challenge mode they criticise the person's solution instead of proposing. */
  proposers: Record<string, LlmProvider>;
  devil?: LlmProvider | null;
}

const EFFORT: Record<Depth, "low" | "high" | undefined> = { quick: "low", standard: undefined, deep: "high" };

export type EngineEvent =
  | { type: "session"; session: Session }
  | { type: "speaking"; task: Task; seat: string | null }
  | { type: "speech"; task: Task; seat: string | null; text: string }
  | { type: "spoke"; task: Task; seat: string | null };

export interface EngineHooks {
  emit(sessionId: string, event: EngineEvent): void;
  save(session: Session): void | Promise<void>;
}

/** What a new verdict revision is made from, and who asks for it. */
export interface RevisionRequest {
  reason: PendingRevision["reason"];
  inputs: RevisionInputs;
  /** The user id on a hosted server; null for the local user. */
  by: string | null;
}

export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded";
  readonly params: { spentUsd: number; budgetUsd: number };
  constructor(spentUsd: number, budgetUsd: number) {
    super(`The cost cap of $${budgetUsd.toFixed(2)} is reached ($${spentUsd.toFixed(2)} spent).`);
    this.name = "BudgetExceededError";
    this.params = { spentUsd: roundUsd(spentUsd), budgetUsd: roundUsd(budgetUsd) };
  }
}

/**
 * Why an action does not fit where the session stands. wrong_phase: the session is not at the step the action
 * belongs to; the server adds its own codes (session_busy, not_running).
 */
export class InvalidStateError extends Error {
  readonly code: string;
  readonly params: SessionError["params"];
  constructor(message: string, code = "wrong_phase", params?: SessionError["params"]) {
    super(message);
    this.name = "InvalidStateError";
    this.code = code;
    this.params = params;
  }
}

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

const SCHEMAS = {
  interview: { zod: InterviewTurn, json: toStrictJsonSchema(InterviewTurn), name: "interview_turn", maxTokens: 8_000 },
  proposal: { zod: Proposal, json: toStrictJsonSchema(Proposal), name: "proposal", maxTokens: 12_000 },
  critique: { zod: CritiqueRound, json: toStrictJsonSchema(CritiqueRound), name: "critique_round", maxTokens: 10_000 },
  revision: { zod: Revision, json: toStrictJsonSchema(Revision), name: "revision", maxTokens: 14_000 },
  probe: { zod: Probe, json: toStrictJsonSchema(Probe), name: "probe", maxTokens: 4_000 },
  verdict: { zod: Verdict, json: toStrictJsonSchema(Verdict), name: "verdict", maxTokens: 20_000 },
  reassess: { zod: VerdictUpdate, json: toStrictJsonSchema(VerdictUpdate), name: "verdict_update", maxTokens: 20_000 },
  brief: { zod: Brief, json: toStrictJsonSchema(Brief), name: "brief", maxTokens: 8_000 },
} as const;

export class DebateEngine {
  private readonly providers: ProviderSet;
  private readonly hooks: EngineHooks;
  private readonly signal: AbortSignal | undefined;
  /** The verdict revision being made: its calls are recorded under its number and capped by its own budget. */
  private scope: { revision: number; budgetUsd: number | null } | null = null;

  /**
   * @param options.signal stops the work: the calls in flight are cancelled and the session fails with the code
   * "stopped", ready to be resumed. A call cut short is not recorded, so it costs the person nothing.
   */
  constructor(providers: ProviderSet, hooks: EngineHooks, options: { signal?: AbortSignal } = {}) {
    this.providers = providers;
    this.hooks = hooks;
    this.signal = options.signal;
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
  async writeBrief(session: Session, audience: Audience): Promise<void> {
    if (session.phase !== "complete" || !session.verdict) throw new InvalidStateError("The verdict is not ready yet.");
    const brief = await this.call(session, "brief", null, this.providers.arbiter, {
      system: briefSystem(session.locale, audience),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(requireSheet(session)),
            proposalsBlock(currentProposals(session), computedCosts(session)),
            fence("debate", JSON.stringify({ verdict: stripSpeech(session.verdict) }, null, 2)),
            `Write the brief for this reader: ${audience}.`,
          ].join("\n\n"),
        },
      ],
    });
    session.briefs[audience] = brief;
    await this.persist(session);
  }

  /**
   * Records a new revision of the verdict as pending, from new facts: answers to the open questions or corrections.
   * runRevision then makes it. A revision that failed is replaced.
   */
  async beginRevision(session: Session, request: RevisionRequest): Promise<PendingRevision> {
    if (session.phase !== "complete" || !session.verdict) throw new InvalidStateError("The verdict is not ready yet.");
    if (session.revising && !session.revising.error) {
      throw new InvalidStateError("The verdict is already being revised. Wait for it to finish.", "session_busy");
    }
    if (session.revisions.length === 0) session.revisions.push(firstRevision(session.verdict, session.updatedAt));
    const latest = session.revisions.at(-1) as VerdictRevision;
    session.revising = {
      id: globalThis.crypto.randomUUID(),
      number: latest.number + 1,
      reason: request.reason,
      inputs: structuredClone(request.inputs),
      basedOn: latest.number,
      by: request.by,
      startedAt: new Date().toISOString(),
      error: null,
    };
    await this.persist(session);
    return session.revising;
  }

  /**
   * Makes the pending revision: a short critique of the options with the new facts when there is room for it, then
   * the arbiter rules again. Only these calls are made, never the debate. `budgetUsd` caps what they may cost
   * together. A failure leaves the current verdict as it is, the pending revision carrying the error. Returns true
   * when the new verdict was produced.
   */
  async runRevision(session: Session, options: { budgetUsd?: number | null } = {}): Promise<boolean> {
    const pending = session.revising;
    if (!pending || pending.error || !session.verdict) throw new InvalidStateError("No revision is waiting to be made.");
    this.scope = { revision: pending.number, budgetUsd: options.budgetUsd ?? null };
    try {
      const critiques = await this.reviewFacts(session, pending);
      const prompt = this.reassessPrompt(session, pending, critiques);
      if (this.scope.budgetUsd !== null) {
        const spent = this.spent(session);
        if (spent + this.promptEstimate(prompt, "reassess") > this.scope.budgetUsd)
          throw new BudgetExceededError(spent, this.scope.budgetUsd);
      }
      // With compliance requirements, the new ruling assesses the options against them again.
      const requirements = activeRequirements(session);
      const { costs, ...verdict } =
        requirements.length > 0
          ? await this.call(session, "reassess", null, this.providers.arbiter, prompt, COMPLIANCE_UPDATE)
          : await this.call(session, "reassess", null, this.providers.arbiter, prompt);
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
        critiques,
        by: pending.by,
      });
      session.verdict = verdict;
      session.revising = null;
      // The reader versions were written for the previous verdict.
      session.briefs = {};
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
  private async reviewFacts(session: Session, pending: PendingRevision): Promise<VerdictRevision["critiques"]> {
    const verdict = session.verdict;
    const facts = pending.inputs.facts.filter((fact) => fact.answer.trim() || fact.comment?.trim());
    if (!verdict || facts.length === 0) return [];
    const seat =
      session.devil && this.providers.devil ? DEVIL_SEAT : Object.keys(session.seats).find((key) => this.providers.proposers[key]);
    if (!seat) return [];
    const provider = seat === DEVIL_SEAT ? this.devil() : this.proposer(seat);
    const proposals = currentProposals(session);
    const targets = Object.fromEntries(Object.entries(proposals).filter(([key]) => verdict.options.some((option) => option.seat === key)));
    if (Object.keys(targets).length === 0) return [];
    if (this.scope?.budgetUsd != null) {
      const reserve = this.promptEstimate(this.reassessPrompt(session, pending, []), "reassess");
      if (this.spent(session) + callEstimate(session, "critique", provider.model) + reserve > this.scope.budgetUsd) return [];
    }
    const persona = seat === DEVIL_SEAT ? (session.devil?.persona ?? null) : (session.seats[seat]?.persona ?? null);
    const data = await this.call(session, "critique", seat, provider, {
      system: revisionCriticSystem(session.locale, persona) + complianceRule(activeRequirements(session), "critique"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(requireSheet(session)),
            profileBlock(sessionProfile(session)),
            proposalsBlock(targets, computedCosts(session)),
            fence("verdict", JSON.stringify(stripSpeech(verdict), null, 2)),
            factsBlock(facts, pending.inputs.note),
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

  private reassessPrompt(
    session: Session,
    pending: PendingRevision,
    critiques: VerdictRevision["critiques"],
  ): { system: string; messages: ChatMessage[] } {
    const verdict = session.verdict as Verdict;
    const said = critiques.flatMap((entry) => entry.data.critiques.map((critique) => ({ from: entry.seat, ...critique })));
    return {
      system: reassessSystem(session.locale, session.mode === "challenge") + complianceRule(activeRequirements(session), "arbiter"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(requireSheet(session)),
            profileBlock(sessionProfile(session)),
            ratesBlock(sessionProfile(session), debateCurrency(session)),
            proposalsBlock(currentProposals(session), computedCosts(session)),
            fence("verdict", JSON.stringify(stripSpeech(verdict), null, 2)),
            factsBlock(pending.inputs.facts, pending.inputs.note),
            contextBlock(session.context, CONTEXT_BUDGET.critique),
            said.length > 0 ? fence("debate", JSON.stringify(said, null, 2)) : "",
            "Rule again on these options with the new facts.",
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
    const turn = await this.call(session, "interview", null, this.providers.interviewer, {
      system:
        interviewerSystem(session.locale, {
          forceDone: userTurns >= (express ? 1 : MAX_INTERVIEW_TURNS),
          express,
          template: session.template,
          challenge: session.mode === "challenge",
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

    if (session.mode === "challenge") {
      if (!has("proposal", USER_SEAT, 0)) {
        await this.formalize(session);
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
    if (totalCost(session).usd + step + reserve <= session.budgetUsd) return false;
    session.shortened = { rounds: completedRounds(session) };
    await this.persist(session);
    return true;
  }

  /** What the verdict should cost: its prompt as it stands, and the typical length of a verdict. */
  private verdictEstimate(session: Session): number {
    return this.promptEstimate(this.verdictPrompt(session), "verdict");
  }

  /** What an arbiter's call should cost: its prompt as it stands, and the typical length of its answer. */
  private promptEstimate(prompt: { system: string; messages: ChatMessage[] }, task: "verdict" | "reassess"): number {
    const chars = prompt.system.length + prompt.messages.reduce((sum, message) => sum + message.content.length, 0);
    const cost = costOf(this.providers.arbiter.model, {
      inputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
      outputTokens: TASK_PROFILE[task].output,
    });
    return cost ?? 0;
  }

  /** What was spent under the cap that applies: the revision's calls during a revision, the whole session otherwise. */
  private spent(session: Session): number {
    if (!this.scope) return totalCost(session).usd;
    const revision = this.scope.revision;
    return session.usage.reduce((sum, record) => sum + (record.revision === revision ? (record.costUsd ?? 0) : 0), 0);
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
            fence("solution", session.challenge ?? session.idea),
            "Restate this solution.",
          ].join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "proposal", round: 0, seat: USER_SEAT, data: proposal });
    await this.persist(session);
  }

  private async propose(session: Session, seat: string) {
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
      system: system + complianceRule(activeRequirements(session), "critique"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock(targets, computedCosts(session)),
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
      const spent = totalCost(session).usd;
      if (spent + this.verdictEstimate(session) > session.budgetUsd) throw new BudgetExceededError(spent, session.budgetUsd);
    }
    const requirements = activeRequirements(session);
    const prompt = this.verdictPrompt(session);
    // With compliance requirements, the arbiter also assesses every option against each of them.
    const verdict =
      requirements.length > 0
        ? await this.call(session, "verdict", null, this.providers.arbiter, prompt, COMPLIANCE_VERDICT)
        : await this.call(session, "verdict", null, this.providers.arbiter, prompt);
    settleVerdict(session, verdict);
    if ("compliance" in verdict) settleCompliance(verdict as VerdictWithCompliance, requirements);
    session.debate.push({ kind: "verdict", data: verdict });
    session.verdict = verdict;
    session.revisions = [firstRevision(verdict, new Date().toISOString())];
    session.phase = "complete";
    await this.persist(session);
  }

  private verdictPrompt(session: Session): { system: string; messages: ChatMessage[] } {
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
      system: arbiterSystem(session.locale, session.mode === "challenge") + complianceRule(activeRequirements(session), "arbiter"),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            profileBlock(sessionProfile(session)),
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session), computedCosts(session)),
            checksBlock(checkFacts(session)),
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
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.checkStopped();
      this.checkBudget(session);
      this.hooks.emit(session.id, { type: "speaking", task, seat });
      let raw = "";
      let shown = "";
      try {
        const result = await provider.generate(
          {
            task,
            seat,
            system: prompt.system,
            messages: session.redact
              ? prompt.messages.map((message) => (message.role === "user" ? { ...message, content: redact(message.content) } : message))
              : prompt.messages,
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
        session.usage.push({
          task,
          seat,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: result.costUsd ?? costOf(result.model, result.usage) ?? costOf(provider.model, result.usage),
          ...(this.scope ? { revision: this.scope.revision } : {}),
        });
        const parsed = spec.zod.safeParse(JSON.parse(result.text));
        if (!parsed.success) throw new ProviderError(`The ${task} answer does not match its schema.`, true);
        this.hooks.emit(session.id, { type: "spoke", task, seat });
        return parsed.data as z.infer<(typeof SCHEMAS)[K]["zod"]>;
      } catch (error) {
        // Whatever the provider made of the cancellation, the person stopped the call.
        this.checkStopped();
        lastError = error;
        const retryable = error instanceof SyntaxError || (error instanceof ProviderError && error.retryable);
        if (!retryable) break;
      }
    }
    if (lastError instanceof Object) failedCalls.set(lastError, { provider: provider.kind, model: provider.model });
    throw lastError;
  }

  private stopped() {
    return new StoppedError(this.signal?.reason === INTERRUPTED ? "interrupted" : "stopped");
  }

  private checkStopped() {
    if (this.signal?.aborted) throw this.stopped();
  }

  private checkBudget(session: Session) {
    const cap = this.scope ? this.scope.budgetUsd : session.budgetUsd;
    if (cap === null) return;
    const spent = this.spent(session);
    if (spent >= cap) throw new BudgetExceededError(spent, cap);
  }

  private async persist(session: Session) {
    session.updatedAt = new Date().toISOString();
    await this.hooks.save(session);
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

// The verdict's estimate is kept with this margin while the rounds run: what the arbiter reads still grows.
const VERDICT_MARGIN = 1.25;
// A rough count, enough for an estimate: about four characters of English or JSON per token.
const CHARS_PER_TOKEN = 4;

/** What one more call of a task by this model should cost: its last such call, or the typical one. */
function callEstimate(session: Session, task: Task, model: string): number {
  const last = session.usage.findLast((record) => record.task === task && record.model === model && record.costUsd !== null);
  if (last?.costUsd != null) return last.costUsd;
  return (task in TASK_PROFILE ? typicalCallCost(model, task as keyof typeof TASK_PROFILE) : null) ?? 0;
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

/** The build cost of each option as Quorumind priced it, for the models that read the proposals. */
function computedCosts(session: Session): Record<string, ComputedCost> {
  return Object.fromEntries(
    Object.entries(sessionCostings(session)).map(([seat, costing]) => [
      seat,
      { currency: costing.currency, low: costing.total.low, high: costing.total.high, personDays: costing.days },
    ]),
  );
}

/** Keeps a ruling to the options of the debate: unknown seats dropped, scores within 1 to 5. */
function settleVerdict(session: Session, verdict: Verdict) {
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
  return complianceRule(activeRequirements(session), "design") + priceReferenceRule();
}

function requireSheet(session: Session) {
  if (!session.sheet) throw new InvalidStateError("The requirements sheet is missing.");
  return session.sheet;
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
