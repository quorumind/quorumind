import { isLocale } from "@quorumind/core/locales";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MonitorIcon, MoonIcon, SunIcon } from "./components/Icons.tsx";
import { Mark } from "./components/Logo.tsx";
import { Home } from "./Home.tsx";
import { LOCALES } from "./i18n.ts";
import { SessionView } from "./SessionView.tsx";
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

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

export function App() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useTheme();
  const route = useRoute();
  const sessionId = route.startsWith("s/") ? route.slice(2) : null;
  const themeLabel = { system: t("nav.themeSystem"), light: t("nav.themeLight"), dark: t("nav.themeDark") }[theme];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/" aria-label={`Quorumind, ${t("nav.home")}`}>
            <Mark />
            <span>quorumind</span>
          </a>
          <div className="topbar-tools">
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
      </header>
      <main className="page">{sessionId ? <SessionView id={sessionId} /> : <Home />}</main>
      <footer className="footer">{t("app.footer")}</footer>
    </div>
  );
}
