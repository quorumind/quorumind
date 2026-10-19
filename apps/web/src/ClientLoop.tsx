import type { Session } from "@quorumind/core";
import { QUESTIONNAIRE_LIMITS } from "@quorumind/core/questionnaire";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PriceQuote, type Questionnaire, type QuestionnaireSettings } from "./api.ts";
import { CopyField } from "./components/CopyField.tsx";
import { DownloadIcon, PlusIcon, TrashIcon } from "./components/Icons.tsx";
import { failureText } from "./errors.ts";
import { NewFacts, UpdateLabel } from "./Revisions.tsx";

// The agency's side of the loop with its client: the questionnaire made from the verdict's open questions, its link,
// the answers, and the revision of the verdict made from them.

type Draft = { id?: string; text: string; why: string; origin: "open_question" | "agency" };

const PASSWORD_MIN = 4;
const linkOf = (token: string) => `${window.location.origin}${window.location.pathname}#/q/${token}`;
const dateOf = (iso: string, language: string) => new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(new Date(iso));

/** The questions, the client's name, the message, how long the link works and its password. */
function QuestionnaireEditor({
  initial,
  questionnaire,
  pending,
  onSave,
  onCancel,
}: {
  initial: Draft[];
  questionnaire: Questionnaire | null;
  pending: boolean;
  onSave: (settings: QuestionnaireSettings) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [questions, setQuestions] = useState<Draft[]>(initial.length > 0 ? initial : [{ text: "", why: "", origin: "agency" }]);
  const [client, setClient] = useState(questionnaire?.client ?? "");
  const [message, setMessage] = useState(questionnaire?.message ?? "");
  const [expiresIn, setExpiresIn] = useState<"7d" | "30d">("30d");
  const [password, setPassword] = useState("");
  const filled = questions.filter((question) => question.text.trim());
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const update = (index: number, change: Partial<Draft>) =>
    setQuestions((current) => current.map((question, at) => (at === index ? { ...question, ...change } : question)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      questions: filled.map((question) => ({
        ...(question.id ? { id: question.id } : {}),
        text: question.text.trim(),
        why: question.why.trim() || null,
        origin: question.origin,
      })),
      client: client.trim() || null,
      message: message.trim() || null,
      ...(questionnaire ? {} : { expiresIn }),
      ...(password ? { password } : {}),
    });
  };

  return (
    <form className="stack questionnaire-editor" onSubmit={submit}>
      <ol className="question-list">
        {questions.map((question, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no identity until they are saved.
          <li key={index} className="question-draft stack">
            <div className="field">
              <label className="field-label" htmlFor={`${id}-q${index}`}>
                {t("client.questionLabel", { number: index + 1 })}
              </label>
              <textarea
                id={`${id}-q${index}`}
                className="textarea"
                rows={2}
                maxLength={QUESTIONNAIRE_LIMITS.question}
                value={question.text}
                onChange={(event) => update(index, { text: event.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-hint" htmlFor={`${id}-w${index}`}>
                {t("client.whyLabel")}
              </label>
              <input
                id={`${id}-w${index}`}
                className="input"
                maxLength={QUESTIONNAIRE_LIMITS.why}
                value={question.why}
                onChange={(event) => update(index, { why: event.target.value })}
              />
            </div>
            {questions.length > 1 ? (
              <div>
                <button
                  type="button"
                  className="button button-quiet danger"
                  onClick={() => setQuestions((current) => current.filter((_, at) => at !== index))}
                >
                  <TrashIcon />
                  {t("client.removeQuestion", { number: index + 1 })}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {questions.length < QUESTIONNAIRE_LIMITS.questions ? (
        <div>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setQuestions((current) => [...current, { text: "", why: "", origin: "agency" }])}
          >
            <PlusIcon />
            {t("client.addQuestion")}
          </button>
        </div>
      ) : null}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-client`}>
          {t("client.clientLabel")}
        </label>
        <input
          id={`${id}-client`}
          className="input"
          maxLength={QUESTIONNAIRE_LIMITS.client}
          value={client}
          onChange={(event) => setClient(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-message`}>
          {t("client.messageLabel")}
        </label>
        <textarea
          id={`${id}-message`}
          className="textarea"
          rows={3}
          maxLength={QUESTIONNAIRE_LIMITS.message}
          value={message}
          aria-describedby={`${id}-message-hint`}
          onChange={(event) => setMessage(event.target.value)}
        />
        <span id={`${id}-message-hint`} className="field-hint">
          {t("client.messageHint")}
        </span>
      </div>
      <div className="options">
        {questionnaire ? null : (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-expiry`}>
              {t("client.expiryLabel")}
            </label>
            <select
              id={`${id}-expiry`}
              className="select"
              value={expiresIn}
              onChange={(event) => setExpiresIn(event.target.value as "7d" | "30d")}
            >
              <option value="30d">{t("client.expiry.30d")}</option>
              <option value="7d">{t("client.expiry.7d")}</option>
            </select>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${id}-password`}>
            {t("client.passwordLabel")}
          </label>
          <input
            id={`${id}-password`}
            className="input"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={password}
            aria-invalid={tooShort}
            aria-describedby={`${id}-password-hint`}
            placeholder={questionnaire?.hasPassword ? t("share.passwordChange") : t("share.passwordNone")}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id={`${id}-password-hint`} className="field-hint">
            {t("share.passwordHint", { min: PASSWORD_MIN })}
          </span>
        </div>
      </div>
      <div className="row">
        <button type="submit" className="button button-primary" disabled={pending || filled.length === 0 || tooShort}>
          {questionnaire ? t("client.saveChanges") : t("client.save")}
        </button>
        <button type="button" className="button button-quiet" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** A questionnaire sent: its link, its status, the answers and what can be done with them. */
function QuestionnaireCard({
  session,
  questionnaire,
  price,
  pending,
  run,
  onEdit,
  onChange,
}: {
  session: Session;
  questionnaire: Questionnaire;
  price: PriceQuote | null | undefined;
  pending: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onEdit: () => void;
  onChange: () => void;
}) {
  const { t, i18n } = useTranslation();
  const link = linkOf(questionnaire.token);
  const answered = questionnaire.answers.filter((answer) => answer.answer.trim() || answer.comment?.trim());
  const revising = Boolean(session.revising && !session.revising.error);
  const expired = Date.parse(questionnaire.expiresAt) <= Date.now();

  return (
    <div className="stack">
      <div className="row">
        <span className={`chip ${questionnaire.status === "submitted" ? "status-done" : ""}`}>
          {questionnaire.status === "submitted" && questionnaire.submittedAt
            ? t("client.status.submitted", { date: dateOf(questionnaire.submittedAt, i18n.language) })
            : t("client.status.open")}
        </span>
        <span className="field-hint">
          {expired ? t("errors.questionnaire_expired") : t("client.until", { date: dateOf(questionnaire.expiresAt, i18n.language) })}
        </span>
        {questionnaire.submittedBy === "agency" ? <span className="field-hint">{t("client.byAgency")}</span> : null}
      </div>
      <CopyField value={link} label={t("client.link")} copy={t("client.copy")} copied={t("client.copied")} />
      <p className="field-hint" style={{ margin: 0 }}>
        <a href={api.questionnaireWordUrl(session.id, questionnaire.id)} download>
          <DownloadIcon /> {t("client.word")}
        </a>{" "}
        · {t("client.wordHint")}
      </p>

      <details open={questionnaire.status === "submitted"}>
        <summary>
          {questionnaire.status === "submitted" ? t("client.answers") : t("client.questions", { number: questionnaire.questions.length })}
        </summary>
        <dl className="facts-list">
          {questionnaire.questions.map((question) => {
            const answer = questionnaire.answers.find((item) => item.questionId === question.id);
            return (
              <div key={question.id}>
                <dt dir="auto">{question.text}</dt>
                {questionnaire.status === "submitted" ? (
                  <dd>
                    {answer?.answer.trim() ? answer.answer : <span className="muted">{t("client.noAnswer")}</span>}
                    {answer?.comment ? <span className="field-hint"> {t("client.comment", { comment: answer.comment })}</span> : null}
                  </dd>
                ) : null}
              </div>
            );
          })}
        </dl>
      </details>

      {questionnaire.appliedRevision ? (
        <p className="field-hint" style={{ margin: 0 }}>
          {t("client.applied", { number: questionnaire.appliedRevision })}
        </p>
      ) : null}

      <div className="row">
        {questionnaire.status === "submitted" && answered.length > 0 && !questionnaire.appliedRevision ? (
          <button
            type="button"
            className="button button-primary"
            disabled={pending || revising}
            onClick={() => run(() => api.reviseFromAnswers(session.id, questionnaire.id).then(onChange))}
          >
            <UpdateLabel price={price} />
          </button>
        ) : null}
        {questionnaire.status === "open" ? (
          <button type="button" className="button button-secondary" disabled={pending} onClick={onEdit}>
            {t("client.edit")}
          </button>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => run(() => api.reopenQuestionnaire(session.id, questionnaire.id).then(onChange))}
          >
            {t("client.reopen")}
          </button>
        )}
        <button
          type="button"
          className="button button-quiet danger"
          disabled={pending}
          onClick={() => run(() => api.deleteQuestionnaire(session.id, questionnaire.id).then(onChange))}
        >
          <TrashIcon />
          {t("client.delete")}
        </button>
      </div>
    </div>
  );
}

/** Below the verdict, for those who may change the session: the questionnaire and the new facts. */
export function ClientLoop({
  session,
  price,
  onClient,
}: {
  session: Session;
  price: PriceQuote | null | undefined;
  /** The client's name, for the client proposal. */
  onClient: (client: string | null) => void;
}) {
  const { t } = useTranslation();
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[] | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = questionnaires?.at(-1) ?? null;
  const revisions = session.revisions.length;

  const load = useCallback(() => {
    api.questionnaires(session.id).then(
      (body) => setQuestionnaires(body.questionnaires),
      () => setQuestionnaires([]),
    );
  }, [session.id]);
  // A new revision may have been made from the answers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the number of revisions changes.
  useEffect(load, [load, revisions]);
  useEffect(() => onClient(latest?.client ?? null), [latest?.client, onClient]);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  const save = (settings: QuestionnaireSettings) =>
    run(async () => {
      if (editing === "edit" && latest) await api.updateQuestionnaire(session.id, latest.id, settings);
      else await api.createQuestionnaire(session.id, settings);
      setEditing(null);
      load();
    });

  const drafts: Draft[] =
    editing === "edit" && latest
      ? latest.questions.map((question) => ({ id: question.id, text: question.text, why: question.why ?? "", origin: question.origin }))
      : (session.verdict?.openQuestions ?? []).map((text) => ({ text, why: "", origin: "open_question" as const }));

  return (
    <section className="card client-loop stack" aria-labelledby="client-loop-title">
      <h2 className="heading" id="client-loop-title">
        {t("client.title")}
      </h2>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("client.lead")}
      </p>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {editing ? (
        <QuestionnaireEditor
          key={editing}
          initial={drafts}
          questionnaire={editing === "edit" ? latest : null}
          pending={pending}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : latest ? (
        <QuestionnaireCard
          session={session}
          questionnaire={latest}
          price={price}
          pending={pending}
          run={run}
          onEdit={() => setEditing("edit")}
          onChange={load}
        />
      ) : questionnaires ? (
        <div>
          <button type="button" className="button button-secondary" onClick={() => setEditing("new")}>
            {t("client.create")}
          </button>
        </div>
      ) : null}
      {latest && !editing && latest.status === "submitted" && latest.appliedRevision ? (
        <div>
          <button type="button" className="button button-quiet" onClick={() => setEditing("new")}>
            {t("client.createAnother")}
          </button>
        </div>
      ) : null}
      <details className="new-facts">
        <summary>{t("revision.editTitle")}</summary>
        <NewFacts session={session} price={price} />
      </details>
    </section>
  );
}
