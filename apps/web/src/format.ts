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
