import type { RequirementsSheet } from "@quorumind/core";
import type { TFunction } from "i18next";
import { formatMoney } from "./format.ts";

// The structured fields of a requirements sheet as short sentences, for the read-only views.

const count = (value: number, locale: string) => value.toLocaleString(locale);

export function budgetText(sheet: RequirementsSheet, t: TFunction, locale: string): string {
  const { build, run, note } = sheet.budget;
  const parts = [
    build ? `${t("review.fields.buildBudget")}: ${formatMoney(build.amount, build.currency, locale)}` : "",
    run
      ? `${t("review.fields.runBudget")}: ${t(`review.per.${run.period}`, { amount: formatMoney(run.amount, run.currency, locale) })}`
      : "",
  ].filter(Boolean);
  return [parts.join(" · "), note.trim()].filter(Boolean).join(". ");
}

export function usersText(sheet: RequirementsSheet, t: TFunction, locale: string): string {
  const { launch, oneYear, note } = sheet.users;
  const parts = [
    launch !== null ? t("review.usersLaunch", { count: count(launch, locale) }) : "",
    oneYear !== null ? t("review.usersYear", { count: count(oneYear, locale) }) : "",
  ].filter(Boolean);
  return [parts.join(", "), note.trim()].filter(Boolean).join(". ");
}

export function teamText(sheet: RequirementsSheet, t: TFunction, locale: string): string {
  const { people, skills, note } = sheet.team;
  const head = [people !== null ? t("review.teamSize", { count: count(people, locale) }) : "", skills.join(", ")]
    .filter(Boolean)
    .join(": ");
  return [head, note.trim()].filter(Boolean).join(". ");
}

export function deadlineText(sheet: RequirementsSheet, t: TFunction, locale: string): string {
  const { date, duration, note } = sheet.deadline;
  const parsed = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  const head = Number.isFinite(parsed)
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed)
    : duration
      ? t(`review.duration.${duration.unit}`, { count: count(duration.amount, locale) })
      : "";
  return [head, note.trim()].filter(Boolean).join(". ");
}
