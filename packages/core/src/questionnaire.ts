import type { Locale } from "./locales.ts";
import type { Verdict } from "./schemas.ts";
import type { RevisionFact, RevisionInputs } from "./session.ts";

// The questionnaire an agency sends its client from a completed session: the verdict's open questions, edited or
// completed by the agency, answered through a link that needs no account, then turned into a revision of the verdict.
// Browser-safe: the interface validates with the same limits.

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  /** Why the agency asks, shown to the client; null when it gives no reason. */
  why: string | null;
  /** One of the verdict's open questions, or a question the agency added. */
  origin: "open_question" | "agency";
}

export interface QuestionnaireAnswer {
  questionId: string;
  answer: string;
  comment: string | null;
}

/** open: the client can answer. submitted: the answers are in; the agency can reopen it. */
export type QuestionnaireStatus = "open" | "submitted";

export interface Questionnaire {
  id: string;
  sessionId: string;
  /** The secret of its link. */
  token: string;
  createdAt: string;
  updatedAt: string;
  /** When the link stops working. */
  expiresAt: string;
  hasPassword: boolean;
  /** Who it is addressed to, as the agency names them. */
  client: string | null;
  /** The agency's own words above the questions. */
  message: string | null;
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswer[];
  status: QuestionnaireStatus;
  submittedAt: string | null;
  /** The client through the link, or the agency recording answers the client sent another way. */
  submittedBy: "client" | "agency" | null;
  /** The revision of the verdict its questions come from. */
  revision: number;
  /** The revision made from its answers, once the agency asked for it. */
  appliedRevision: number | null;
}

/** What the client sees through the link: the questions, never the session. */
export interface PublicQuestionnaire {
  locale: Locale;
  /** The project's name. */
  project: string;
  client: string | null;
  message: string | null;
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswer[];
  status: QuestionnaireStatus;
  submittedAt: string | null;
  expiresAt: string;
}

export const QUESTIONNAIRE_LIMITS = {
  questions: 20,
  question: 1_000,
  why: 500,
  answer: 4_000,
  comment: 2_000,
  client: 120,
  message: 2_000,
} as const;

/** How long a questionnaire link works, in days. */
export const QUESTIONNAIRE_DAYS = 30;

/** The verdict's open questions, as the first draft of a questionnaire. */
export function questionsFromVerdict(verdict: Verdict): QuestionnaireQuestion[] {
  return verdict.openQuestions
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, QUESTIONNAIRE_LIMITS.questions)
    .map((text, index) => ({
      id: `q${index + 1}`,
      text: text.slice(0, QUESTIONNAIRE_LIMITS.question),
      why: null,
      origin: "open_question",
    }));
}

/** The answers of a questionnaire as the facts of a verdict revision: each question with its answer, in order. */
export function questionnaireFacts(questionnaire: Pick<Questionnaire, "questions" | "answers">): RevisionFact[] {
  return questionnaire.questions.flatMap((question) => {
    const answer = questionnaire.answers.find((item) => item.questionId === question.id);
    const text = answer?.answer.trim() ?? "";
    const comment = answer?.comment?.trim() || null;
    return text || comment ? [{ question: question.text, answer: text, comment }] : [];
  });
}

/** What a revision from a questionnaire's answers is made from. */
export function questionnaireInputs(questionnaire: Pick<Questionnaire, "id" | "questions" | "answers">): RevisionInputs {
  return { facts: questionnaireFacts(questionnaire), note: null, questionnaireId: questionnaire.id };
}
