import { isLocale } from "@quorumind/core/locales";
import { useTranslation } from "react-i18next";
import { LOCALES, switchLanguage } from "../i18n.ts";

/** The language of the interface, each one named in itself. */
export function LanguageSelect({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        {t("nav.language")}
      </label>
      <select
        id={id}
        className="select"
        value={i18n.language}
        onChange={(event) => {
          if (isLocale(event.target.value)) void switchLanguage(event.target.value, true);
        }}
      >
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code} lang={locale.code}>
            {locale.nativeName}
          </option>
        ))}
      </select>
    </>
  );
}
