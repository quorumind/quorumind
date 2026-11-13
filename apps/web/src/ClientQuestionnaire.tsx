import type { Branding } from "@quorumind/core";
import { isLocale } from "@quorumind/core/locales";
import { QUESTIONNAIRE_LIMITS } from "@quorumind/core/questionnaire";
import i18next from "i18next";
import { type CSSProperties, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type PublicQuestionnaire } from "./api.ts";
import { BusyButton } from "./components/BusyButton.tsx";
import { Dialog, useDialog } from "./components/Dialog.tsx";
import { FieldError, fieldProps, useFieldErrors } from "./components/Field.tsx";
import { CheckIcon, DownloadIcon } from "./components/Icons.tsx";
import { LanguageSelect } from "./components/LanguageSelect.tsx";
import { Loader } from "./components/Logo.tsx";
import { PageHeading } from "./components/Page.tsx";
import { blend, isHexColor, readableOn, textOn } from "./contrast.ts";
import { errorText, failureText } from "./errors.ts";
import { switchLanguage } from "./i18n.ts";

// The page a client opens from a questionnaire link: no account, the agency's branding, the session's language, one
// field per answer and an optional comment, sent once. Outside the app's shell: the client sees nothing else.

type Answers = Record<string, { answer: string; comment: string }>;

const accessKey = (token: string) => `quorumind.questionnaire.${token}`;
const draftKey = (token: string) => `quorumind.questionnaire.${token}.draft`;
const languageKey = (token: string) => `quorumind.questionnaire.${token}.language`;

/** A client may come back the next day or the next week, but not for ever: an old draft is dropped. */
const DRAFT_DAYS = 30;

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

/** The answers typed so far: kept in the browser (not the tab) so that closing it loses nothing, for a limited time. */
function readDraft(token: string): Answers {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(token)) ?? "null") as { savedAt?: number; answers?: Answers } | null;
    if (saved?.answers && typeof saved.savedAt === "number" && Date.now() - saved.savedAt < DRAFT_DAYS * 86_400_000) return saved.answers;
    if (saved) localStorage.removeItem(draftKey(token));
  } catch {
    // An unreadable draft is no draft.
  }
  return {};
}

function writeDraft(token: string, answers: Answers | null) {
  try {
    if (answers) localStorage.setItem(draftKey(token), JSON.stringify({ savedAt: Date.now(), answers }));
    else localStorage.removeItem(draftKey(token));
  } catch {
    // Without storage, the answers live as long as the page.
  }
}

// The surfaces the accent is read on, as styles.css sets them: the page, the cards, and the cards tinted with the
// accent (selected chips, notices).
const LIGHT_SURFACES = ["#ffffff", "#f6f7fb"];
const DARK_SURFACES = ["#0e1121", "#161a2e"];

/**
 * The agency's accent on its client's page. The accent itself fills the main button, with black or white text,
 * whichever reads better; as text, links and focus rings, each theme gets the closest shade of it that keeps WCAG's
 * 4.5:1 on every surface (a yellow accent turns ochre on white, a navy one turns light on the dark theme).
 */
