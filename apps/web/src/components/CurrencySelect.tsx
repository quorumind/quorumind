import { currencyCode, currencyCodes } from "@quorumind/core/profile";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** The currencies most budgets are in, offered first. */
export const COMMON_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "INR",
  "BRL",
  "MXN",
  "AED",
  "SAR",
  "MAD",
  "XOF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
] as const;

const common: readonly string[] = COMMON_CURRENCIES;
/** Every other code the browser knows, in alphabetical order. */
const others = currencyCodes().filter((code) => !common.includes(code));

/**
 * A currency picked in a list of ISO 4217 codes, each with its name in the interface's language ("EUR — euro"): the
 * common ones first, then every other code the browser knows. A value that is not a currency (typed before the list
 * existed, such as "DOL") stays in the list, named as such and marked invalid, until another one is chosen.
 */
export function CurrencySelect({
  id,
  value,
  onChange,
  describedBy,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
  describedBy?: string;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const label = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([i18n.language], { type: "currency" });
    } catch {
      // Codes alone, where the browser cannot name currencies.
    }
    return (code: string) => {
      const name = names?.of(code);
      return name && name !== code ? `${code} — ${name}` : code;
    };
  }, [i18n.language]);
  const known = currencyCode(value) === value;
  const shown = value && !known && !common.includes(value) && !others.includes(value) ? value : null;

  return (
    <select
      id={id}
      className="select"
      value={value}
      disabled={disabled}
      aria-invalid={shown !== null || undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    >
      {shown ? <option value={shown}>{t("currency.unknown", { code: shown })}</option> : null}
      <optgroup label={t("currency.common")}>
        {common.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </optgroup>
      {others.length > 0 ? (
        <optgroup label={t("currency.others")}>
          {others.map((code) => (
            <option key={code} value={code}>
              {label(code)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
