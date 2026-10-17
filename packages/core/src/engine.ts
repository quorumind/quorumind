import type { z } from "zod";
import { partialStringField } from "./partial-json.ts";
import { costOf } from "./pricing.ts";
import {
  answersBlock,
  arbiterSystem,
  criticSystem,
  interviewerSystem,
  proposalsBlock,
  proposerSystem,
  requirementsBlock,
  reviserSystem,
} from "./prompts.ts";
import { type ChatMessage, type LlmProvider, ProviderError, type Task } from "./providers/types.ts";
import { CritiqueRound, clampScore, InterviewTurn, Proposal, RequirementsSheet, Revision, toStrictJsonSchema, Verdict } from "./schemas.ts";
import { type Answer, allAnswers, currentProposals, type Session, totalCost } from "./session.ts";

/** After this many answered turns the interviewer must produce the requirements sheet. */
export const MAX_INTERVIEW_TURNS = 4;
const MAX_QUESTIONS_PER_ROUND = 3;

export interface ProviderSet {
  interviewer: LlmProvider;
  arbiter: LlmProvider;
  proposers: Record<string, LlmProvider>;
}

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
  constructor(spentUsd: number, budgetUsd: number) {
    super(`The cost cap of $${budgetUsd.toFixed(2)} is reached ($${spentUsd.toFixed(2)} spent).`);
    this.name = "BudgetExceededError";
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

const SCHEMAS = {
  interview: { zod: InterviewTurn, json: toStrictJsonSchema(InterviewTurn), name: "interview_turn", maxTokens: 8_000 },
  proposal: { zod: Proposal, json: toStrictJsonSchema(Proposal), name: "proposal", maxTokens: 12_000 },
  critique: { zod: CritiqueRound, json: toStrictJsonSchema(CritiqueRound), name: "critique_round", maxTokens: 10_000 },
  revision: { zod: Revision, json: toStrictJsonSchema(Revision), name: "revision", maxTokens: 14_000 },
  verdict: { zod: Verdict, json: toStrictJsonSchema(Verdict), name: "verdict", maxTokens: 20_000 },
} as const;

export class DebateEngine {
  private readonly providers: ProviderSet;
  private readonly hooks: EngineHooks;

  constructor(providers: ProviderSet, hooks: EngineHooks) {
    this.providers = providers;
    this.hooks = hooks;
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
        await this.debateStep(session);
      }
    });
  }

  private async interviewStep(session: Session) {
    const messages: ChatMessage[] = [{ role: "user", content: `Project idea:\n<answers>\n${session.idea}\n</answers>` }];
    for (const entry of session.interview) {
      if (entry.kind === "interviewer") messages.push({ role: "assistant", content: JSON.stringify(entry.data) });
      else messages.push({ role: "user", content: answersBlock(entry.answers) });
    }
    const userTurns = session.interview.filter((entry) => entry.kind === "user").length;
    const turn = await this.call(session, "interview", null, this.providers.interviewer, {
      system: interviewerSystem(session.locale, userTurns >= MAX_INTERVIEW_TURNS),
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
    const seats = Object.keys(this.providers.proposers);
    const has = (kind: "proposal" | "critiques" | "revision", seat: string, round: number) =>
      session.debate.some((entry) => entry.kind === kind && entry.seat === seat && entry.round === round);

    const missingProposals = seats.filter((seat) => !has("proposal", seat, 0));
    if (missingProposals.length > 0) {
      await Promise.all(missingProposals.map((seat) => this.propose(session, seat)));
      return;
    }

    for (let round = 1; round <= session.rounds; round++) {
      const missingCritiques = seats.filter((seat) => !has("critiques", seat, round));
      if (missingCritiques.length > 0) {
        const proposals = currentProposals(session);
        await Promise.all(missingCritiques.map((seat) => this.criticise(session, seat, round, proposals)));
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
      const missingRevisions = seats.filter((seat) => !has("revision", seat, round));
      if (missingRevisions.length > 0) {
        await Promise.all(missingRevisions.map((seat) => this.revise(session, seat, round)));
        return;
      }
    }

    await this.judge(session);
  }

  private async propose(session: Session, seat: string) {
    const sheet = requireSheet(session);
    const proposal = await this.call(session, "proposal", seat, this.proposer(seat), {
      system: proposerSystem(session.locale, seat),
      messages: [{ role: "user", content: `${requirementsBlock(sheet)}\n\nDesign your solution.` }],
    });
    session.debate.push({ kind: "proposal", round: 0, seat, data: proposal });
    await this.persist(session);
  }

  private async criticise(session: Session, seat: string, round: number, proposals: Record<string, Proposal>) {
    const sheet = requireSheet(session);
    const others = Object.fromEntries(Object.entries(proposals).filter(([other]) => other !== seat));
    const critiques = await this.call(session, "critique", seat, this.proposer(seat), {
      system: criticSystem(session.locale, seat),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock(others),
            `Criticise these proposals. Valid targets: ${Object.keys(others).join(", ")}.`,
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
      system: reviserSystem(session.locale, seat),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock({ [seat]: own }),
            `<debate>\n${JSON.stringify(received, null, 2)}\n</debate>`,
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
    const verdict = await this.call(session, "verdict", null, this.providers.arbiter, {
      system: arbiterSystem(session.locale),
      messages: [
        {
          role: "user",
          content: [
            requirementsBlock(sheet),
            answersBlock(allAnswers(session)),
            proposalsBlock(currentProposals(session)),
            `<debate>\n${JSON.stringify(transcript, null, 2)}\n</debate>`,
            "Rule on these options.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    for (const option of verdict.options) {
      for (const score of option.scores) score.score = clampScore(score.score);
    }
    session.debate.push({ kind: "verdict", data: verdict });
    session.verdict = verdict;
    session.phase = "complete";
    await this.persist(session);
  }

  private proposer(seat: string): LlmProvider {
    const provider = this.providers.proposers[seat];
    if (!provider) throw new InvalidStateError(`No model is assigned to seat ${seat}.`);
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
            messages: prompt.messages,
            schema: spec.json,
            schemaName: spec.name,
            maxTokens: spec.maxTokens,
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
          costUsd: costOf(result.model, result.usage) ?? costOf(provider.model, result.usage),
        });
        const parsed = spec.zod.safeParse(JSON.parse(result.text));
        if (!parsed.success) throw new ProviderError(`The ${task} answer does not match its schema.`, true);
        this.hooks.emit(session.id, { type: "spoke", task, seat });
        return parsed.data as z.infer<(typeof SCHEMAS)[K]["zod"]>;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof SyntaxError || (error instanceof ProviderError && error.retryable);
        if (!retryable) break;
      }
    }
    throw lastError;
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
      session.error = {
        code:
          error instanceof BudgetExceededError ? "budget_exceeded" : error instanceof ProviderError ? "provider_error" : "internal_error",
        message: error instanceof Error ? error.message : String(error),
      };
      await this.persist(session);
    }
  }
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
