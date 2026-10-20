import type { InterviewQuestion, InterviewTurn, Session } from "@quorumind/core";
import { type FormEvent, type KeyboardEvent, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessContext, authorName } from "./access.tsx";
import { api } from "./api.ts";
import { ArrowIcon } from "./components/Icons.tsx";
import { failureText } from "./errors.ts";
import { type LiveSpeech, speechKey } from "./useSession.ts";

function InterviewerMessage({ text, typing }: { text: string; typing?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="message voice-interviewer">
      <div className="message-head">
        <span className="voice-dot" />
        <span className="label">{t("role.interviewer")}</span>
        {typing ? <span className="muted">{t("debate.writing")}</span> : null}
      </div>
      <div className="bubble">
        <p className={`speech${typing ? " typing" : ""}`}>{text}</p>
      </div>
    </div>
  );
}

/** The longest answer the server takes (AnswerList in the server's app.ts). */
const MAX_ANSWER = 4_000;

/** An answer built from example chips: the picked examples, one per line, so that an example may hold any punctuation. */
const PICK_SEPARATOR = "\n";

function picked(answer: string) {
  return answer
    .split(PICK_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The examples offered as chips: on one line each, without "I don't know", which has a chip of its own. */
function chipExamples(question: InterviewQuestion, unknown: string) {
  const examples = question.examples.map((example) => example.replace(/\s+/g, " ").trim());
  return [...new Set(examples.filter((example) => example && example !== unknown))];
}

/**
 * Picking an example adds it to the answer, picking it again removes it. Unless the examples combine, it replaces the
 * example picked before, as a click did before questions said whether they combine. What the person wrote always stays,
 * and an answer never grows past what the server takes.
 */
function togglePick(answer: string, example: string, examples: string[], multiple: boolean, unknown: string) {
  const parts = picked(answer).filter((part) => part !== unknown);
  if (parts.includes(example)) return parts.filter((part) => part !== example).join(PICK_SEPARATOR);
  const kept = multiple ? parts : parts.filter((part) => !examples.includes(part));
  const next = [...kept, example].join(PICK_SEPARATOR);
  return next.length > MAX_ANSWER ? answer : next;
}

/** A topic is named once, above the first of the questions or answers that share it: the topic to show at each place. */
function topicStarts(topics: (string | undefined)[]) {
  return topics.map((topic, index) => {
    const name = topic?.trim();
    return name && name !== topics[index - 1]?.trim() ? name : null;
  });
}

/**
 * The answers being written, kept in the browser until they are sent: a reload or a lost connection keeps them, and
 * what "I don't know" replaced as well. One per session, for its current turn.
 */
const DRAFT_KEY = "quorumind.interviewDraft.";

interface Draft {
  answers: Record<string, string>;
  beforeUnknown: Record<string, string>;
}

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

function readDraft(sessionId: string, turn: number): Draft {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY + sessionId) ?? "null") as Record<string, unknown> | null;
    if (draft?.turn === turn) return { answers: strings(draft.answers), beforeUnknown: strings(draft.beforeUnknown) };
  } catch {
    // An unreadable draft is no draft.
  }
  return { answers: {}, beforeUnknown: {} };
}

function writeDraft(sessionId: string, turn: number, draft: Draft | null) {
  try {
    if (draft && Object.values(draft.answers).some((answer) => answer.trim())) {
      localStorage.setItem(DRAFT_KEY + sessionId, JSON.stringify({ turn, ...draft }));
    } else {
      localStorage.removeItem(DRAFT_KEY + sessionId);
    }
  } catch {
    // Without storage, the answers live as long as the page.
  }
}

