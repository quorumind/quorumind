import type { IncomingMessage } from "node:http";
import {
  type Branding,
  currentRevision,
  type PublicQuestionnaire,
  QUESTIONNAIRE_DAYS,
  QUESTIONNAIRE_LIMITS,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
  questionnaireInputs,
  questionsFromVerdict,
  reportSlug,
  type Session,
} from "@quorumind/core";
import { renderQuestionnaireDocx } from "@quorumind/core/docx";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { User } from "./app.ts";
import type { BrandingStore } from "./branding.ts";
import { AttemptLimiter, type AttemptLimits, accessToken, hashPassword, PasswordAttempts, SHARE_PASSWORD, validAccess } from "./share.ts";
import { publicQuestionnaire, randomToken, type SessionStore, type StoredQuestionnaire, type StoredSession } from "./store.ts";

// The questionnaire an agency sends its client from a completed session. The agency writes it from the verdict's open
// questions, sends its link, reads the answers and makes a revision of the verdict from them. The client opens the
// link without an account: it expires, can ask for a password like a share link, accepts one submission until the
// agency reopens it, and is rate limited.

type Env = { Variables: { user: User | null } };

/** Requests through questionnaire links, per caller; submissions per caller and per link. */
export const QUESTIONNAIRE_RATE_LIMITS = {
  reads: { perWindow: 120, windowMs: 15 * 60_000 },
  submissions: { perWindow: 10, windowMs: 15 * 60_000 },
} as const satisfies Record<string, AttemptLimits>;

/** How long a link may work: a week, or the default 30 days. */
export const QUESTIONNAIRE_EXPIRIES = { "7d": 7, "30d": QUESTIONNAIRE_DAYS } as const;

export interface QuestionnaireDeps {
  store: SessionStore;
  branding: BrandingStore;
  /** A session the caller may read, or a 404. */
  readable(id: string, user: User | null): Promise<Session>;
  /** A session the caller may change, with its placement, or a 403/404. */
  editable(id: string, user: User | null): Promise<StoredSession>;
  /** Starts a revision of the verdict from the answers; `onMade` runs once the new verdict exists. */
  revise(
    session: Session,
    request: { inputs: ReturnType<typeof questionnaireInputs> },
    onMade: (number: number) => Promise<void>,
  ): Promise<{ number: number }>;
  /** Tells the agency the client answered (e-mail, host hook); its failure is logged, never the client's problem. */
  answered(found: StoredSession, questionnaire: StoredQuestionnaire): Promise<void>;
}

const Question = z.object({
  id: z.string().trim().min(1).max(40).optional(),
  text: z.string().trim().min(1).max(QUESTIONNAIRE_LIMITS.question),
  why: z
    .string()
    .trim()
    .max(QUESTIONNAIRE_LIMITS.why)
    .nullable()
    .default(null)
    .transform((value) => value || null),
  origin: z.enum(["open_question", "agency"]).default("agency"),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

const Settings = z.object({
  questions: z.array(Question).min(1).max(QUESTIONNAIRE_LIMITS.questions).optional(),
  client: optionalText(QUESTIONNAIRE_LIMITS.client).optional(),
  message: optionalText(QUESTIONNAIRE_LIMITS.message).optional(),
  /** A new password, or null to remove it. */
  password: z.string().min(SHARE_PASSWORD.min).max(SHARE_PASSWORD.max).nullable().optional(),
  expiresIn: z.enum(["7d", "30d"]).optional(),
});

const Answers = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().max(40),
        answer: z.string().trim().max(QUESTIONNAIRE_LIMITS.answer),
        comment: optionalText(QUESTIONNAIRE_LIMITS.comment).default(null),
      }),
    )
    .max(QUESTIONNAIRE_LIMITS.questions),
});

const AccessInput = z.object({ password: z.string().max(SHARE_PASSWORD.max) });

/** Questions with stable, unique ids: those given are kept, the others numbered after them. */
function withIds(questions: z.infer<typeof Question>[]): QuestionnaireQuestion[] {
  const used = new Set<string>();
  const fresh = () => {
    let n = used.size + 1;
    while (used.has(`q${n}`)) n++;
    return `q${n}`;
  };
  return questions.map((question) => {
    const id = question.id && !used.has(question.id) ? question.id : fresh();
    used.add(id);
    return { id, text: question.text, why: question.why, origin: question.origin };
  });
}

