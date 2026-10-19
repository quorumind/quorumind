import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HostNavigation, type SessionSummary } from "./api.ts";
import { HostLinks, HostUser, SiteLink, WorkspaceSwitch } from "./components/HostMenu.tsx";
import {
  CrossIcon,
  DebatesIcon,
  GalleryIcon,
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
const Sessions = lazy(() => import("./Sessions.tsx").then((module) => ({ default: module.Sessions })));

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
  /** Whether the history came, and whether its last request failed. */
  status: "loading" | "ready" | "failed";
}

const SessionsContext = createContext<SessionsState>({
  sessions: [],
  refresh: () => {},
  upsert: () => {},
  shared: false,
  mine: false,
  setMine: () => {},
  status: "loading",
});
export const useSessions = () => useContext(SessionsContext);

function useSessionList(): SessionsState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [shared, setShared] = useState(false);
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState<SessionsState["status"]>("loading");
  // Only the latest request's answer is shown: switching between Everyone and Mine quickly keeps the last choice.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    api.sessions(mine).then(
      (body) => {
        if (request !== latest.current) return;
        setSessions(body.sessions);
        setShared(body.shared ?? false);
        setStatus("ready");
      },
      () => {
        if (request === latest.current) setStatus("failed");
      },
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
  return { sessions, refresh, upsert, shared, mine, setMine, status };
}

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

/**
 * A server that sent the host's part of the menu once (hosted version) is expected to send it again: the menu is laid
 * out for it from the first paint, and filled once the configuration comes. A self-hosted server never sends one.
 */
const HOST_MENU_KEY = "quorumind.hostMenu";

function hostMenuExpected() {
  try {
    return localStorage.getItem(HOST_MENU_KEY) === "1";
  } catch {
    return false;
  }
}

