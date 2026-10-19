import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authorName } from "./access.tsx";
import { api, type SessionSummary } from "./api.ts";
import { Segmented } from "./components/Controls.tsx";
import {
  CrossIcon,
  GalleryIcon,
  LockIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  RegisterIcon,
  SettingsIcon,
  SunIcon,
} from "./components/Icons.tsx";
import { LanguageSelect } from "./components/LanguageSelect.tsx";
import { Loader, Mark } from "./components/Logo.tsx";
import { markNavigation } from "./components/Page.tsx";
import { NewSession } from "./NewSession.tsx";
import { type ThemeChoice, useTheme } from "./theme.ts";

// The home page comes with the app; every other page is loaded when it is first opened. A client opening a
// questionnaire on a phone downloads that page, not the whole app.
const SessionView = lazy(() => import("./SessionView.tsx").then((module) => ({ default: module.SessionView })));
const SharedView = lazy(() => import("./SharedView.tsx").then((module) => ({ default: module.SharedView })));
const ClientQuestionnaire = lazy(() => import("./ClientQuestionnaire.tsx").then((module) => ({ default: module.ClientQuestionnaire })));
const Register = lazy(() => import("./Decisions.tsx").then((module) => ({ default: module.Register })));
const Gallery = lazy(() => import("./Gallery.tsx").then((module) => ({ default: module.Gallery })));
const Settings = lazy(() => import("./Settings.tsx").then((module) => ({ default: module.Settings })));

function PageLoader({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <Suspense fallback={<Loader label={t("common.loading")} />}>{children}</Suspense>;
}

const readRoute = () => window.location.hash.replace(/^#\/?/, "");

function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => {
      // The heading of the page navigated to takes the focus, for screen readers to say where the person is.
      markNavigation();
      setRoute(readRoute());
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path ? `/${path}` : "/";
  window.scrollTo({ top: 0 });
}

interface SessionsState {
  sessions: SessionSummary[];
  refresh: () => void;
  upsert: (summary: SessionSummary) => void;
  /** The history is a workspace's, shared with its members (hosted version). */
  shared: boolean;
  /** In a shared history, the person's own sessions only. */
  mine: boolean;
  setMine: (mine: boolean) => void;
}

const SessionsContext = createContext<SessionsState>({
  sessions: [],
  refresh: () => {},
  upsert: () => {},
  shared: false,
  mine: false,
  setMine: () => {},
});
export const useSessions = () => useContext(SessionsContext);

function useSessionList(): SessionsState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [shared, setShared] = useState(false);
  const [mine, setMine] = useState(false);
  // Only the latest request's answer is shown: switching between Everyone and Mine quickly keeps the last choice.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    api.sessions(mine).then(
      (body) => {
        if (request !== latest.current) return;
        setSessions(body.sessions);
        setShared(body.shared ?? false);
      },
      () => undefined,
    );
  }, [mine]);
  const listed = useRef(sessions);
  listed.current = sessions;
  const asked = useRef(new Set<string>());
  const upsert = useCallback(
    (summary: SessionSummary) => {
      // In a shared history, whose a new session is, and whether this view lists it, is the server's to say: asked
      // once per session.
      if (shared && !listed.current.some((item) => item.id === summary.id)) {
        if (!asked.current.has(summary.id)) {
          asked.current.add(summary.id);
          refresh();
        }
        return;
      }
      setSessions((current) => {
        const existing = current.find((item) => item.id === summary.id);
        if (existing && existing.phase === summary.phase && existing.idea === summary.idea) return current;
        // What the history knows of a session (its author, its privacy) stays.
        return [{ ...existing, ...summary }, ...current.filter((item) => item.id !== summary.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
      });
    },
    [shared, refresh],
  );
  useEffect(refresh, [refresh]);
  // The other sessions move on too (a debate that finished in another tab): the list is asked again when the tab is
  // shown again.
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);
  return { sessions, refresh, upsert, shared, mine, setMine };
}

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