/** Answers to questions of the questionnaire only, one per question. */
function keptAnswers(questions: QuestionnaireQuestion[], answers: QuestionnaireAnswer[]): QuestionnaireAnswer[] {
  return questions.flatMap((question) => {
    const answer = answers.findLast((item) => item.questionId === question.id);
    return answer ? [{ questionId: question.id, answer: answer.answer, comment: answer.comment ?? null }] : [];
  });
}

const expiry = (days: number, now = Date.now()) => new Date(now + days * 86_400_000).toISOString();
const expired = (questionnaire: StoredQuestionnaire, now = Date.now()) => Date.parse(questionnaire.expiresAt) <= now;

export function questionnaireRoutes(deps: QuestionnaireDeps) {
  const app = new Hono<Env>();
  const limits = {
    reads: new AttemptLimiter(QUESTIONNAIRE_RATE_LIMITS.reads),
    submissions: new AttemptLimiter(QUESTIONNAIRE_RATE_LIMITS.submissions),
  };
  const passwords = new PasswordAttempts();
  const callerOf = (c: Context<Env>) => (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress ?? "local";
  const refuse = (c: Context<Env>, status: 401 | 404 | 409 | 410 | 429, error: string, message: string) =>
    c.json({ error, message }, status);

  /** A questionnaire of a session the caller may change. */
  const owned = async (c: Context<Env>) => {
    const found = await deps.editable(c.req.param("id") ?? "", c.get("user"));
    const questionnaire = await deps.store.questionnaire({ id: c.req.param("qid") ?? "" });
    return { found, questionnaire: questionnaire?.sessionId === found.session.id ? questionnaire : null };
  };
  const missing = (c: Context<Env>) => refuse(c, 404, "not_found", "This questionnaire does not exist.");

  /** What the client sees: the questions with the project's name, in the session's language. */
  const clientView = (session: Session, questionnaire: StoredQuestionnaire): PublicQuestionnaire => ({
    locale: session.locale,
    project: session.sheet?.projectName ?? "",
    client: questionnaire.client,
    message: questionnaire.message,
    questions: questionnaire.questions,
    answers: questionnaire.answers,
    status: questionnaire.status,
    submittedAt: questionnaire.submittedAt,
    expiresAt: questionnaire.expiresAt,
  });

  const word = async (c: Context<Env>, session: Session, questionnaire: StoredQuestionnaire, branding: Branding) => {
    const origin = new URL(c.req.url).origin;
    const document = await renderQuestionnaireDocx(clientView(session, questionnaire), branding, {
      url: `${origin}/#/q/${questionnaire.token}`,
    });
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    c.header("Content-Disposition", `attachment; filename="${reportSlug(session)}-questionnaire.docx"`);
    c.header("Cache-Control", "no-store");
    return c.body(document as Uint8Array<ArrayBuffer>);
  };

  // The agency's side: write, send, follow and use the questionnaires of a session.

  app.get("/api/sessions/:id/questionnaires", async (c) => {
    const session = await deps.readable(c.req.param("id"), c.get("user"));
    return c.json({ questionnaires: (await deps.store.questionnairesOf(session.id)).map(publicQuestionnaire) });
  });

  // A new questionnaire: the verdict's open questions unless others are given, for 30 days unless said otherwise.
  app.post("/api/sessions/:id/questionnaires", async (c) => {
    const { session } = await deps.editable(c.req.param("id"), c.get("user"));
    const input = Settings.parse(await c.req.json());
    if (session.phase !== "complete" || !session.verdict) return refuse(c, 409, "wrong_phase", "The verdict is not ready yet.");
    const questions = input.questions ? withIds(input.questions) : questionsFromVerdict(session.verdict);
    if (questions.length === 0) return refuse(c, 409, "no_questions", "Add at least one question.");
    const now = new Date().toISOString();
    const questionnaire: StoredQuestionnaire = {
      id: globalThis.crypto.randomUUID(),
      sessionId: session.id,
      token: randomToken(),
      createdAt: now,
      updatedAt: now,
      expiresAt: expiry(QUESTIONNAIRE_EXPIRIES[input.expiresIn ?? "30d"]),
      passwordHash: input.password ? await hashPassword(input.password) : null,
      client: input.client ?? null,
      message: input.message ?? null,
      questions,
      answers: [],
      status: "open",
      submittedAt: null,
      submittedBy: null,
      revision: currentRevision(session)?.number ?? 1,
      appliedRevision: null,
    };
    await deps.store.saveQuestionnaire(questionnaire);
    return c.json({ questionnaire: publicQuestionnaire(questionnaire) }, 201);
  });

  // Changes a questionnaire: a field left out keeps its value. Its questions change only while it is open.
  app.patch("/api/sessions/:id/questionnaires/:qid", async (c) => {
    const { questionnaire } = await owned(c);
    if (!questionnaire) return missing(c);
    const input = Settings.parse(await c.req.json());
    if (input.questions && questionnaire.status !== "open") {
      return refuse(c, 409, "already_submitted", "The client has already answered: reopen the questionnaire to change its questions.");
    }
    const questions = input.questions ? withIds(input.questions) : questionnaire.questions;
    const next: StoredQuestionnaire = {
      ...questionnaire,
      questions,
      answers: keptAnswers(questions, questionnaire.answers),
      client: input.client === undefined ? questionnaire.client : input.client,
      message: input.message === undefined ? questionnaire.message : input.message,
      passwordHash:
        input.password === undefined ? questionnaire.passwordHash : input.password === null ? null : await hashPassword(input.password),
      expiresAt: input.expiresIn ? expiry(QUESTIONNAIRE_EXPIRIES[input.expiresIn]) : questionnaire.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    await deps.store.saveQuestionnaire(next);
    return c.json({ questionnaire: publicQuestionnaire(next) });
  });

  // Lets the client answer again, with the answers given so far; an expired link works for another 30 days.
  app.post("/api/sessions/:id/questionnaires/:qid/reopen", async (c) => {
    const { questionnaire } = await owned(c);
    if (!questionnaire) return missing(c);
    const next: StoredQuestionnaire = {
      ...questionnaire,
      status: "open",
      expiresAt: expired(questionnaire) ? expiry(QUESTIONNAIRE_DAYS) : questionnaire.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    await deps.store.saveQuestionnaire(next);
    return c.json({ questionnaire: publicQuestionnaire(next) });
  });

  // The answers a client sent another way (by e-mail, on the Word version), recorded by the agency.
  app.put("/api/sessions/:id/questionnaires/:qid/answers", async (c) => {
    const { questionnaire } = await owned(c);
    if (!questionnaire) return missing(c);
    const { answers } = Answers.parse(await c.req.json());
    const now = new Date().toISOString();
    const next: StoredQuestionnaire = {
      ...questionnaire,
      answers: keptAnswers(questionnaire.questions, answers),
      status: "submitted",
      submittedAt: now,
      submittedBy: "agency",
      appliedRevision: null,
      updatedAt: now,
    };
    await deps.store.saveQuestionnaire(next);
    return c.json({ questionnaire: publicQuestionnaire(next) });
  });

  // "Update the recommendation": a revision of the verdict from the answers, without a new debate.
  app.post("/api/sessions/:id/questionnaires/:qid/revision", async (c) => {
    const { found, questionnaire } = await owned(c);
    if (!questionnaire) return missing(c);
    if (questionnaire.status !== "submitted") return refuse(c, 409, "not_submitted", "The client has not answered yet.");
    const inputs = questionnaireInputs(questionnaire);
    if (inputs.facts.length === 0) return refuse(c, 409, "no_answers", "None of the questions has an answer.");
    const { number } = await deps.revise(found.session, { inputs }, async (made) => {
      const latest = await deps.store.questionnaire({ id: questionnaire.id });
      if (latest) await deps.store.saveQuestionnaire({ ...latest, appliedRevision: made, updatedAt: new Date().toISOString() });
    });
    return c.json({ accepted: true, revision: number }, 202);
  });

  app.delete("/api/sessions/:id/questionnaires/:qid", async (c) => {
    const { questionnaire } = await owned(c);
    if (!questionnaire) return missing(c);
    await deps.store.deleteQuestionnaire(questionnaire.id);
    return c.body(null, 204);
  });

  app.get("/api/sessions/:id/questionnaires/:qid/questionnaire.docx", async (c) => {
    const session = await deps.readable(c.req.param("id"), c.get("user"));
    const questionnaire = await deps.store.questionnaire({ id: c.req.param("qid") });
    if (questionnaire?.sessionId !== session.id) return missing(c);
    const found = await deps.store.find(session.id);
    return word(c, session, questionnaire, await deps.branding.get(found?.owner ?? null));
  });

  // The client's side, through the link: no account, the token is the permission.

  /** The questionnaire behind a link, when it still works and the visitor may open it. */
  const openLink = async (c: Context<Env>) => {
    if (!limits.reads.hit(callerOf(c)))
      return { refused: refuse(c, 429, "rate_limited", "Too many requests. Try again in a few minutes.") };
    const questionnaire = await deps.store.questionnaire({ token: c.req.param("token") ?? "" });
    const found = questionnaire ? await deps.store.find(questionnaire.sessionId) : null;
    if (!questionnaire || !found) return { refused: missing(c) };
    if (expired(questionnaire)) return { refused: refuse(c, 410, "questionnaire_expired", "This questionnaire link has expired.") };
    if (questionnaire.passwordHash !== null) {
      const access = c.req.header("x-questionnaire-access") ?? c.req.query("access");
      if (!validAccess(access, questionnaire.token, questionnaire.passwordHash)) {
        return { refused: refuse(c, 401, "password_required", "This questionnaire is protected by a password.") };
      }
    }
    return { questionnaire, found };
  };

  // Everything the page needs: the questions, the answers given so far, and the agency's branding.
  app.get("/api/questionnaire/:token", async (c) => {
    const opened = await openLink(c);
    if ("refused" in opened) return opened.refused;
    const { questionnaire, found } = opened;
    return c.json({ questionnaire: clientView(found.session, questionnaire), branding: await deps.branding.get(found.owner) });
  });

  app.get("/api/questionnaire/:token/questionnaire.docx", async (c) => {
    const opened = await openLink(c);
    if ("refused" in opened) return opened.refused;
    return word(c, opened.found.session, opened.questionnaire, await deps.branding.get(opened.found.owner));
  });

  // The password of a protected link, for an access token valid a few hours. Attempts are counted per link and caller,
  // before the password is checked.
  app.post("/api/questionnaire/:token/access", async (c) => {
    const token = c.req.param("token");
    const questionnaire = await deps.store.questionnaire({ token });
    if (!questionnaire) return missing(c);
    if (expired(questionnaire)) return refuse(c, 410, "questionnaire_expired", "This questionnaire link has expired.");
    if (questionnaire.passwordHash === null) return c.json({ access: null, expiresAt: null });
    const { password } = AccessInput.parse(await c.req.json());
    const checked = await passwords.check(token, callerOf(c), password, questionnaire.passwordHash);
    if (checked === "limited") return refuse(c, 429, "too_many_attempts", "Too many wrong passwords. Wait a few minutes and try again.");
    if (checked === "wrong") return refuse(c, 401, "wrong_password", "The password is not right.");
    return c.json(accessToken(questionnaire.token, questionnaire.passwordHash));
  });

  // The client's answers, once: a second submission is refused until the agency reopens the questionnaire.
  app.post("/api/questionnaire/:token/answers", async (c) => {
    const opened = await openLink(c);
    if ("refused" in opened) return opened.refused;
    const { questionnaire, found } = opened;
    if (!limits.submissions.hit(callerOf(c)) || !limits.submissions.hit(`link:${questionnaire.id}`)) {
      return refuse(c, 429, "rate_limited", "Too many requests. Try again in a few minutes.");
    }
    if (questionnaire.status !== "open") return refuse(c, 409, "already_submitted", "These answers have already been sent.");
    const { answers } = Answers.parse(await c.req.json());
    const submission = {
      answers: keptAnswers(questionnaire.questions, answers),
      submittedAt: new Date().toISOString(),
      submittedBy: "client" as const,
    };
    if (!(await deps.store.submitQuestionnaire(questionnaire.id, submission))) {
      return refuse(c, 409, "already_submitted", "These answers have already been sent.");
    }
    const submitted: StoredQuestionnaire = { ...questionnaire, ...submission, status: "submitted", appliedRevision: null };
    try {
      await deps.answered(found, submitted);
    } catch (error) {
      console.error(`Telling the agency about the answers to questionnaire ${questionnaire.id} failed:`, error);
    }
    return c.json({ questionnaire: clientView(found.session, submitted) });
  });

  return app;
}
