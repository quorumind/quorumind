import type { InterviewTurn, Session } from "@quorumind/core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { ArrowIcon } from "./components/Icons.tsx";
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

function QuestionsForm({ session, turn }: { session: Session; turn: InterviewTurn }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.answerInterview(
        session.id,
        turn.questions.map((question) => ({ question: question.text, answer: answers[question.id]?.trim() || t("interview.unknown") })),
      );
    } catch {
      setError(t("error.request"));
      setSending(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      {turn.questions.map((question) => (
        <div className="question" key={question.id}>
          <label className="question-text" htmlFor={`q-${question.id}`}>
            {question.text}
          </label>
          <p className="field-hint" style={{ margin: 0 }}>
            {t("interview.why")} {question.why}
          </p>
          <div className="chips">
            {[...question.examples, t("interview.unknown")].map((example) => (
              <button
                type="button"
                className="chip"
                key={example}
                onClick={() => setAnswers((current) => ({ ...current, [question.id]: example }))}
              >
                {example}
              </button>
            ))}
          </div>
          <textarea
            id={`q-${question.id}`}
            className="textarea"
            rows={2}
            maxLength={4000}
            placeholder={t("interview.answerPlaceholder")}
            value={answers[question.id] ?? ""}
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
          />
        </div>
      ))}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row" style={{ marginBlockStart: "var(--space-4)" }}>
        <button type="submit" className="button button-primary" disabled={sending}>
          {sending ? t("interview.sending") : t("interview.send")}
          <ArrowIcon />
        </button>
      </div>
    </form>
  );
}

export function Interview({ session, live }: { session: Session; live: LiveSpeech }) {
  const { t } = useTranslation();
  const streaming = live[speechKey("interview", null)];
  const last = session.interview.at(-1);
  const waitingForPerson = session.phase === "interview" && last?.kind === "interviewer" && last.data.status === "ask" && !streaming;

  return (
    <div className="narrow transcript">
      <div className="message voice-you">
        <div className="message-head">
          <span className="label">{t("role.you")}</span>
        </div>
        <div className="bubble">
          <p className="speech">{session.idea}</p>
        </div>
      </div>

      {session.interview.map((entry) =>
        entry.kind === "interviewer" ? (
          <div className="stack" key={`i-${entry.data.status}-${entry.data.questions.map((question) => question.id).join(",")}`}>
            <InterviewerMessage text={entry.data.speech} />
            {entry === last && waitingForPerson ? <QuestionsForm session={session} turn={entry.data} /> : null}
          </div>
        ) : (
          <div className="message voice-you" key={`u-${entry.answers.map((answer) => answer.question).join("|")}`}>
            <div className="message-head">
              <span className="label">{t("role.you")}</span>
            </div>
            <div className="bubble">
              {entry.answers.map((answer) => (
                <p className="speech" key={answer.question}>
                  <span className="muted">{answer.question}</span>
                  <br />
                  {answer.answer}
                </p>
              ))}
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
