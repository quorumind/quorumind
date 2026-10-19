import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale, localeInfo } from "@quorumind/core/locales";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

const STORAGE_KEY = "quorumind.locale";

type Translations = typeof en;

// English is bundled, as the fallback of every missing key; each other language is a file of its own, loaded when
// it is used.
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<{ default: Translations }>> = {
  fr: () => import("./locales/fr.json"),
  es: () => import("./locales/es.json"),
  pt: () => import("./locales/pt.json"),
  it: () => import("./locales/it.json"),
  de: () => import("./locales/de.json"),
  hi: () => import("./locales/hi.json"),
  ja: () => import("./locales/ja.json"),
  "zh-Hans": () => import("./locales/zh-Hans.json"),
  ar: () => import("./locales/ar.json"),
};

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

/** The document's language, direction and fonts. */
export function applyLocale(locale: Locale) {
  SCRIPT_FONTS[locale]?.().catch(() => undefined);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeInfo(locale).dir;
}

/** Loads the translations of a language once; English is always there. */
export async function loadLocale(locale: Locale): Promise<void> {
  if (locale === "en" || i18n.hasResourceBundle(locale, "translation")) return;
  const { default: translations } = await LOADERS[locale]();
  i18n.addResourceBundle(locale, "translation", translations);
}

/**
 * Shows the interface in another language. `remember` keeps the choice for the next visits: the person's own choice
 * does, the language a client's questionnaire is written in does not.
 */
export async function switchLanguage(locale: Locale, remember: boolean): Promise<void> {
  await loadLocale(locale);
  await i18n.changeLanguage(locale);
  if (!remember) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not critical: the choice simply won't be remembered.
  }
}

const locale = initialLocale();

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
applyLocale("en");
i18n.on("languageChanged", (next) => {
  if (isLocale(next)) applyLocale(next);
});

/** Resolves once the interface can be shown in the person's language (English when it cannot be loaded). */
export const ready: Promise<void> = locale === "en" ? Promise.resolve() : switchLanguage(locale, false).catch(() => undefined);

export { LOCALES };
export default i18n;
