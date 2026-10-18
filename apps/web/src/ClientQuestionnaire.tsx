import type { Branding } from "@quorumind/core";
import { isLocale } from "@quorumind/core/locales";
import { QUESTIONNAIRE_LIMITS } from "@quorumind/core/questionnaire";
import { type CSSProperties, type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type PublicQuestionnaire } from "./api.ts";
import { CheckIcon, DownloadIcon } from "./components/Icons.tsx";
import { Loader } from "./components/Logo.tsx";
import { errorText, failureText } from "./errors.ts";

// The page a client opens from a questionnaire link: no account, the agency's branding, the session's language, one
// field per answer and an optional comment, sent once. Outside the app's shell: the client sees nothing else.

type Answers = Record<string, { answer: string; comment: string }>;

const accessKey = (token: string) => `quorumind.questionnaire.${token}`;
const draftKey = (token: string) => `quorumind.questionnaire.${token}.draft`;

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Not critical: the password, or the draft, is asked for again after a reload.
  }
}

/** The agency's accent as the page's main color, with readable text on it. */
function brandStyle(branding: Branding): CSSProperties | undefined {
  const accent = branding.accent;
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return undefined;
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(accent.slice(start, start + 2), 16) / 255) as [number, number, number];
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return {
    "--thesis": accent,
    "--thesis-soft": `color-mix(in srgb, ${accent} 14%, var(--surface-raised))`,
    "--on-thesis": luminance > 0.4 ? "#141a3a" : "#ffffff",
    "--focus-ring": accent,
  } as CSSProperties;
}

export function ClientQuestionnaire({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const [access, setAccess] = useState<string | null>(() => read(accessKey(token)));
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "open"; questionnaire: PublicQuestionnaire; branding: Branding }
    | { kind: "locked" }
    | { kind: "refused"; code: string }
  >({ kind: "loading" });

  useEffect(() => {
    api.questionnaire(token, access).then(
      ({ questionnaire, branding }) => {
        // The questions are in the session's language: the page follows it.
        if (isLocale(questionnaire.locale) && i18n.language !== questionnaire.locale) void i18n.changeLanguage(questionnaire.locale);
        setState({ kind: "open", questionnaire, branding });
      },
      (caught) => {
        const code = caught instanceof ApiError ? caught.code : "network";
        setState(code === "password_required" ? { kind: "locked" } : { kind: "refused", code });
      },
    );
  }, [token, access, i18n]);

  const branding = state.kind === "open" ? state.branding : null;
  return (
    <div className="client-page" style={branding ? brandStyle(branding) : undefined}>
      <main className="client-page-main narrow stack-lg">
        {branding?.logoDataUrl || branding?.name ? (
          <header className="client-brand">
            {branding.logoDataUrl ? <img src={branding.logoDataUrl} alt={branding.name ?? ""} /> : null}
            {branding.name ? <span>{branding.name}</span> : null}
          </header>
        ) : null}
        {state.kind === "loading" ? <Loader label={t("common.loading")} /> : null}
        {state.kind === "locked" ? (
          <Password
            token={token}
            onAccess={(granted) => {
              write(accessKey(token), granted);
              setAccess(granted);
            }}
          />
        ) : null}
        {state.kind === "refused" ? (
          <p className="notice notice-error" role="alert">
            {state.code === "not_found"
              ? t("questionnaire.missing")
              : state.code === "network"
                ? t("error.request")
                : errorText(t, state.code)}
          </p>
        ) : null}
        {state.kind === "open" ? (
          <Questions
            token={token}
            access={access}
            questionnaire={state.questionnaire}
            agency={state.branding.name}
            onSubmitted={(questionnaire) => setState({ ...state, questionnaire })}
          />
        ) : null}
      </main>
    </div>
  );
}

function Password({ token, onAccess }: { token: string; onAccess: (access: string) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { access } = await api.questionnaireAccess(token, password);
      onAccess(access ?? "");
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h1 className="heading">{t("questionnaire.lockedTitle")}</h1>
      <p style={{ margin: 0 }}>{t("questionnaire.lockedLead")}</p>
      <div className="field">
        <label className="field-label" htmlFor="questionnaire-password">
          {t("share.passwordLabel")}
        </label>
        <input
          id="questionnaire-password"
          className="input"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="button button-primary" disabled={pending || !password}>
          {t("questionnaire.unlock")}
        </button>
      </div>
    </form>
  );
}