function Sidebar({ current }: { current: string | null }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useTheme();
  const { sessions, shared, mine, setMine } = useSessions();
  const themeLabel = { system: t("nav.themeSystem"), light: t("nav.themeLight"), dark: t("nav.themeDark") }[theme];
  const date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });

  return (
    <div className="sidebar-inner">
      <a className="brand" href="#/" aria-label={`Quorumind, ${t("nav.newSession")}`}>
        <Mark busy={sessions.some((item) => item.phase === "debating")} />
        <span>quorumind</span>
      </a>
      <a className="button button-primary new-session" href="#/">
        <PlusIcon />
        {t("nav.newSession")}
      </a>
      <nav className="session-list" aria-label={t("nav.sessions")}>
        <h2 className="label muted">{t("nav.sessions")}</h2>
        {shared ? (
          <Segmented
            className="history-filter"
            legend={t("workspace.filter")}
            options={[
              { key: "everyone", value: false, label: t("workspace.everyone") },
              { key: "mine", value: true, label: t("workspace.mine") },
            ]}
            value={mine}
            onChange={setMine}
          />
        ) : null}
        {sessions.length === 0 ? (
          <p className="field-hint">{t("nav.noSessions")}</p>
        ) : (
          <ul>
            {sessions.map((item) => (
              <li key={item.id}>
                <a href={`#/s/${item.id}`} aria-current={item.id === current ? "page" : undefined}>
                  <span className="session-title">
                    {item.private ? (
                      <span className="session-private" title={t("workspace.private")}>
                        <LockIcon />
                        <span className="visually-hidden">{t("workspace.private")}</span>
                      </span>
                    ) : null}
                    {item.idea}
                  </span>
                  <span className="session-meta">
                    <span className={`phase-dot phase-${item.phase}`} />
                    {t(`phase.${item.phase}`)} · {date.format(new Date(item.updatedAt))}
                  </span>
                  {shared && item.mine === false ? <span className="session-meta session-author">{authorName(item.author, t)}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <nav className="sidebar-links" aria-label={t("nav.more")}>
        <a href="#/decisions" aria-current={current === "decisions" ? "page" : undefined}>
          <RegisterIcon />
          {t("nav.decisions")}
        </a>
        <a href="#/gallery" aria-current={current === "gallery" ? "page" : undefined}>
          <GalleryIcon />
          {t("nav.gallery")}
        </a>
        <a href="#/settings" aria-current={current === "settings" ? "page" : undefined}>
          <SettingsIcon />
          {t("nav.settings")}
        </a>
      </nav>
      <div className="sidebar-foot">
        <LanguageSelect id="language" />
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(NEXT_THEME[theme])}
          aria-label={`${t("nav.theme")}: ${themeLabel}`}
          title={`${t("nav.theme")}: ${themeLabel}`}
        >
          {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonIcon /> : <MonitorIcon />}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  // A questionnaire link is the client's page alone, and a share link the shared session alone: none of the app
  // around them, whose history lists the sessions of the server.
  if (route.startsWith("q/")) {
    return (
      <PageLoader>
        <ClientQuestionnaire key={route} token={route.slice(2)} />
      </PageLoader>
    );
  }
  if (route.startsWith("shared/")) {
    return (
      <PageLoader>
        <SharedView key={route} token={route.slice(7)} />
      </PageLoader>
    );
  }
  return <Shell route={route} />;
}

function Shell({ route }: { route: string }) {
  const { t } = useTranslation();
  const sessionsState = useSessionList();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const sessionId = route.startsWith("s/") ? route.slice(2) : null;
  const page = sessionId ? (
    <SessionView key={sessionId} id={sessionId} />
  ) : route === "gallery" ? (
    <Gallery />
  ) : route === "settings" ? (
    <Settings />
  ) : route === "decisions" ? (
    <Register />
  ) : (
    <NewSession />
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    // Any link in the menu closes it, including the one for the page already shown.
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".sidebar a")) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    // The open menu covers the page: the focus goes into it, and back to its button once it closes.
    sidebar.current?.querySelector<HTMLElement>("a, button, select")?.focus();
    const button = menuButton.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      if (button && document.activeElement?.closest(".sidebar")) button.focus();
    };
  }, [menuOpen]);

  // A button rather than a link to #main-content: the address's fragment is the route.
  const skip = () => document.getElementById("main-content")?.focus();

  return (
    <SessionsContext.Provider value={sessionsState}>
      <button type="button" className="skip-link" onClick={skip}>
        {t("nav.skip")}
      </button>
      <div className="app" data-menu={menuOpen ? "open" : "closed"}>
        <header className="mobile-bar">
          <a className="brand" href="#/">
            <Mark />
            <span>quorumind</span>
          </a>
          <button
            ref={menuButton}
            type="button"
            className="icon-button"
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.menu")}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <CrossIcon /> : <MenuIcon />}
          </button>
        </header>
        <aside className="sidebar" id="sidebar" ref={sidebar}>
          <Sidebar current={sessionId ?? route} />
        </aside>
        {/* Behind the open menu, the page is out of reach of the keyboard and of screen readers. */}
        <main className="main" id="main-content" tabIndex={-1} inert={menuOpen}>
          <div className="page">
            <PageLoader>{page}</PageLoader>
          </div>
          <footer className="footer">{t("app.footer")}</footer>
        </main>
      </div>
    </SessionsContext.Provider>
  );
}
