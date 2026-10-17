import { isLocale } from "@quorumind/core/locales";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SessionSummary } from "./api.ts";
import { CrossIcon, GalleryIcon, MenuIcon, MonitorIcon, MoonIcon, PlusIcon, SettingsIcon, SunIcon } from "./components/Icons.tsx";
import { Mark } from "./components/Logo.tsx";
import { Gallery } from "./Gallery.tsx";
import { LOCALES } from "./i18n.ts";
import { NewSession } from "./NewSession.tsx";
import { SessionView, SharedView } from "./SessionView.tsx";
import { Settings } from "./Settings.tsx";
import { type ThemeChoice, useTheme } from "./theme.ts";

const readRoute = () => window.location.hash.replace(/^#\/?/, "");

function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
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
}

const SessionsContext = createContext<SessionsState>({ sessions: [], refresh: () => {}, upsert: () => {} });
export const useSessions = () => useContext(SessionsContext);

function useSessionList(): SessionsState {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const refresh = useCallback(() => {
    api.sessions().then(
      (body) => setSessions(body.sessions),
      () => undefined,
    );
  }, []);
  const upsert = useCallback((summary: SessionSummary) => {
    setSessions((current) => {
      const existing = current.find((item) => item.id === summary.id);
      if (existing && existing.phase === summary.phase && existing.idea === summary.idea) return current;
      return [summary, ...current.filter((item) => item.id !== summary.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);
  useEffect(refresh, [refresh]);
  return { sessions, refresh, upsert };
}

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

function Sidebar({ current }: { current: string | null }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useTheme();
  const { sessions } = useSessions();
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
        {sessions.length === 0 ? (
          <p className="field-hint">{t("nav.noSessions")}</p>
        ) : (
          <ul>
            {sessions.map((item) => (
              <li key={item.id}>
                <a href={`#/s/${item.id}`} aria-current={item.id === current ? "page" : undefined}>
                  <span className="session-title">{item.idea}</span>
                  <span className="session-meta">
                    <span className={`phase-dot phase-${item.phase}`} />
                    {t(`phase.${item.phase}`)} · {date.format(new Date(item.updatedAt))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <nav className="sidebar-links" aria-label={t("nav.more")}>
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
        <label className="visually-hidden" htmlFor="language">
          {t("nav.language")}
        </label>
        <select
          id="language"
          className="select"
          value={i18n.language}
          onChange={(event) => {
            if (isLocale(event.target.value)) i18n.changeLanguage(event.target.value);
          }}
        >
          {LOCALES.map((locale) => (
            <option key={locale.code} value={locale.code} lang={locale.code}>
              {locale.nativeName}
            </option>
          ))}
        </select>
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
  const { t } = useTranslation();
  const route = useRoute();
  const sessionsState = useSessionList();
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionId = route.startsWith("s/") ? route.slice(2) : null;
  const sharedToken = route.startsWith("shared/") ? route.slice(7) : null;
  const page = sessionId ? (
    <SessionView key={sessionId} id={sessionId} />
  ) : sharedToken ? (
    <SharedView key={sharedToken} token={sharedToken} />
  ) : route === "gallery" ? (
    <Gallery />
  ) : route === "settings" ? (
    <Settings />
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
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [menuOpen]);

  return (
    <SessionsContext.Provider value={sessionsState}>
      <div className="app" data-menu={menuOpen ? "open" : "closed"}>
        <header className="mobile-bar">
          <a className="brand" href="#/">
            <Mark />
            <span>quorumind</span>
          </a>
          <button
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
        <aside className="sidebar" id="sidebar">
          <Sidebar current={sessionId ?? route} />
        </aside>
        <main className="main">
          <div className="page">{page}</div>
          <footer className="footer">{t("app.footer")}</footer>
        </main>
      </div>
    </SessionsContext.Provider>
  );
}
