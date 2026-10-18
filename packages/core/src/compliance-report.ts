import {
  activeRequirements,
  type ComplianceCheck,
  type ComplianceRequirement,
  type ComplianceStatus,
  verdictCompliance,
} from "./compliance.ts";
import { complianceLabels, type RequirementId } from "./compliance-labels.ts";
import type { Session } from "./session.ts";

// What the documents show of the compliance requirements, the European-only mode and the reference cloud prices: the
// compliance section of the report and the lines of its method box. Kept apart from report.ts, which calls in here.

export interface ComplianceRow {
  requirement: ComplianceRequirement;
  /** The requirement in one sentence, in the session's language. */
  label: string;
  /** The arbiter's check of each option, by seat; null when it assessed none. */
  checks: Record<string, ComplianceCheck | null>;
}

/** The compliance section of a session, or null when its verdict assessed no requirement. */
export function complianceRows(session: Session): { seats: string[]; rows: ComplianceRow[] } | null {
  const checks = verdictCompliance(session.verdict);
  if (!session.verdict || checks.length === 0) return null;
  const labels = complianceLabels(session.locale);
  const seats = session.verdict.options.map((option) => option.seat);
  const rows = activeRequirements(session).map((requirement) => ({
    requirement,
    label: labels.requirements[requirement.id as RequirementId] ?? requirement.text,
    checks: Object.fromEntries(
      seats.map((seat) => [seat, checks.find((check) => check.requirement === requirement.id && check.seat === seat) ?? null]),
    ),
  }));
  return { seats, rows };
}

export function statusName(status: ComplianceStatus | null, session: Pick<Session, "locale">): string {
  const labels = complianceLabels(session.locale);
  return status ? labels.status[status] : labels.notAssessed;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The compliance section in Markdown: a table of the requirements against the options, with the arbiter's reasons. */
export function complianceMarkdown(session: Session, seatLabel: (seat: string) => string): string[] {
  const section = complianceRows(session);
  if (!section) return [];
  const labels = complianceLabels(session.locale);
  const lines = [
    `## ${labels.heading}`,
    "",
    `_${labels.intro}_`,
    "",
    `| ${labels.requirement} | ${section.seats.map((seat) => cell(seatLabel(seat))).join(" | ")} |`,
    `| --- |${section.seats.map(() => " --- |").join("")}`,
  ];
  for (const row of section.rows) {
    const name = `${cell(row.label)}${row.requirement.hard ? ` _(${labels.hard})_` : ""}`;
    const cells = section.seats.map((seat) => {
      const check = row.checks[seat] ?? null;
      const status = `**${statusName(check?.status ?? null, session)}**`;
      return check?.reason ? `${status}: ${cell(check.reason)}` : status;
    });
    lines.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines;
}

const CHIPS: Record<ComplianceStatus, string> = {
  met: "feasible",
  partly: "conditional",
  not_met: "infeasible",
  not_applicable: "",
};

/** The compliance section of the HTML report, or an empty string. `esc` escapes text for HTML. */
export function complianceHtml(session: Session, seatLabel: (seat: string) => string, esc: (value: string) => string): string {
  const section = complianceRows(session);
  if (!section) return "";
  const labels = complianceLabels(session.locale);
  const head = section.seats.map((seat) => `<th scope="col">${esc(seatLabel(seat))}</th>`).join("");
  const body = section.rows
    .map((row) => {
      const name = `${esc(row.label)}${row.requirement.hard ? ` <span class="muted">(${esc(labels.hard)})</span>` : ""}`;
      const cells = section.seats
        .map((seat) => {
          const check = row.checks[seat] ?? null;
          const chip = `<span class="chip ${check ? CHIPS[check.status] : ""}">${esc(statusName(check?.status ?? null, session))}</span>`;
          return `<td>${chip}${check?.reason ? ` ${esc(check.reason)}` : ""}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${name}</th>${cells}</tr>`;
    })
    .join("");
  return `<section class="compliance"><h2>${esc(labels.heading)}</h2><p class="muted">${esc(labels.intro)}</p><div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(labels.requirement)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

/** The lines the method box adds: the European-only mode and how it was routed, and the date of the reference prices. */
export function sovereigntyNotes(session: Session): string[] {
  const labels = complianceLabels(session.locale);
  const notes: string[] = [];
  if (session.european) {
    const route = session.european.gateway;
    const gateway = route === "eu" ? labels.gatewayEu : route === "global" ? labels.gatewayGlobal : null;
    notes.push(gateway ? `${labels.europeanOnly} ${gateway}` : labels.europeanOnly);
  }
  if (session.priceReference) notes.push(fill(labels.priceReference, { date: session.priceReference.asOf }));
  return notes;
}
