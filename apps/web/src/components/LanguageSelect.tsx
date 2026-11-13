import { isLocale, type Locale } from "@quorumind/core/locales";
import { useTranslation } from "react-i18next";
import { LOCALES, switchLanguage } from "../i18n.ts";

/**
 * The language of the interface, each one named in itself. `remember`: kept as the person's language for their next
 * visits (false on a page opened from someone else's link); `onChange` hears the choice.
 */
export function LanguageSelect({ id, remember = true, onChange }: { id: string; remember?: boolean; onChange?: (locale: Locale) => void }) {
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
          if (!isLocale(event.target.value)) return;
          void switchLanguage(event.target.value, remember);
          onChange?.(event.target.value);
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
