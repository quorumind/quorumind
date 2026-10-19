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
/** How often the list of questionnaires is asked again while the client has not answered. */
const POLL_MS = 30_000;
const FOLLOW_UP_MS = 2_000;
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
  const { t, i18n } = useTranslation();
  const id = useId();
  const [questions, setQuestions] = useState<Draft[]>(initial.length > 0 ? initial : [{ text: "", why: "", origin: "agency" }]);
  const [client, setClient] = useState(questionnaire?.client ?? "");
  const [message, setMessage] = useState(questionnaire?.message ?? "");
  // A questionnaire sent keeps its date ("") until the agency extends it, e.g. once it expired unanswered.
  const [expiresIn, setExpiresIn] = useState<"7d" | "30d" | "">(questionnaire ? "" : "30d");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
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
      ...(expiresIn ? { expiresIn } : {}),
      ...(removePassword ? { password: null } : password ? { password } : {}),
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
        <div className="field">
          <label className="field-label" htmlFor={`${id}-expiry`}>
            {t("client.expiryLabel")}
          </label>
          <select
            id={`${id}-expiry`}
            className="select"
            value={expiresIn}
            onChange={(event) => setExpiresIn(event.target.value as "7d" | "30d" | "")}
          >
            {questionnaire ? (
              <option value="">
                {Date.parse(questionnaire.expiresAt) <= Date.now()
                  ? t("errors.questionnaire_expired")
                  : t("client.until", { date: dateOf(questionnaire.expiresAt, i18n.language) })}
              </option>
            ) : null}
            <option value="30d">{t("client.expiry.30d")}</option>
            <option value="7d">{t("client.expiry.7d")}</option>
          </select>
        </div>
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
            disabled={removePassword}
            aria-invalid={tooShort}
            aria-describedby={`${id}-password-hint`}
            placeholder={questionnaire?.hasPassword ? t("share.passwordChange") : t("share.passwordNone")}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id={`${id}-password-hint`} className="field-hint">
            {t("share.passwordHint", { min: PASSWORD_MIN })}
          </span>
          {questionnaire?.hasPassword ? (
            <label className="check">
              <input
                type="checkbox"
                checked={removePassword}
                onChange={(event) => {
                  setRemovePassword(event.target.checked);
                  setPassword("");
                }}
              />
              <span>{t("share.passwordRemove")}</span>
            </label>
          ) : null}
        </div>
      </div>
      <div className="row">
        <button type="submit" className="button button-primary" disabled={pending || filled.length === 0 || (tooShort && !removePassword)}>
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
  requested,
  run,
  onEdit,
  onChange,
  onRevise,
}: {
  session: Session;
  questionnaire: Questionnaire;
  price: PriceQuote | null | undefined;
  pending: boolean;
  /** A revision was asked for from these answers and is not shown as applied yet: no second one, which would be paid. */
  requested: boolean;
  run: (work: () => Promise<void>) => Promise<void>;
  onEdit: () => void;
  onChange: () => void;
  onRevise: () => void;
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
            disabled={pending || revising || requested}
            onClick={() =>
              run(async () => {
                await api.reviseFromAnswers(session.id, questionnaire.id);
                onRevise();
              })
            }
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
  const [loadError, setLoadError] = useState<string | null>(null);
  // The questionnaires a revision was asked for, until the list shows it applied.
  const [requested, setRequested] = useState<string[]>([]);
  const latest = questionnaires?.at(-1) ?? null;
  const revisions = session.revisions.length;
  const revising = session.revising !== null;

  const load = useCallback(() => {
    api.questionnaires(session.id).then(
      (body) => {
        setLoadError(null);
        setQuestionnaires(body.questionnaires);
        setRequested((ids) => ids.filter((id) => !body.questionnaires.some((item) => item.id === id && item.appliedRevision)));
      },
      (caught: unknown) => setLoadError(failureText(t, caught)),
    );
  }, [session.id, t]);
  // A revision made from the answers, or one that ended: the list says which questionnaire it was made from. The
  // server records that just after the revision itself, so the list is asked again a moment later.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the revisions change.
  useEffect(() => {
    load();
    if (revising) return;
    const again = setTimeout(load, FOLLOW_UP_MS);
    return () => clearTimeout(again);
  }, [load, revisions, revising]);
  // The client answers on their side: while a questionnaire waits, the list is asked again now and then, and when
  // the person comes back to the tab.
  const waiting = latest?.status === "open";
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", load);
    const timer = waiting ? setInterval(load, POLL_MS) : null;
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", load);
      if (timer !== null) clearInterval(timer);
    };
  }, [load, waiting]);
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
      {loadError ? (
        <div className="notice notice-error row" role="alert">
          <span>{loadError}</span>
          <button type="button" className="button button-secondary" onClick={load}>
            {t("common.retry")}
          </button>
        </div>
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
          requested={requested.includes(latest.id)}
          run={run}
          onEdit={() => setEditing("edit")}
          onChange={load}
          onRevise={() => setRequested((ids) => [...ids, latest.id])}
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
