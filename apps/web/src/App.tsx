import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HostNavigation, type SessionSummary } from "./api.ts";
import { AccountMenu, SiteLink, WorkspaceSwitch } from "./components/HostMenu.tsx";
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
import { markNavigation, PageHeading } from "./components/Page.tsx";
import { type Loaded, nextLoad, withoutRepeats } from "./components/ShowMore.tsx";
import { isWizardStep, NewSession } from "./NewSession.tsx";
import { type ThemeChoice, useTheme } from "./theme.ts";
import { waitsForYou } from "./yourMove.ts";

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

/** An address inside the app, after `#/`: its path's segments and its query (`#/s/<id>/debate`, `#/?demo=1`). */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

/** Reads an address: empty segments (a trailing or doubled slash) are dropped, so `#/sessions/` is the sessions. */
export function parseRoute(raw: string): Route {
  const text = raw.replace(/^#?\/?/, "");
  const at = text.indexOf("?");
  const segments = (at === -1 ? text : text.slice(0, at)).split("/").filter(Boolean);
  return { path: segments.join("/"), segments, query: new URLSearchParams(at === -1 ? "" : text.slice(at + 1)) };
}

/** An address in its one written form: without a stray slash. */
function canonicalRoute(hash: string) {
  const raw = hash.replace(/^#\/?/, "");
  const at = raw.indexOf("?");
  return { raw, canonical: parseRoute(raw).path + (at === -1 ? "" : raw.slice(at)) };
}

/**
 * The address a change led to (`hash`, by default the one shown). The one shown, written with a stray slash, is
 * rewritten in place, without a new entry.
 */
function readRoute(hash = window.location.hash) {
  const { raw, canonical } = canonicalRoute(hash);
  if (canonical !== raw && hash === window.location.hash) window.history.replaceState(window.history.state, "", `#/${canonical}`);
  return canonical;
}

/** Said by replaceRoute: the address changed in place, the page follows it without moving the focus. */
const ROUTE_REPLACED = "quorumind:route";

/**
 * The address shown, and how many times the person moved since the app opened (`moves`): a page that follows the
 * address within itself (the new debate's steps) hears every move, even two that end on the address it started from.
 */
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    const onChange = (event: HashChangeEvent) => {
      // The heading of the page navigated to takes the focus, for screen readers to say where the person is.
      markNavigation();
      setMoves((count) => count + 1);
      // Each change is read from its own event, in order: two changes made in quick succession (a step of the new
      // debate, then Back) are both seen even when the second came before the first was handled.
      setRoute(readRoute(event.newURL ? new URL(event.newURL).hash : window.location.hash));
    };
    const onReplace = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener(ROUTE_REPLACED, onReplace);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener(ROUTE_REPLACED, onReplace);
    };
  }, []);
  return { route, moves };
}

export function navigate(path: string) {
  window.location.hash = path ? `/${path}` : "/";
  window.scrollTo({ top: 0 });
}

/**
 * Writes where the person is on the same page (the tab of a session) into the address, in place of the current
 * entry: a reload or a copied link opens there, the browser's Back still leaves the page, and the focus stays put.
 */
export function replaceRoute(path: string) {
  const target = `#/${path}`;
  if (window.location.hash === target) return;
  window.history.replaceState(window.history.state, "", target);
  window.dispatchEvent(new Event(ROUTE_REPLACED));
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
  /** The cursor of the page after those loaded (null when they are all), and what asking for it is doing. */
  next: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
  more: () => void;
  loaded: Loaded | null;
}

const SessionsContext = createContext<SessionsState>({
  sessions: [],
  refresh: () => {},
  upsert: () => {},
  shared: false,
  mine: false,
  setMine: () => {},
  status: "loading",
  next: null,
  loadingMore: false,
  moreFailed: false,
  more: () => {},
  loaded: null,
});
export const useSessions = () => useContext(SessionsContext);

const sessionId = (item: SessionSummary) => item.id;

