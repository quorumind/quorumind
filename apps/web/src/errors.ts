import type { SessionError } from "@quorumind/core/session";
import i18n, { type TFunction } from "i18next";
import { ApiError, showsProviderCosts } from "./api.ts";
import { formatUsd } from "./format.ts";

/**
 * A failure in the person's language, from its stable code (`errors.<code>`) and its parameters. A code the
 * interface does not know yet gets the generic message: the English message is meant for API users, not here.
 */
export function errorText(t: TFunction, code: string | undefined, params: Record<string, unknown> = {}): string {
  const key = `errors.${code}`;
  return code && i18n.exists(key) ? t(key, params) : t("errors.generic");
}

/** The failures of a model provider that only the server's operator can fix: its account, its keys, its access. */
const OPERATOR_SIDE = new Set(["provider_auth", "provider_quota", "provider_unavailable"]);

/**
 * The code to explain: a hosted service's customers have no key nor provider account to check, so a provider failure
 * only the host can fix is explained as the service's own.
 */
const explained = (code: string, providerCosts: boolean) => (!providerCosts && OPERATOR_SIDE.has(code) ? "provider_hosted" : code);

/** What a failed request means for the person: the server's code, or a connection problem. */
export function failureText(t: TFunction, caught: unknown): string {
  if (caught instanceof ApiError && caught.status > 0) return errorText(t, explained(caught.code, showsProviderCosts()), caught.params);
  return t("error.request");
}

/**
 * Why a session stopped. A host that keeps provider costs to itself sells each debate with a cost cap of its own:
 * reaching it is explained as the price's limit, never as dollars, and a provider failure only it can fix as its own.
 */
export function sessionErrorText(t: TFunction, error: SessionError | null, providerCosts: boolean, language: string): string {
  if (!error) return t("errors.internal_error");
  if (error.code === "budget_exceeded" && !providerCosts) return t("errors.price_limit");
  const params: Record<string, unknown> = { ...error.params };
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith("Usd") && typeof value === "number") params[key] = formatUsd(value, language);
  }
  return errorText(t, explained(error.code, providerCosts), params);
}
