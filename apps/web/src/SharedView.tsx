import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { replaceRoute } from "./App.tsx";
import { AccessContext, READ_ONLY } from "./access.tsx";
import { ApiError, api, type SharedView as SharedData } from "./api.ts";
import { ClientReport } from "./ClientReport.tsx";
import { BusyButton } from "./components/BusyButton.tsx";
import { FieldError, fieldProps, useFieldErrors } from "./components/Field.tsx";
import { LanguageSelect } from "./components/LanguageSelect.tsx";
import { Mark } from "./components/Logo.tsx";
import { markNavigation, PageHeading, usePageTitle } from "./components/Page.tsx";
import { failureText } from "./errors.ts";
import { SessionBody, type SessionTab } from "./SessionView.tsx";

// The page a share link opens: the shared session or its decision report, read-only, without costs or attached
// documents. Outside the app's shell: whoever was sent the link sees nothing else of the server.

type State = { kind: "loading" } | { kind: "open"; view: SharedData } | { kind: "locked" } | { kind: "expired" } | { kind: "missing" };

/** `tab`: the tab in the address (#/shared/<token>/<tab>), as in the app. */
export function SharedView({ token, tab }: { token: string; tab?: string | undefined }) {
  const { t } = useTranslation();
  const [grant, setGrant] = useState<string | null>(() => storedAccess(token));
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    api.shared(token, grant).then(
      (view) => setState({ kind: "open", view }),
      (caught) => {
        const code = caught instanceof ApiError ? caught.code : null;
        setState({ kind: code === "password_required" ? "locked" : code === "share_expired" ? "expired" : "missing" });
      },
    );
  }, [token, grant]);

  // A decision report names the tab itself; a full share does through its heading.
  usePageTitle(state.kind === "open" && "deliverable" in state.view ? state.view.deliverable.title || "" : null);
  const reportUrl = api.sharedReportUrl(token, grant);
  const onTabChange = useCallback((next: SessionTab | null) => replaceRoute(next ? `shared/${token}/${next}` : `shared/${token}`), [token]);
  let body: ReactNode;
  if (state.kind === "locked") {
    body = (
      <SharePassword
        token={token}
        onAccess={(granted) => {
          keepAccess(token, granted);
          setGrant(granted);
        }}
      />
    );
  } else if (state.kind === "expired" || state.kind === "missing") {
    // Whoever opened the link has nothing else here, and no way into the sender's app: the page says what happened
    // and who can help, nothing more.
    body = (
      <div className="narrow stack not-found">
        <PageHeading title={t("notFound.linkTitle")} />
        <p className="lead">{state.kind === "expired" ? t("errors.share_expired") : t("notFound.linkLead")}</p>
      </div>
    );
  } else if (state.kind === "open" && state.view.share.mode === "client" && "deliverable" in state.view) {
    body = (
      <div className="stack">
        <p className="notice">{t("share.clientReadOnly")}</p>
        <ClientReport deliverable={state.view.deliverable} reportUrl={reportUrl} />
      </div>
    );
  } else {
    const session = state.kind === "open" && "session" in state.view ? state.view.session : null;
    body = (
      <div className="stack">
        <p className="notice">{t("share.readOnly")}</p>
        <SessionBody session={session} live={{}} connected readOnly reportUrl={reportUrl} routeTab={tab} onTabChange={onTabChange} />
      </div>
    );
  }

  return (
    // Whoever holds the link reads: never the forms of the interview or the debate, whatever the link shows.
    <AccessContext.Provider value={READ_ONLY}>
      <div className="shared-page">
        <header className="shared-bar">
          <span className="brand">
            <Mark />
            <span>quorumind</span>
          </span>
          <LanguageSelect id="shared-language" />
        </header>
        <main className="page" id="main-content" tabIndex={-1}>
          {body}
        </main>
        <footer className="footer">{t("app.footer")}</footer>
      </div>
    </AccessContext.Provider>
  );
}

// The access a protected link's password gives lasts a few hours: kept for the tab, so a reload does not ask again.
const accessKey = (token: string) => `quorumind.share.${token}`;
function storedAccess(token: string): string | null {
  try {
    return sessionStorage.getItem(accessKey(token));
  } catch {
    return null;
  }
}
function keepAccess(token: string, access: string) {
  try {
    sessionStorage.setItem(accessKey(token), access);
  } catch {
    // Not critical: the password is asked again after a reload.
  }
}

function SharePassword({ token, onAccess }: { token: string; onAccess: (access: string) => void }) {
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
      const { access } = await api.shareAccess(token, password);
      // The form goes away and the shared page takes its place: its heading takes the focus, as after a navigation.
      markNavigation();
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
    <form ref={fields.form} className="narrow card stack" onSubmit={submit} noValidate>
      <PageHeading className="heading" title={t("share.lockedTitle")} />
      <p style={{ margin: 0 }}>{t("share.lockedLead")}</p>
      <div className="field">
        <label className="field-label" htmlFor="share-password">
          {t("share.passwordLabel")}
        </label>
        <input
          id="share-password"
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
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <BusyButton type="submit" busy={pending}>
          {t("share.unlock")}
        </BusyButton>
      </div>
    </form>
  );
}