function useSessionList(): SessionsState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [shared, setShared] = useState(false);
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState<SessionsState["status"]>("loading");
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const listed = useRef(sessions);
  listed.current = sessions;
  const cursor = useRef<string | null>(null);
  cursor.current = next;
  // Whose sessions the list holds (Everyone or Mine): older pages are kept only across a refresh of the same list.
  const listedFor = useRef(mine);
  // Only the latest request's answer is shown: switching between Everyone and Mine quickly keeps the last choice.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    busy.current = false;
    setLoadingMore(false);
    api.sessions({ mine }).then(
      (body) => {
        if (request !== latest.current) return;
        const first = body.sessions;
        const last = first.at(-1);
        // Coming back to the tab asks for the first page again; the older pages already loaded stay below it.
        const older =
          listedFor.current === mine && last && (body.next ?? null) !== null
            ? listed.current.filter((item) => item.updatedAt < last.updatedAt || (item.updatedAt === last.updatedAt && item.id < last.id))
            : [];
        listedFor.current = mine;
        setSessions(older.length > 0 ? withoutRepeats([...first, ...older], sessionId) : first);
        setNext(older.length > 0 ? cursor.current : (body.next ?? null));
        setShared(body.shared ?? false);
        setStatus("ready");
      },
      () => {
        if (request === latest.current) setStatus("failed");
      },
    );
  }, [mine]);
  // A page being asked for, whatever React has rendered yet: a second click in the same tick asks nothing.
  const busy = useRef(false);
  const more = useCallback(() => {
    if (next === null || busy.current) return;
    busy.current = true;
    const request = latest.current;
    setLoadingMore(true);
    setMoreFailed(false);
    api.sessions({ mine, before: next }).then(
      (body) => {
        if (request !== latest.current) return;
        busy.current = false;
        const before = listed.current.length;
        const merged = withoutRepeats([...listed.current, ...body.sessions], sessionId);
        setSessions(merged);
        setLoaded({ from: before, added: merged.length - before, total: merged.length, seq: nextLoad() });
        setNext(body.next ?? null);
        setLoadingMore(false);
      },
      () => {
        if (request !== latest.current) return;
        busy.current = false;
        setLoadingMore(false);
        setMoreFailed(true);
      },
    );
  }, [mine, next]);
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
  return { sessions, refresh, upsert, shared, mine, setMine, status, next, loadingMore, moreFailed, more, loaded };
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

type TFunction = ReturnType<typeof useTranslation>["t"];

/**
 * What a session of the menu waits for, in a word, while it is not done: the person's answers or approval when it is
 * theirs (`yours`), its author's move when it is someone else's, a debate running, a debate stopped.
 */
function recentStatus(item: SessionSummary, t: TFunction): { label: string; yours: boolean } | null {
  const yours = waitsForYou(item);
  switch (item.phase) {
    case "interview":
    case "awaiting_answers":
      return yours ? { label: t("recent.toAnswer"), yours } : { label: t("recent.authorsTurn"), yours };
    case "review":
      return yours ? { label: t("recent.toCheck"), yours } : { label: t("recent.authorsTurn"), yours };
    case "debating":
      return { label: t("recent.running"), yours: false };
    case "failed":
      return { label: t("phase.failed"), yours: false };
    default:
      return null;
  }
}

/**
 * The latest sessions, between the app's pages and the bottom of the menu: one line each, the one shown marked, then
 * the way to all of them. Those waiting for the person come first, each saying what it waits for; two sessions of the
 * same name are told apart by their time. They take the height the rest of the menu leaves and scroll in it, so the
 * menu's foot stays in sight. A history that could not be read leaves no empty section behind.
 */
