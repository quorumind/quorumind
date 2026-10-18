import type { ModelOption } from "@quorumind/core";
import type { TFunction } from "i18next";

const GATEWAYS: Record<string, string> = { openrouter: "OpenRouter" };

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

/** Who serves a group of models in the pickers: the vendor, or the maker and the gateway that resells it. */
export function groupLabel(option: ModelOption, t: TFunction): string {
  if (!option.maker) return option.label.split(" · ")[0] ?? option.provider;
  return t("setup.viaGateway", { maker: option.maker, gateway: GATEWAYS[option.provider] ?? option.provider });
}
