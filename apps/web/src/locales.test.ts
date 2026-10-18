import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "@quorumind/core/locales";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "locales");
const load = (code: string) => JSON.parse(readFileSync(join(dir, `${code}.json`), "utf8")) as Record<string, unknown>;

function keys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

function placeholders(text: string) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

function value(node: Record<string, unknown>, path: string): string {
  return path.split(".").reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], node) as string;
}

// The codes the API answers with, or stores on a failed session: the interface explains each one (errors.ts). The
// hosted version relies on the codes of its own refusals (insufficient_credits…) being translated here.
const ERROR_CODES = [
  "generic",
  "internal_error",
  "invalid_request",
  "too_large",
  "unauthorized",
  "not_found",
  "live_unavailable",
  "idea_missing",
  "challenge_missing",
  "invalid_lineup",
  "session_busy",
  "wrong_phase",
  "read_only",
  "brief_missing",
  "budget_exceeded",
  "provider_error",
  "provider_auth",
  "provider_quota",
  "provider_rate_limit",
  "provider_unavailable",
  "provider_refused",
  "stopped",
  "not_running",
  "interrupted",
  "budget_fixed",
  "share_expired",
  "password_required",
  "wrong_password",
  "too_many_attempts",
  "insufficient_credits",
  "plan_limit",
  "price_limit",
  "seat_limit",
];

describe("interface translations", () => {
  const english = load("en");
  const englishKeys = keys(english).sort();

  it("explains every error code of the API", () => {
    const explained = Object.keys(english.errors as Record<string, string>);
    expect(ERROR_CODES.filter((code) => !explained.includes(code))).toEqual([]);
  });

  it("has one file per supported language", () => {
    const files = readdirSync(dir)
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual(LOCALES.map((locale) => locale.code).sort());
  });

  it.each(LOCALES.map((locale) => locale.code))("%s has exactly the English keys", (code) => {
    expect(keys(load(code)).sort()).toEqual(englishKeys);
  });

  it.each(LOCALES.map((locale) => locale.code))("%s keeps every placeholder", (code) => {
    const translated = load(code);
    for (const key of englishKeys) {
      expect(placeholders(value(translated, key)), `${code}: ${key}`).toEqual(placeholders(value(english, key)));
      expect(value(translated, key).trim(), `${code}: ${key}`).not.toBe("");
    }
  });
});
