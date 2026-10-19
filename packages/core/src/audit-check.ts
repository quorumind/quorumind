// The arithmetic and the checks of an audit, done by the code: the document's figures recomputed, its total against
// the budget and its timeline against the deadline, and every passage a model quotes checked against the document
// itself. Browser-safe: the schemas are imported as types only.

import type { AuditCritiqueInput, AuditExtraction, AuditedVerdict, AuditFinding, AuditReport, ChecklistItem } from "./audit.ts";
import { AUDIT_CHECKLIST } from "./audit-constants.ts";
import { availableWeeks } from "./costing.ts";
import { redact } from "./privacy.ts";
import { currencyCode } from "./profile.ts";
import type { Proposal, Severity, Verdict } from "./schemas.ts";
import { type ContextDocument, type Session, USER_SEAT } from "./session.ts";

/** The audit of a verdict, when it is the verdict of an audit session. */
export function auditOf(verdict: Verdict | null | undefined): AuditReport | null {
  return (verdict as Partial<AuditedVerdict> | null | undefined)?.audit ?? null;
}

/** The attached documents under audit. */
export function auditedDocuments(session: Pick<Session, "audit" | "context">): ContextDocument[] {
  const ids = new Set(session.audit?.documentIds ?? []);
  return session.context.filter((doc) => ids.has(doc.id));
}

/** The other attached documents: background the person gave, such as their own specification. */
export function backgroundDocuments(session: Pick<Session, "audit" | "context">): ContextDocument[] {
  const ids = new Set(session.audit?.documentIds ?? []);
  return session.context.filter((doc) => !ids.has(doc.id));
}