export function brandStyle(branding: Branding): CSSProperties | undefined {
  const accent = branding.accent;
  if (!isHexColor(accent)) return undefined;
  const light = readableOn(accent, [...LIGHT_SURFACES, blend("#ffffff", accent, 0.14)]);
  const dark = readableOn(accent, [...DARK_SURFACES, blend("#161a2e", accent, 0.14)]);
  return {
    "--brand-fill": accent,
    "--brand-on-fill": textOn(accent),
    "--brand-text-light": light,
    "--brand-on-light": textOn(light),
    "--brand-text-dark": dark,
    "--brand-on-dark": textOn(dark),
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

  // The page is shown in the questionnaire's language for this visit only, never remembered: an agency member who
  // checks a client's link gets their own language back on leaving it.
  const [own] = useState(() => i18n.language);
  useEffect(
    () => () => {
      if (isLocale(own) && i18next.language !== own) void switchLanguage(own, false).catch(() => undefined);
    },
    [own],
  );

  useEffect(() => {
    api.questionnaire(token, access).then(
      ({ questionnaire, branding }) => {
        // The questions are in the session's language: the page follows it, unless the client chose another one for
        // this link (kept for the tab).
        const chosen = read(languageKey(token));
        const shown = chosen && isLocale(chosen) ? chosen : questionnaire.locale;
        if (isLocale(shown) && i18n.language !== shown) void switchLanguage(shown, false).catch(() => undefined);
        setState({ kind: "open", questionnaire, branding });
      },
      (caught) => {
        const code = caught instanceof ApiError ? caught.code : "network";
        setState(code === "password_required" ? { kind: "locked" } : { kind: "refused", code });
      },
    );
  }, [token, access, i18n]);

  const branding = state.kind === "open" ? state.branding : null;
  const style = branding ? brandStyle(branding) : undefined;
  return (
    <div className="client-page" style={style} data-brand={style ? "" : undefined}>
      <main className="client-page-main narrow stack-lg">
        {/* The agency's name and logo (white label: never Quorumind's), and the client's own choice of language. */}
        <header className="client-bar" data-brand={branding?.logoDataUrl || branding?.name ? "" : undefined}>
          {branding?.logoDataUrl || branding?.name ? (
            <span className="client-brand">
              {branding.logoDataUrl ? <img src={branding.logoDataUrl} alt={branding.name ?? ""} /> : null}
              {branding.name ? <span dir="auto">{branding.name}</span> : null}
            </span>
          ) : null}
          <span className="client-language">
            <LanguageSelect id="client-language" remember={false} onChange={(locale) => write(languageKey(token), locale)} />
          </span>
        </header>
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
        {state.kind === "refused" && (state.code === "not_found" || state.code === "questionnaire_expired") ? (
          // A link that leads nowhere is a page of its own: what happened, and who can send a new one.
          <div className="stack not-found">
            <PageHeading title={t("notFound.linkTitle")} />
            <p className="lead">{state.code === "not_found" ? t("notFound.linkLead") : errorText(t, state.code)}</p>
          </div>
        ) : state.kind === "refused" ? (
          <p className="notice notice-error" role="alert">
            {state.code === "network" ? t("error.request") : errorText(t, state.code)}
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
  const fields = useFieldErrors();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return fields.report({ password: t("validation.passwordEmpty") });
    fields.clear();
    setPending(true);
    setError(null);
    try {
      const { access } = await api.questionnaireAccess(token, password);
      onAccess(access ?? "");
    } catch (caught) {
      // A wrong password belongs under the field; anything else (too many attempts, a lost link) stays general.
      if (caught instanceof ApiError && caught.code === "wrong_password") fields.report({ password: failureText(t, caught) });
      else setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <form ref={fields.form} className="card stack" onSubmit={submit} noValidate>
      <PageHeading className="heading" title={t("questionnaire.lockedTitle")} />
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
          {...fieldProps("password-field", fields.errors.password)}
          onChange={(event) => {
            fields.clear("password");
            setPassword(event.target.value);
          }}
        />
        <FieldError id="password-field" error={fields.errors.password} />
      </div>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div>
        <BusyButton type="submit" busy={pending}>
          {t("questionnaire.unlock")}
        </BusyButton>
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
    return { ...given, ...readDraft(token) };
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmDialog = useDialog();
  const thanks = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(questionnaire.status !== "submitted");
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(iso));
  const submitted = questionnaire.status === "submitted";
  const total = questionnaire.questions.length;
  const answered = questionnaire.questions.filter((question) => answers[question.id]?.answer.trim()).length;
  const title = questionnaire.project ? t("questionnaire.title", { project: questionnaire.project }) : t("questionnaire.untitled");

  // After sending, the form is gone: the focus goes to the thanks, which is what changed, not to the page's start.
  useEffect(() => {
    if (submitted && wasOpen.current) thanks.current?.focus();
    wasOpen.current = !submitted;
  }, [submitted]);

  const change = (questionId: string, field: "answer" | "comment", value: string) =>
    setAnswers((current) => {
      const next = { ...current, [questionId]: { answer: "", comment: "", ...current[questionId], [field]: value } };
      writeDraft(token, next);
      return next;
    });

  // Sending is final: answers left empty are pointed out first, and sent only if the client still wants to.
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (answered < total) confirmDialog.open();
    else void submit();
  };

  const submit = async () => {
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
      writeDraft(token, null);
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
        <PageHeading title={title} />
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
          <div className="notice client-thanks stack" role="status" ref={thanks} tabIndex={-1}>
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
        <form className="stack-lg" onSubmit={review} noValidate>
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
              {t("questionnaire.progress", { answered, total, count: total })}
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
              <BusyButton type="submit" busy={pending} busyLabel={t("questionnaire.sending")}>
                {t("questionnaire.submit")}
              </BusyButton>
            </div>
          </div>
          <Dialog dialog={confirmDialog} labelledBy={`${id}-confirm-title`}>
            <div className="stack">
              <h2 id={`${id}-confirm-title`} className="heading">
                {t("questionnaire.unansweredTitle")}
              </h2>
              <p style={{ margin: 0 }}>{t("questionnaire.unansweredLead", { missing: total - answered, total })}</p>
              <div className="dialog-actions">
                <button type="button" className="button button-secondary" onClick={confirmDialog.close}>
                  {t("questionnaire.unansweredBack")}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    confirmDialog.close();
                    void submit();
                  }}
                >
                  {t("questionnaire.unansweredSend")}
                </button>
              </div>
            </div>
          </Dialog>
        </form>
      )}
    </>
  );
}
