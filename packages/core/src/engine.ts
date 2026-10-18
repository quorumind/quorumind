import type { z } from "zod";
import { partialStringField } from "./partial-json.ts";
import { costOf } from "./pricing.ts";
import { fence, redact } from "./privacy.ts";
import {
  answersBlock,
  arbiterSystem,
  briefSystem,
  CONTEXT_BUDGET,
  challengerSystem,
  contextBlock,
  criticSystem,
  devilSystem,
  formalizerSystem,
  interviewerSystem,
  probeSystem,
  proposalsBlock,
  proposerSystem,
  requirementsBlock,
  reviserSystem,
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
} from "./schemas.ts";
import {
  type Answer,
  allAnswers,
  criticSeats,
  currentProposals,
  DEVIL_SEAT,
  type DebateEntry,
  type Depth,
  proposerSeats,
  type Session,
  type SessionError,
  totalCost,
  USER_SEAT,
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

/** The person stopped the session: the work in flight was cancelled and can be resumed. */
export class StoppedError extends Error {
  readonly code = "stopped";
  constructor() {
    super("The session was stopped.");
    this.name = "StoppedError";
  }
}

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
  brief: { zod: Brief, json: toStrictJsonSchema(Brief), name: "brief", maxTokens: 8_000 },
} as const;

export class DebateEngine {
  private readonly providers: ProviderSet;
  private readonly hooks: EngineHooks;
  private readonly signal: AbortSignal | undefined;

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

  /** The person validates (and possibly edits) the requirements sheet; the debate can start. */
  async confirmSheet(session: Session, sheet: RequirementsSheet): Promise<void> {
    if (session.phase !== "review") throw new InvalidStateError("There is no requirements sheet to confirm.");
    session.sheet = RequirementsSheet.parse(sheet);
    session.sheetConfirmedAt = new Date().toISOString();
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
  async resume(session: Session): Promise<"interview" | "review" | "debate"> {
    if (session.phase !== "failed") throw new InvalidStateError("Only a failed session can be resumed.");
    session.error = null;
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
            proposalsBlock(currentProposals(session)),
            fence("debate", JSON.stringify({ verdict: stripSpeech(session.verdict) }, null, 2)),
            `Write the brief for this reader: ${audience}.`,
          ].join("\n\n"),
        },
      ],
    });
    session.briefs[audience] = brief;
    await this.persist(session);
  }

  private async interviewStep(session: Session) {
    const opening = [
      `Project idea:\n${fence("answers", session.idea)}`,
      session.challenge ? fence("solution", session.challenge) : "",
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
      system: interviewerSystem(session.locale, {
        forceDone: userTurns >= (express ? 1 : MAX_INTERVIEW_TURNS),
        express,
        template: session.template,
        challenge: session.mode === "challenge",
      }),
      messages,
    });
    session.interview.push({ kind: "interviewer", data: turn });
    if (turn.status === "done" && turn.sheet) {
      session.sheet = turn.sheet;
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

    for (let round = 1; round <= session.rounds; round++) {
      const missingCritiques = criticSeats(session).filter((seat) => !has("critiques", seat, round));
      if (missingCritiques.length > 0) {
        const proposals = currentProposals(session);
        await settleAll(missingCritiques.map((seat) => this.criticise(session, seat, round, proposals)));
        return;
      }
      if (shouldProbe(session, round)) {
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
        await settleAll(missingRevisions.map((seat) => this.revise(session, seat, round)));
        return;
      }
    }

    await this.judge(session);
  }

  private async formalize(session: Session) {
    const sheet = requireSheet(session);
    const proposal = await this.call(session, "proposal", USER_SEAT, this.providers.interviewer, {
      system: formalizerSystem(session.locale),
      messages: [
        {
          role: "user",
          content: [requirementsBlock(sheet), fence("solution", session.challenge ?? session.idea), "Restate this solution."].join("\n\n"),
        },
      ],
    });
    session.debate.push({ kind: "proposal", round: 0, seat: USER_SEAT, data: proposal });
    await this.persist(session);
  }

  private async propose(session: Session, seat: string) {
    const sheet = requireSheet(session);
    const proposal = await this.call(session, "proposal", seat, this.proposer(seat), {
      system: proposerSystem(session.locale, seat, session.seats[seat]?.persona ?? null),
      messages: [
        {
          role: "user",
          content: [requirementsBlock(sheet), contextBlock(session.context, CONTEXT_BUDGET.proposal), "Design your solution."]
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
      system,
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock(targets),
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
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session)),
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
      system: reviserSystem(session.locale, seat, session.seats[seat]?.persona ?? null),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock({ [seat]: own }),
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
    const challenge = session.mode === "challenge";
    const verdict = await this.call(session, "verdict", null, this.providers.arbiter, {
      system: arbiterSystem(session.locale, challenge),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session)),
            contextBlock(session.context, CONTEXT_BUDGET.verdict),
            fence("debate", JSON.stringify(transcript, null, 2)),
            "Rule on these options.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    const seats = new Set(Object.keys(currentProposals(session)));
    verdict.options = verdict.options.filter((option) => seats.has(option.seat));
    for (const option of verdict.options) {
      for (const score of option.scores) score.score = clampScore(score.score);
    }
    if (verdict.recommendation.seat !== null && !seats.has(verdict.recommendation.seat)) verdict.recommendation.seat = null;
    session.debate.push({ kind: "verdict", data: verdict });
    session.verdict = verdict;
    session.phase = "complete";
    await this.persist(session);
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
  ): Promise<z.infer<(typeof SCHEMAS)[K]["zod"]>> {
    const spec = SCHEMAS[task];
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

  private checkStopped() {
    if (this.signal?.aborted) throw new StoppedError();
  }

  private checkBudget(session: Session) {
    if (session.budgetUsd === null) return;
    const spent = totalCost(session).usd;
    if (spent >= session.budgetUsd) throw new BudgetExceededError(spent, session.budgetUsd);
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
      session.error = sessionError(this.signal?.aborted ? new StoppedError() : error);
      await this.persist(session);
    }
  }
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