/** The host's part of the menu: null for none (self-hosted), undefined while it is awaited. */
function useHostNavigation(): HostNavigation | null | undefined {
  const [navigation, setNavigation] = useState<HostNavigation | null | undefined>(() => (hostMenuExpected() ? undefined : null));
  useEffect(() => {
    let live = true;
    api.config().then(
      (config) => {
        const value = config.navigation ?? null;
        try {
          if (value) localStorage.setItem(HOST_MENU_KEY, "1");
          else localStorage.removeItem(HOST_MENU_KEY);
        } catch {
          // Without storage, the menu takes the host's part once it comes.
        }
        if (live) setNavigation(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return navigation;
}

function ThemeButton() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  const themeLabel = { system: t("nav.themeSystem"), light: t("nav.themeLight"), dark: t("nav.themeDark") }[theme];
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(NEXT_THEME[theme])}
      aria-label={`${t("nav.theme")}: ${themeLabel}`}
      title={`${t("nav.theme")}: ${themeLabel}`}
    >
      {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonIcon /> : <MonitorIcon />}
    </button>
  );
}

/** How many of the latest sessions the menu lists: the sessions page has them all. */
const RECENT_COUNT = 15;

/**
 * The latest sessions, between the app's pages and the account's: one line each, the one shown marked, then the way
 * to all of them. They take the height the rest of the menu leaves and scroll in it, so the menu's foot stays in
 * sight. A history that could not be read leaves no empty section behind.
 */
function RecentSessions({ current, hosted }: { current: string | null; hosted: boolean }) {
  const { t, i18n } = useTranslation();
  const { sessions, status } = useSessions();
  const headingId = useId();
  if (status === "failed" && sessions.length === 0) return null;
  const date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
  const recent = sessions.slice(0, RECENT_COUNT);
  return (
    <nav className="sidebar-recent" aria-labelledby={headingId}>
      <h2 className="nav-group-label" id={headingId}>
        {t("nav.recent")}
      </h2>
      <div className="recent-scroll">
        {recent.length > 0 ? (
          <>
            <ul className="recent-list" aria-label={hosted ? t("host.recentDebates") : t("nav.recentSessions")}>
              {recent.map((item) => (
                <li key={item.id}>
                  <a
                    className="recent-link"
                    href={`#/s/${item.id}`}
                    title={item.idea}
                    aria-current={item.id === current ? "page" : undefined}
                  >
                    <span className={`phase-dot phase-${item.phase}`} aria-hidden="true" />
                    <span className="recent-title" dir="auto">
                      {item.idea}
                    </span>
                    <span className="visually-hidden">, {t(`phase.${item.phase}`)}, </span>
                    <time className="recent-date" dateTime={item.updatedAt}>
                      {date.format(new Date(item.updatedAt))}
                    </time>
                  </a>
                </li>
              ))}
            </ul>
            <a className="recent-all" href="#/sessions">
              {hosted ? t("host.seeAllDebates") : t("nav.seeAllSessions")}
            </a>
          </>
        ) : status === "ready" ? (
          <p className="recent-empty">{hosted ? t("host.noDebates") : t("nav.noRecent")}</p>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * The menu, in three parts: on top, a new session and the app's pages (the sessions, the decisions, the gallery, the
 * settings); in the middle, the latest sessions, in the height left; at the bottom, the host's pages, the person and
 * the menu's foot. Hosted, it is the menu of the host's screens, so it stays the same from one side to the other: the
 * workspace on top, the app's pages under the debates, then the latest debates, then the host's pages and the person.
 */
function Sidebar({ current, host }: { current: string | null; host: HostNavigation | null | undefined }) {
  const { t } = useTranslation();
  const { sessions } = useSessions();
  const hosted = host !== null;
  const newLabel = hosted ? t("host.newDebate") : t("nav.newSession");
  const page = (path: string, label: string, icon: ReactNode) => (
    <a className="nav-link" href={`#/${path}`} aria-current={current === path ? "page" : undefined}>
      {icon}
      {label}
    </a>
  );
  const pages = (
    <>
      {page("sessions", hosted ? t("host.allDebates") : t("nav.sessions"), <DebatesIcon />)}
      {page("decisions", t("nav.decisions"), <RegisterIcon />)}
      {page("gallery", t("nav.gallery"), <GalleryIcon />)}
      {page("settings", t("nav.settings"), <SettingsIcon />)}
    </>
  );

  return (
    <div className="sidebar-inner">
      <a className="brand" href="#/" aria-label={`Quorumind, ${newLabel}`}>
        <Mark busy={sessions.some((item) => item.phase === "debating")} />
        <span>quorumind</span>
      </a>
      {/* Until the host's part of the menu comes, the place of its workspace is kept. */}
      {host === undefined ? (
        <div className="workspace-switch workspace-pending" aria-hidden="true" />
      ) : host?.workspaces ? (
        <WorkspaceSwitch workspaces={host.workspaces} />
      ) : null}
      <a className="button button-primary new-session" href="#/">
        <PlusIcon />
        {newLabel}
      </a>
      <nav className="sidebar-nav" aria-label={t("host.main")}>
        {hosted ? (
          <div className="nav-group">
            <h2 className="nav-group-label">{t("host.debates")}</h2>
            {pages}
          </div>
        ) : (
          pages
        )}
      </nav>
      <RecentSessions current={current} hosted={hosted} />
      <div className="sidebar-bottom">
        {host && host.links.length > 0 ? (
          <nav className="sidebar-nav" aria-label={t("host.group")}>
            <HostLinks links={host.links} />
          </nav>
        ) : null}
        {host ? <HostUser user={host.user} signOut={host.signOut ?? null} /> : null}
        <div className="sidebar-foot sidebar-foot-host">
          {host?.siteUrl ? <SiteLink url={host.siteUrl} /> : null}
          <LanguageSelect id="language" />
          <ThemeButton />
        </div>
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
  const host = useHostNavigation();
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
  ) : route === "sessions" ? (
    <Sessions hosted={host !== null} />
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
          <Sidebar current={sessionId ?? route} host={host} />
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