function QuestionsForm({ session, turn, turnIndex }: { session: Session; turn: InterviewTurn; turnIndex: number }) {
  const { t } = useTranslation();
  const [draft] = useState(() => readDraft(session.id, turnIndex));
  const [answers, setAnswers] = useState<Record<string, string>>(draft.answers);
  // What each answer was before "I don't know" replaced it, given back when it is picked again.
  const [beforeUnknown, setBeforeUnknown] = useState<Record<string, string>>(draft.beforeUnknown);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unknown = t("interview.unknown");
  const answered = turn.questions.filter((question) => answers[question.id]?.trim()).length;
  const topics = topicStarts(turn.questions.map((question) => question.topic));

  useEffect(() => writeDraft(session.id, turnIndex, { answers, beforeUnknown }), [session.id, turnIndex, answers, beforeUnknown]);

  const pick = (question: InterviewQuestion, example: string) => {
    const current = answers[question.id] ?? "";
    if (example !== unknown) {
      const examples = chipExamples(question, unknown);
      const multiple = question.multiple === true;
      setAnswers((all) => ({ ...all, [question.id]: togglePick(all[question.id] ?? "", example, examples, multiple, unknown) }));
    } else if (current.trim() === unknown) {
      setAnswers((all) => ({ ...all, [question.id]: beforeUnknown[question.id] ?? "" }));
    } else {
      setBeforeUnknown((all) => ({ ...all, [question.id]: current }));
      setAnswers((all) => ({ ...all, [question.id]: unknown }));
    }
  };

  // Ctrl+Enter (or Cmd+Enter) sends the answers from anywhere in the form.
  const sendOnShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || sending) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.answerInterview(
        session.id,
        turn.questions.map((question) => ({ question: question.text, answer: answers[question.id]?.trim() || unknown })),
      );
      writeDraft(session.id, turnIndex, null);
    } catch (caught) {
      setError(failureText(t, caught));
      setSending(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} onKeyDown={sendOnShortcut}>
      {turn.questions.map((question, index) => {
        const answer = answers[question.id] ?? "";
        const parts = picked(answer);
        const topic = topics[index];
        return (
          <div className={`question${topic ? " question-topic-start" : ""}`} key={question.id}>
            {topic ? <p className="question-topic">{topic}</p> : null}
            <div className="question-head">
              <span className={`question-number${answer.trim() ? " is-answered" : ""}`} aria-hidden="true">
                {index + 1}
              </span>
              <label className="question-text" htmlFor={`q-${question.id}`}>
                {question.text}
              </label>
            </div>
            {question.why ? (
              <p className="question-why" id={`q-${question.id}-why`}>
                {t("interview.why")} {question.why}
              </p>
            ) : null}
            <div className="chips">
              {[...chipExamples(question, unknown), unknown].map((example) => (
                <button
                  type="button"
                  className={`chip${example === unknown ? " chip-unknown" : ""}`}
                  key={example}
                  aria-pressed={example === unknown ? answer.trim() === unknown : parts.includes(example)}
                  onClick={() => pick(question, example)}
                >
                  {example}
                </button>
              ))}
              {question.multiple ? <span className="chips-hint">{t("interview.several")}</span> : null}
            </div>
            <textarea
              id={`q-${question.id}`}
              className="textarea"
              rows={2}
              maxLength={MAX_ANSWER}
              placeholder={t("interview.answerPlaceholder")}
              aria-describedby={question.why ? `q-${question.id}-why` : undefined}
              value={answer}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          </div>
        );
      })}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row questions-footer">
        <button type="submit" className="button button-primary" disabled={sending} aria-keyshortcuts="Control+Enter Meta+Enter">
          {sending ? t("interview.sending") : t("interview.send")}
          <ArrowIcon />
        </button>
        <p className="questions-progress" aria-live="polite">
          {t("interview.progress", { answered, total: turn.questions.length })}
          {answered < turn.questions.length ? ` · ${t("interview.blankHint")}` : null}
        </p>
        <p className="questions-shortcut">{t("interview.shortcut")}</p>
      </div>
    </form>
  );
}

/** The answers sent, under the topics of the questions they answer, as the form showed them. */
function SentAnswers({ answers, turn }: { answers: { question: string; answer: string }[]; turn: InterviewTurn | null }) {
  const topicOf = new Map(turn?.questions.map((question) => [question.text, question.topic]) ?? []);
  const topics = topicStarts(answers.map((answer) => topicOf.get(answer.question)));
  return answers.map((answer, index) => {
    const topic = topics[index];
    return (
      <div className="sent-answer" key={answer.question}>
        {topic ? <p className="question-topic">{topic}</p> : null}
        <p className="speech">
          <span className="muted">{answer.question}</span>
          <br />
          {answer.answer}
        </p>
      </div>
    );
  });
}

/** The interviewer's turn whose questions the answers at this place reply to. */
function askedBefore(session: Session, index: number): InterviewTurn | null {
  const entry = session.interview[index - 1];
  return entry?.kind === "interviewer" ? entry.data : null;
}

export function Interview({ session, live, readOnly = false }: { session: Session; live: LiveSpeech; readOnly?: boolean }) {
  const { t } = useTranslation();
  const access = useContext(AccessContext);
  // Someone else's session in a shared workspace: its author's name instead of "You"; on a share link, its author.
  const person = readOnly ? t("role.author") : access.mine ? t("role.you") : authorName(access.author, t);
  const canAnswer = access.canEdit && !readOnly;
  const streaming = live[speechKey("interview", null)];
  const last = session.interview.at(-1);
  const waitingForPerson = session.phase === "interview" && last?.kind === "interviewer" && last.data.status === "ask" && !streaming;

  // Once the interview is over, however it ended, nothing is left to send: its draft goes.
  useEffect(() => {
    if (session.phase !== "interview") writeDraft(session.id, 0, null);
  }, [session.id, session.phase]);

  return (
    <div className="narrow transcript">
      <div className="message voice-you">
        <div className="message-head">
          <span className="label">{person}</span>
        </div>
        <div className="bubble">
          <p className="speech">{session.idea}</p>
        </div>
      </div>

      {/* The interview only grows: an entry's place is its identity (question ids are the model's and can repeat). */}
      {session.interview.map((entry, index) =>
        entry.kind === "interviewer" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only entries.
          <div className="stack" key={`i-${index}`}>
            <InterviewerMessage text={entry.data.speech} />
            {entry === last && waitingForPerson && canAnswer ? (
              <QuestionsForm session={session} turn={entry.data} turnIndex={index} />
            ) : null}
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only entries.
          <div className="message voice-you" key={`u-${index}`}>
            <div className="message-head">
              <span className="label">{person}</span>
            </div>
            <div className="bubble">
              <SentAnswers answers={entry.answers} turn={askedBefore(session, index)} />
            </div>
          </div>
        ),
      )}

      {streaming ? (
        <InterviewerMessage text={streaming.text || t("interview.thinking")} typing />
      ) : session.phase === "interview" && (!last || last.kind === "user") ? (
        <InterviewerMessage text={t("interview.thinking")} typing />
      ) : null}
    </div>
  );
}