function RecentSessions({ current, hosted }: { current: string | null; hosted: boolean }) {
  const { t, i18n } = useTranslation();
  const { sessions, status } = useSessions();
  const headingId = useId();
  if (status === "failed" && sessions.length === 0) return null;
  const date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "numeric", minute: "2-digit" });
  const listed = sessions.map((item) => ({ item, status: recentStatus(item, t) }));
  const recent = [...listed.filter((entry) => entry.status?.yours), ...listed.filter((entry) => !entry.status?.yours)].slice(
    0,
    RECENT_COUNT,
  );
  const named = new Map<string, number>();
  for (const { item } of recent) named.set(item.idea.trim().toLowerCase(), (named.get(item.idea.trim().toLowerCase()) ?? 0) + 1);
  return (
    <nav className="sidebar-recent" aria-labelledby={headingId}>
      <h2 className="nav-group-label" id={headingId}>
        {t("nav.recent")}
      </h2>
      <div className="recent-scroll">
        {recent.length > 0 ? (
          <>
            <ul className="recent-list" aria-label={hosted ? t("host.recentDebates") : t("nav.recentSessions")}>
              {recent.map(({ item, status: waiting }) => {
                const twin = (named.get(item.idea.trim().toLowerCase()) ?? 0) > 1;
                return (
                  <li key={item.id}>
                    <a
                      className="recent-link"
                      href={`#/s/${item.id}`}
                      title={item.idea}
                      aria-current={item.id === current ? "page" : undefined}
                    >
                      <span className={`phase-dot phase-${item.phase}`} data-yours={waiting?.yours || undefined} aria-hidden="true" />
                      <span className="recent-text">
                        <span className="recent-title" dir="auto">
                          {item.idea}
                        </span>
                        {waiting || twin ? (
                          <span className="recent-meta">
                            {waiting ? (
                              <span className="recent-status" data-yours={waiting.yours || undefined}>
                                <span className="visually-hidden">, </span>
                                {waiting.label}
                              </span>
                            ) : (
                              <span className="visually-hidden">, {t(`phase.${item.phase}`)}</span>
                            )}
                            {/* Two sessions of the same name: the time tells them apart. */}
                            {twin ? (
                              <span className="recent-time">
                                <span className="visually-hidden">, </span>
                                {time.format(new Date(item.updatedAt))}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="visually-hidden">, {t(`phase.${item.phase}`)}</span>
                        )}
                      </span>
                      <span className="visually-hidden">, </span>
                      <time className="recent-date" dateTime={item.updatedAt}>
                        {date.format(new Date(item.updatedAt))}
                      </time>
                    </a>
                  </li>
                );
              })}
            </ul>
            <a className="recent-all" href="#/sessions">
              {hosted ? t("host.seeAllDebates") : t("nav.seeAllSessions")}
            </a>
          </>
        ) : status === "ready" ? (
          <p className="recent-empty">{hosted ? t("host.noDebates") : t("nav.noRecent")}</p>
        ) : (
          // The list is on its way: rows in its shape rather than an empty section that fills in with a jump.
          <ul className="recent-list recent-ghosts" aria-hidden="true">
            {["a", "b", "c", "d"].map((key) => (
              <li key={key}>
                <span className="recent-link">
                  <span className="skeleton-line recent-ghost" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

/**
 * The menu, in three parts: on top, a new session and the app's pages (the sessions, the decisions, the gallery, the
 * settings); in the middle, the latest sessions, in the height left; at the bottom, the menu's foot. Hosted, it is the
 * menu of the host's screens, so it stays the same from one side to the other: the workspace on top, whose menu
 * switches to another one and opens the workspace's pages, the app's pages under the debates, then the latest
 * debates, then the person, whose card opens the person's pages and the way to sign out, above the menu's foot.
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
        <WorkspaceSwitch navigation={host} />
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
        {/* Until the host's part of the menu comes, the place of the person is kept too. */}
        {host === undefined ? (
          <div className="account-switch account-pending" aria-hidden="true" />
        ) : host ? (
          <AccountMenu navigation={host} />
        ) : null}
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
  const { route: hash, moves } = useRoute();
  const route = parseRoute(hash);
  const [head, token = "", tab] = route.segments;
  // A questionnaire link is the client's page alone, and a share link the shared session alone: none of the app
  // around them, whose history lists the sessions of the server. A shared session's tab is in its address too.
  if (head === "q") {
    return (
      <PageLoader>
        <ClientQuestionnaire key={token} token={token} />
      </PageLoader>
    );
  }
  if (head === "shared") {
    return (
      <PageLoader>
        <SharedView key={token} token={token} tab={tab} />
      </PageLoader>
    );
  }
  return <Shell route={route} moves={moves} />;
}

/** An address that leads to no page: said as such, with the two ways on, rather than another page in its place. */
function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="narrow stack-lg not-found">
      <div className="stack">
        <PageHeading title={t("notFound.pageTitle")} />
        <p className="lead">{t("notFound.pageLead")}</p>
      </div>
      <div className="row">
        <a className="button button-primary" href="#/">
          <PlusIcon />
          {t("notFound.newDebate")}
        </a>
        <a className="button button-secondary" href="#/sessions">
          {t("notFound.debates")}
        </a>
      </div>
    </div>
  );
}

function Shell({ route, moves }: { route: Route; moves: number }) {
  const { t } = useTranslation();
  const sessionsState = useSessionList();
  const host = useHostNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const { path, segments, query } = route;
  const [head, second, third] = segments;
  // A session, and the tab shown: #/s/<id> opens the tab of its phase, #/s/<id>/<tab> that one.
  const sessionId = head === "s" && second && segments.length <= 3 ? second : null;
  // The new session's first step is the home page; each next step has its address (#/new/<step>).
  const wizard = path === "" || (head === "new" && segments.length <= 2 && (!second || isWizardStep(second)));
  const page = sessionId ? (
    <SessionView key={sessionId} id={sessionId} tab={third} />
  ) : wizard ? (
    <NewSession step={second} moves={moves} demo={query.get("demo") === "1"} />
  ) : path === "gallery" ? (
    <Gallery />
  ) : path === "settings" ? (
    <Settings />
  ) : path === "decisions" ? (
    <Register />
  ) : path === "sessions" ? (
    <Sessions hosted={host !== null} />
  ) : (
    // Keyed by its address: another wrong address is another page, whose heading takes the focus again.
    <NotFound key={path} />
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
          <Sidebar current={sessionId ?? path} host={host} />
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
