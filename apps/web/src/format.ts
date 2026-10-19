import type { ModelOption } from "@quorumind/core";
import { isLocale, localeInfo } from "@quorumind/core/locales";
import type { TFunction } from "i18next";

const GATEWAYS: Record<string, string> = { openrouter: "OpenRouter" };
const VENDORS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google", ollama: "Ollama", mock: "Demo" };

export function formatUsd(amount: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 1 ? 3 : 2,
  }).format(amount);
}

/** A price set by the host: without cents when it is a round amount (7 €), with them otherwise (7,50 €). */
export function formatPrice(amount: number, currency: string, locale: string) {
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits }).format(amount)} ${currency}`;
  }
}

export function formatMoney(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

/** A model's name as people know it, without the vendor its label may end with: "gpt-5 (OpenAI)" is "gpt-5". */
export function modelName(option: ModelOption): string {
  return option.maker ? option.label : option.label.replace(/ \([^()]*\)$/, "");
}

/** Who makes a model, and the gateway that resells it when there is one: "Anthropic", "Mistral via OpenRouter". */
export function vendorLabel(option: ModelOption, t: TFunction): string {
  return option.maker ? groupLabel(option, t) : (VENDORS[option.provider] ?? option.provider);
}

/** Who serves a group of models in the pickers: the vendor, or the maker and the gateway that resells it. */
export function groupLabel(option: ModelOption, t: TFunction): string {
  if (!option.maker) return option.label.split(" · ")[0] ?? option.provider;
  return t("setup.viaGateway", { maker: option.maker, gateway: GATEWAYS[option.provider] ?? option.provider });
}

/**
 * The language attributes of content written in a session's language (an audit, a compliance assessment), which may
 * differ from the interface's: read with the right voice, and laid out right to left for Arabic.
 */
export function contentLanguage(locale: string): { lang: string; dir: "ltr" | "rtl" | "auto" } {
  return isLocale(locale) ? { lang: locale, dir: localeInfo(locale).dir } : { lang: locale, dir: "auto" };
}