function Questions({
  token,
  access,
  questionnaire,
  agency,
  onSubmitted,
}: {
  token: string;
  access: string | null;
  questionnaire: PublicQuestionnaire;
  agency: string | null;
  onSubmitted: (questionnaire: PublicQuestionnaire) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [answers, setAnswers] = useState<Answers>(() => {
    const given: Answers = Object.fromEntries(
      questionnaire.answers.map((item) => [item.questionId, { answer: item.answer, comment: item.comment ?? "" }]),
    );
    try {
      return { ...given, ...(JSON.parse(read(draftKey(token)) ?? "{}") as Answers) };
    } catch {
      return given;
    }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(iso));
  const submitted = questionnaire.status === "submitted";
  const total = questionnaire.questions.length;
  const answered = questionnaire.questions.filter((question) => answers[question.id]?.answer.trim()).length;
  const title = questionnaire.project ? t("questionnaire.title", { project: questionnaire.project }) : t("questionnaire.untitled");

  const change = (questionId: string, field: "answer" | "comment", value: string) =>
    setAnswers((current) => {
      const next = { ...current, [questionId]: { answer: "", comment: "", ...current[questionId], [field]: value } };
      write(draftKey(token), JSON.stringify(next));
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { questionnaire: sent } = await api.submitAnswers(
        token,
        access,
        questionnaire.questions.map((question) => ({
          questionId: question.id,
          answer: answers[question.id]?.answer.trim() ?? "",
          comment: answers[question.id]?.comment.trim() || null,
        })),
      );
      write(draftKey(token), null);
      onSubmitted(sent);
      window.scrollTo({ top: 0 });
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <section className="stack">
        <h1 className="display">{title}</h1>
        {agency || questionnaire.client ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {[
              agency ? t("questionnaire.from", { agency }) : "",
              questionnaire.client ? t("questionnaire.for", { client: questionnaire.client }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {submitted ? (
          <div className="notice client-thanks stack" role="status">
            <strong>
              <CheckIcon /> {t("questionnaire.thanks", { date: date(questionnaire.submittedAt ?? new Date().toISOString()) })}
            </strong>
            <span>{t("questionnaire.thanksLead")}</span>
          </div>
        ) : (
          <>
            <p className="prose" style={{ margin: 0 }}>
              {questionnaire.message ?? t("questionnaire.intro")}
            </p>
            <p style={{ margin: 0 }}>
              <strong>{t("questionnaire.until", { date: date(questionnaire.expiresAt) })}</strong>
            </p>
          </>
        )}
        <p className="field-hint" style={{ margin: 0 }}>
          <a href={api.sharedQuestionnaireWordUrl(token, access)} download>
            <DownloadIcon /> {t("questionnaire.word")}
          </a>
        </p>
      </section>

      {submitted ? (
        <dl className="card facts-list">
          {questionnaire.questions.map((question) => {
            const answer = questionnaire.answers.find((item) => item.questionId === question.id);
            return (
              <div key={question.id}>
                <dt dir="auto">{question.text}</dt>
                <dd dir="auto">
                  {answer?.answer || "–"}
                  {answer?.comment ? <span className="field-hint"> ({answer.comment})</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <form className="stack-lg" onSubmit={submit} noValidate>
          {questionnaire.questions.map((question, index) => (
            <fieldset key={question.id} className="card client-question stack">
              <legend className="visually-hidden">{t("questionnaire.question", { number: index + 1 })}</legend>
              <p className="label muted" aria-hidden="true" style={{ margin: 0 }}>
                {t("questionnaire.question", { number: index + 1 })}
              </p>
              <p className="title" id={`${id}-text-${question.id}`} dir="auto" style={{ margin: 0 }}>
                {question.text}
              </p>
              {question.why ? (
                <p className="field-hint" id={`${id}-why-${question.id}`} style={{ margin: 0 }}>
                  {/* The reason is isolated: it may be in another script than the page. */}
                  {t("questionnaire.why", { why: `⁨${question.why}⁩` })}
                </p>
              ) : null}
              <div className="field">
                <label className="field-label" htmlFor={`${id}-answer-${question.id}`}>
                  {t("questionnaire.answerLabel")}
                </label>
                <textarea
                  id={`${id}-answer-${question.id}`}
                  className="textarea"
                  dir="auto"
                  rows={3}
                  maxLength={QUESTIONNAIRE_LIMITS.answer}
                  aria-describedby={`${id}-text-${question.id}${question.why ? ` ${id}-why-${question.id}` : ""}`}
                  value={answers[question.id]?.answer ?? ""}
                  onChange={(event) => change(question.id, "answer", event.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-hint" htmlFor={`${id}-comment-${question.id}`}>
                  {t("questionnaire.commentLabel")}
                </label>
                <textarea
                  id={`${id}-comment-${question.id}`}
                  className="textarea textarea-small"
                  dir="auto"
                  rows={2}
                  maxLength={QUESTIONNAIRE_LIMITS.comment}
                  value={answers[question.id]?.comment ?? ""}
                  onChange={(event) => change(question.id, "comment", event.target.value)}
                />
              </div>
            </fieldset>
          ))}
          <div className="stack client-submit">
            <p className="field-hint" aria-live="polite" style={{ margin: 0 }}>
              {t("questionnaire.progress", { answered, total })}
            </p>
            <p className="field-hint" style={{ margin: 0 }}>
              {t("questionnaire.once")}
            </p>
            {error ? (
              <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            ) : null}
            <div>
              <button type="submit" className="button button-primary" disabled={pending}>
                {pending ? t("questionnaire.sending") : t("questionnaire.submit")}
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
