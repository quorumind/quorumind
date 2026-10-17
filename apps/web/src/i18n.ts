import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale, localeInfo } from "@quorumind/core/locales";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./locales/ar.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import hi from "./locales/hi.json";
import it from "./locales/it.json";
import ja from "./locales/ja.json";
import pt from "./locales/pt.json";
import zhHans from "./locales/zh-Hans.json";

const STORAGE_KEY = "quorumind.locale";

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode); fall back to the browser language.
  }
  for (const language of navigator.languages ?? [navigator.language]) {
    if (isLocale(language)) return language;
    const base = language.split("-")[0];
    if (base === "zh") return "zh-Hans";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

// Fonts for non-Latin scripts are large, so each is loaded only when its language is used.
const SCRIPT_FONTS: Partial<Record<Locale, () => Promise<unknown>>> = {
  ar: () => Promise.all([import("@fontsource/ibm-plex-sans-arabic/400.css"), import("@fontsource/ibm-plex-sans-arabic/600.css")]),
  hi: () => Promise.all([import("@fontsource/noto-sans-devanagari/400.css"), import("@fontsource/noto-sans-devanagari/600.css")]),
  ja: () => Promise.all([import("@fontsource/noto-sans-jp/400.css"), import("@fontsource/noto-sans-jp/600.css")]),
  "zh-Hans": () => Promise.all([import("@fontsource/noto-sans-sc/400.css"), import("@fontsource/noto-sans-sc/600.css")]),
};

export function applyLocale(locale: Locale) {
  SCRIPT_FONTS[locale]?.().catch(() => undefined);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeInfo(locale).dir;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not critical: the choice simply won't be remembered.
  }
}

const locale = initialLocale();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    pt: { translation: pt },
    it: { translation: it },
    de: { translation: de },
    hi: { translation: hi },
    ja: { translation: ja },
    "zh-Hans": { translation: zhHans },
    ar: { translation: ar },
  },
  lng: locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

applyLocale(locale);
i18n.on("languageChanged", (next) => {
  if (isLocale(next)) applyLocale(next);
});

export { LOCALES };
export default i18n;