// Quotes are compared without case, accents of typography, emphasis marks or line breaks: a model copying a PDF's text
// rarely keeps its curly quotes, its non-breaking spaces or its Markdown.
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[*_#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether a passage a model quotes is in one of the documents, word for word. An elided quote ("first part … last
 * part") matches when its parts appear in that order.
 */
export function findQuote(documents: ContextDocument[], quote: string): boolean {
  const parts = quote
    .split(/…|\.\.\.|\[\s*(?:…|\.\.\.)\s*\]/)
    .map(normalize)
    .map((part) => part.replace(/^["'\s]+|["'\s]+$/g, ""))
    .filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  const inOrder = (text: string) => {
    let from = 0;
    for (const part of parts) {
      const at = text.indexOf(part, from);
      if (at < 0) return false;
      from = at + part.length;
    }
    return true;
  };
  // A session that masks personal data shows the models the document masked: their quotes carry "[email]", "[iban]"…
  const masked = /\[(?:email|iban|card|phone|ip|secret)\]/.test(quote);
  return documents.some((doc) => inOrder(normalize(doc.text)) || (masked && inOrder(normalize(redact(doc.text)))));
}

/** Keeps a quote only when it is really in the documents: a passage shown as quoted is always the document's own. */
const verified = (documents: ContextDocument[], quote: string) => (quote.trim() && findQuote(documents, quote) ? quote.trim() : "");

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, major: 1, minor: 2 };

/** Orders findings from the most serious, keeping the order of the arbiter within a severity. */
export function bySeverity<T extends { severity: Severity }>(items: T[]): T[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const finite = (value: number | null): number | null => (value !== null && Number.isFinite(value) && value >= 0 ? value : null);

/** The extraction as stored: unverifiable quotes emptied, impossible figures dropped, the currency as an ISO code. */
export function settleExtraction(extraction: AuditExtraction, documents: ContextDocument[]): AuditExtraction {
  const weeks = finite(extraction.timeline.weeks);
  return {
    ...extraction,
    currency: currencyCode(extraction.currency) ?? null,
    workPackages: extraction.workPackages.map((line) => ({
      ...line,
      days: finite(line.days),
      dailyRate: finite(line.dailyRate),
      amount: finite(line.amount),
      quote: verified(documents, line.quote),
    })),
    dayRates: extraction.dayRates
      .filter((rate) => finite(rate.dailyRate) !== null)
      .map((rate) => ({ ...rate, quote: verified(documents, rate.quote) })),
    total: { ...extraction.total, amount: finite(extraction.total.amount), quote: verified(documents, extraction.total.quote) },
    monthlyCost: { amount: finite(extraction.monthlyCost.amount), quote: verified(documents, extraction.monthlyCost.quote) },
    timeline: { ...extraction.timeline, weeks: weeks && weeks > 0 ? weeks : null, quote: verified(documents, extraction.timeline.quote) },
  };
}

/** A critic's findings as critiques of the document (seat U), their quotes checked against it. */
export function settleFindings(round: AuditCritiqueInput, documents: ContextDocument[]) {
  return {
    speech: round.speech,
    critiques: round.findings.map(
      (finding): AuditFinding => ({ target: USER_SEAT, ...finding, quote: verified(documents, finding.quote), ask: finding.ask.trim() }),
    ),
    questionsForUser: round.questionsForUser,
  };
}

/**
 * The arbiter's audit as stored: quotes checked against the documents, findings from the most serious, one entry per
 * item of the checklist in its order, a market range only when it is one, questions and points without repeats.
 */
export function settleAudit(audit: AuditReport, documents: ContextDocument[]): AuditReport {
  const coverage = new Map<ChecklistItem, AuditReport["coverage"][number]>();
  for (const entry of audit.coverage)
    if (AUDIT_CHECKLIST.includes(entry.item) && !coverage.has(entry.item)) coverage.set(entry.item, entry);
  const market = audit.price.market;
  const valid =
    market && Number.isFinite(market.low) && Number.isFinite(market.high) && market.low >= 0 && market.high > 0
      ? market.low <= market.high
        ? market
        : { ...market, low: market.high, high: market.low }
      : null;
  return {
    ...audit,
    findings: bySeverity(audit.findings.map((finding) => ({ ...finding, quote: verified(documents, finding.quote) }))),
    coverage: AUDIT_CHECKLIST.flatMap((item) => {
      const entry = coverage.get(item);
      return entry ? [entry] : [];
    }),
    price: { ...audit.price, market: valid },
    questions: unique(audit.questions),
    negotiation: unique(audit.negotiation),
  };
}

/** One line of the document's breakdown, recomputed: its days times its day rate, against the amount it states. */
export interface QuoteLine {
  name: string;
  days: number | null;
  dailyRate: number | null;
  stated: number | null;
  /** Days times the day rate, when both are known. */
  computed: number | null;
  /** The stated amount minus the computed one, when both are known and they differ beyond rounding; 0 when they agree. */
  gap: number | null;
}

export type FitStatus = "within" | "over";

/** The document's figures, recomputed by the code. */
export interface QuoteCheck {
  /** The document's currency; null when it states no amount. */
  currency: string | null;
  lines: QuoteLine[];
  /** Person-days of the lines, when every line states its days. */
  days: number | null;
  /** The lines added up, each with its stated amount or else the one computed from its days; null when one has neither. */
  linesTotal: number | null;
  statedTotal: number | null;
  taxIncluded: boolean | null;
  /** The stated total minus the lines added up, when both are known and they differ beyond rounding; 0 when they agree. */
  totalGap: number | null;
  /** The stated total over the days, when every line states its days. */
  averageRate: number | null;
  /** The lines whose stated amount is not their days times their rate. */
  mismatches: number;
  /** The stated total against the build budget of the sheet, when both are known in the same currency. */
  budget: { amount: number; status: FitStatus; by: number } | null;
  /** The stated timeline against the deadline of the sheet, when both are known. */
  deadline: { availableWeeks: number; weeks: number; status: FitStatus; by: number } | null;
}

// Quotes round their amounts: a gap within half a percent, or one unit, is rounding.
const agree = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const round = (value: number) => Math.round(value * 100) / 100;

/** The document's figures recomputed, or null before the document was read. */
export function quoteCheck(session: Pick<Session, "audit" | "sheet" | "sheetConfirmedAt" | "createdAt">): QuoteCheck | null {
  const extraction = session.audit?.extraction;
  if (!extraction) return null;
  // A rate stated once for the whole document applies to the lines that give no rate of their own.
  const single = extraction.dayRates.length === 1 ? (extraction.dayRates[0]?.dailyRate ?? null) : null;
  const lines = extraction.workPackages.map((line): QuoteLine => {
    const dailyRate = line.dailyRate ?? (line.days !== null ? single : null);
    const computed = line.days !== null && dailyRate !== null ? round(line.days * dailyRate) : null;
    const gap = computed !== null && line.amount !== null ? (agree(line.amount, computed) ? 0 : round(line.amount - computed)) : null;
    return { name: line.name, days: line.days, dailyRate, stated: line.amount, computed, gap };
  });
  const amounts = lines.map((line) => line.stated ?? line.computed);
  const linesTotal =
    lines.length > 0 && amounts.every((value) => value !== null) ? round(amounts.reduce<number>((sum, v) => sum + (v ?? 0), 0)) : null;
  const days =
    lines.length > 0 && lines.every((line) => line.days !== null) ? lines.reduce((sum, line) => sum + (line.days ?? 0), 0) : null;
  const statedTotal = extraction.total.amount;
  const totalGap =
    statedTotal !== null && linesTotal !== null ? (agree(statedTotal, linesTotal) ? 0 : round(statedTotal - linesTotal)) : null;
  const priced = statedTotal ?? linesTotal;
  const sheet = session.sheet;
  const build = sheet?.budget.build;
  const budget =
    priced !== null && build && build.amount > 0 && extraction.currency && currencyCode(build.currency) === extraction.currency
      ? priced > build.amount
        ? { amount: build.amount, status: "over" as const, by: round(priced - build.amount) }
        : { amount: build.amount, status: "within" as const, by: 0 }
      : null;
  const available = sheet ? availableWeeks(sheet, session.sheetConfirmedAt ?? session.createdAt) : null;
  const weeks = extraction.timeline.weeks;
  const deadline =
    available !== null && weeks !== null
      ? {
          availableWeeks: Math.round(available * 10) / 10,
          weeks,
          status: weeks > available ? ("over" as const) : ("within" as const),
          by: weeks > available ? Math.ceil(weeks - available) : 0,
        }
      : null;
  return {
    currency: extraction.currency,
    lines,
    days,
    linesTotal,
    statedTotal,
    taxIncluded: extraction.total.taxIncluded,
    totalGap,
    averageRate: priced !== null && days ? Math.round(priced / days) : null,
    mismatches: lines.filter((line) => line.gap !== null && line.gap !== 0).length,
    budget,
    deadline,
  };
}

/** Where the document's price stands against the market range the arbiter estimated. */
export function pricePosition(check: QuoteCheck | null, market: { low: number; high: number } | null): "below" | "within" | "above" | null {
  const price = check?.statedTotal ?? check?.linesTotal ?? null;
  if (price === null || !market) return null;
  return price < market.low ? "below" : price > market.high ? "above" : "within";
}

const amount = (value: number, currency: string | null) => `${new Intl.NumberFormat("en").format(value)}${currency ? ` ${currency}` : ""}`;

/**
 * The recomputation as plain English sentences, for the critics and the arbiter. Empty when there is nothing to say.
 * The models take these as true: they hold Quorumind's own words and figures only, never text of the document. A line
 * is named by its place among the work packages of the extraction, not by the name the document gives it.
 */
export function quoteFacts(check: QuoteCheck | null): string[] {
  if (!check) return [];
  const facts: string[] = [];
  const money = (value: number) => amount(value, check.currency);
  for (const [index, line] of check.lines.entries()) {
    if (line.computed === null || line.days === null || line.dailyRate === null) continue;
    const base = `Work package ${index + 1} of <extraction>: ${line.days} days at ${money(line.dailyRate)} make ${money(line.computed)}`;
    facts.push(
      line.stated === null
        ? `${base}; the document states no amount for it.`
        : line.gap === 0
          ? `${base}, as stated.`
          : `${base}, but the document states ${money(line.stated)} (a gap of ${money(line.gap ?? 0)}).`,
    );
  }
  if (check.linesTotal !== null && check.statedTotal !== null) {
    facts.push(
      check.totalGap === 0
        ? `The lines add up to ${money(check.linesTotal)}, the stated total.`
        : `The lines add up to ${money(check.linesTotal)}, but the stated total is ${money(check.statedTotal)} (a gap of ${money(check.totalGap ?? 0)}).`,
    );
  } else if (check.statedTotal === null && check.linesTotal !== null) {
    facts.push(`The document states no total; its lines add up to ${money(check.linesTotal)}.`);
  } else if (check.statedTotal === null) {
    facts.push("The document states no total price.");
  }
  if (check.days !== null) {
    facts.push(
      `The lines total ${check.days} person-days${check.averageRate !== null ? `, an average of ${money(check.averageRate)} per day` : ""}.`,
    );
  }
  if (check.taxIncluded === null && check.statedTotal !== null) facts.push("The document does not say whether its total includes tax.");
  if (check.budget) {
    facts.push(
      check.budget.status === "over"
        ? `The price exceeds the build budget of ${money(check.budget.amount)} by ${money(check.budget.by)}.`
        : `The price fits the build budget of ${money(check.budget.amount)}.`,
    );
  }
  if (check.deadline) {
    facts.push(
      check.deadline.status === "over"
        ? `The stated timeline of ${check.deadline.weeks} weeks misses the deadline (${check.deadline.availableWeeks} weeks away) by ${check.deadline.by} week(s).`
        : `The stated timeline of ${check.deadline.weeks} weeks fits the deadline (${check.deadline.availableWeeks} weeks away).`,
    );
  }
  return facts;
}

/**
 * The document restated as option U, for every step that reads options: the verdict's options, the budget and deadline
 * checks, the exports. Its build cost is the total the document states, never one priced by Quorumind.
 */
export function auditProposal(extraction: AuditExtraction, fallbackCurrency: string): Proposal {
  const currency = extraction.currency ?? fallbackCurrency;
  const monthly = extraction.monthlyCost.amount;
  const total = extraction.total.amount;
  const weeks = extraction.timeline.weeks;
  return {
    speech: extraction.speech,
    title: extraction.title,
    summary: extraction.summary,
    architecture: extraction.scope,
    stack: extraction.technologies,
    infrastructure: extraction.hosting ? [extraction.hosting] : [],
    monthlyCost: {
      low: monthly ?? 0,
      high: monthly ?? 0,
      basis: monthly === null ? "The document states no recurring cost." : extraction.monthlyCost.quote || "Stated in the document.",
    },
    estimate: { workPackages: [], dayRates: [], assumptions: extraction.assumptions, exclusions: extraction.exclusions },
    buildTime: extraction.timeline.text ?? "",
    buildWeeks: weeks ? { low: weeks, high: weeks } : null,
    components: [],
    flows: [],
    risks: [],
    assumptions: extraction.assumptions,
    ...(total !== null
      ? { buildCost: { low: total, high: total, currency, basis: extraction.total.quote || "Stated in the document." } }
      : {}),
  };
}

/** The questions to send the provider as one plain text, numbered, ready to paste into an e-mail. */
export function questionsText(audit: Pick<AuditReport, "questions">): string {
  return audit.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}
