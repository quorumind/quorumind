// The properties every good verdict must have, checked by the bench (run.ts). Some are checked on what the models
// answered before the engine settled it: the engine empties a quote it cannot find in the document and orders a market
// range, so a check on the stored session could never fail.
import {
  AUDIT_CHECKLIST,
  AUDIT_OPINIONS,
  auditedDocuments,
  auditOf,
  type ContextDocument,
  cleanQuery,
  criticSeats,
  currentProposals,
  findQuote,
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  type Locale,
  MAX_QUERY_CHARS,
  type OrgProfile,
  type ProfileRole,
  proposalCosting,
  quoteCheck,
  type Session,
  sessionProfile,
} from "@quorumind/core";

export interface Fixture {
  id: string;
  /** An audit: the document, a file next to the fixture, is examined against the need the idea states. */
  mode?: "audit";
  document?: { name: string; file: string };
  /** The audit also sketches an alternative from the need alone. */
  alternative?: boolean;
  locale: Locale;
  idea: string;
  interviewAnswers: string[];
  debateAnswers: string[];
  /** The organisation that answers the brief: its rate card prices the work packages. */
  profile?: Omit<OrgProfile, "roles" | "updatedAt"> & { roles: Omit<ProfileRole, "id">[] };
  expect: {
    hardConstraintKeywords: string[];
    /** The one currency every amount of the debate must be in. */
    currency: string;
    /** The build budget the interviewer must record (checked with live models). */
    buildBudget?: number;
    /** What the audit must find in the document's figures, and the checklist items it must report missing. */
    audit?: { statedTotal: number; linesTotal: number; totalGap: number; lines: number; mismatches: number; missing: string[] };
  };
}

export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

/** One answer of a model, as it came, before the engine settled it. */
export interface RawCall {
  task: GenerateRequest["task"];
  schemaName: string;
  seat: string | null;
  text: string;
}

/** A provider that keeps every answer it gives, as it came. */
export function recording(provider: LlmProvider, calls: RawCall[]): LlmProvider {
  return {
    kind: provider.kind,
    model: provider.model,
    async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
      const result = await provider.generate(request, onDelta);
      calls.push({ task: request.task, schemaName: request.schemaName, seat: request.seat, text: result.text });
      return result;
    },
  };
}

const parsed = (call: RawCall): Record<string, unknown> | null => {
  try {
    return JSON.parse(call.text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The quotes the critics and the arbiter of an audit gave, as they wrote them. */
export function rawAuditQuotes(calls: RawCall[]): string[] {
  return calls.flatMap((call) => {
    const answer = parsed(call);
    if (!answer) return [];
    const findings = call.schemaName.startsWith("audit_findings")
      ? answer.findings
      : call.schemaName.startsWith("audit_verdict")
        ? (answer.audit as { findings?: unknown } | undefined)?.findings
        : undefined;
    if (!Array.isArray(findings)) return [];
    return findings.flatMap((finding) => {
      const quote = (finding as { quote?: unknown }).quote;
      return typeof quote === "string" && quote.trim() ? [quote] : [];
    });
  });
}

/** The quotes that are not in the documents, word for word: the engine drops them, the bench counts them. */
export function misquotes(documents: ContextDocument[], quotes: string[]): string[] {
  return quotes.filter((quote) => !findQuote(documents, quote));
}

/** The market ranges the arbiter of an audit gave, as it wrote them. */
export function rawMarketRanges(calls: RawCall[]): ({ low: number; high: number; basis: string } | null)[] {
  return calls.flatMap((call) => {
    if (!call.schemaName.startsWith("audit_verdict")) return [];
    const audit = parsed(call)?.audit as { price?: { market?: { low: number; high: number; basis: string } | null } } | undefined;
    return audit?.price ? [audit.price.market ?? null] : [];
  });
}

/** A range given as an estimate: low to high, in that order, with its basis. */
export const validRange = (range: { low: number; high: number; basis: string } | null) =>
  range === null || (Number.isFinite(range.low) && range.low >= 0 && range.low <= range.high && range.basis.trim().length > 0);

/** Every call has a known cost: none is free by mistake, none unpriced. */
export function costRecorded(session: Pick<Session, "usage">): Check {
  const unknown = session.usage.filter((record) => record.costUsd === null);
  return {
    name: "records the cost of every call",
    passed: session.usage.length > 0 && unknown.length === 0,
    ...(unknown.length > 0 ? { detail: `no known cost: ${[...new Set(unknown.map((record) => record.model))].join(", ")}` } : {}),
  };
}

const adder = (checks: Check[]) => (name: string, passed: boolean, detail?: string) =>
  checks.push({ name, passed, ...(detail ? { detail } : {}) });

/**
 * The web research and the claims that rest on it: every "verified" claim cites a source the research found, the facts
 * cite theirs, every source is dated, and only short, generic queries were sent to the search engine.
 */
export function researchChecks(session: Session, live: boolean): Check[] {
  const checks: Check[] = [];
  const add = adder(checks);
  const known = new Set(session.sources.map((source) => source.id));
  const unsourced = (session.verdict?.claims ?? []).filter(
    (claim) => claim.confidence === "verified" && (claim.sources.length === 0 || !claim.sources.every((id) => known.has(id))),
  );
  add("cites a source for every verified claim", unsourced.length === 0, unsourced.map((claim) => claim.claim).join("; "));
  const research = session.research;
  if (research?.status !== "done") {
    // Live without a search engine, the research is skipped and says why; the demo always replays its recording.
    add("checks the facts on the web", live && research?.status === "skipped", `${research?.status ?? "none"} ${research?.skipped ?? ""}`);
    return checks;
  }
  add(
    "states facts that cite the sources found",
    research.facts.length > 0 && research.facts.every((fact) => fact.sources.length > 0 && fact.sources.every((id) => known.has(id))),
  );
  add(
    "dates every source",
    session.sources.every((source) => Number.isFinite(Date.parse(source.retrievedAt)) && /^https?:/.test(source.url)),
  );
  const sent = research.queries.filter((query) => query.searchedAt !== null).map((query) => query.query);
  const leaked = sent.filter((query) => query.length > MAX_QUERY_CHARS || cleanQuery(query, session) !== query);
  add("sends only short, generic queries", sent.length > 0 && leaked.length === 0, leaked.join("; "));
  add(
    "counts what the searches cost",
    session.usage.filter((record) => record.task === "search").every((record) => record.costUsd !== null && !record.estimated),
  );
  return checks;
}

/** What every debate must give, and an audit what auditChecks says. */
export function check(session: Session, fixture: Fixture, context: { live: boolean; calls: RawCall[] }): Check[] {
  const checks: Check[] = [];
  const add = adder(checks);
  add("reaches a verdict", session.phase === "complete", session.error?.message);
  const verdict = session.verdict;
  if (!verdict || !session.sheet) return checks;
  if (fixture.mode === "audit")
    return [...checks, ...auditChecks(session, fixture, context.calls), ...researchChecks(session, context.live)];
  const seats = Object.keys(session.seats);
  add(
    "judges every option",
    seats.every((seat) => verdict.options.some((option) => option.seat === seat)),
  );
  add(
    "recommends a judged, feasible option or none",
    verdict.recommendation.seat === null ||
      verdict.options.some((option) => option.seat === verdict.recommendation.seat && option.feasibility !== "infeasible"),
  );
  const criteria = session.sheet.priorities.map((priority) => priority.criterion);
  add(
    "scores every priority from 1 to 5",
    verdict.options.every((option) =>
      criteria.every((criterion) => option.scores.some((score) => score.criterion === criterion && score.score >= 1 && score.score <= 5)),
    ),
  );
  add(
    "conditional options name their conditions",
    verdict.options.every((option) => option.feasibility !== "conditional" || option.conditions.length > 0),
  );
  add("gives risks with mitigations", verdict.risks.length > 0 && verdict.risks.every((risk) => risk.mitigation.trim().length > 0));
  add("marks the confidence of its claims", verdict.claims.length > 0);
  const constraints = session.sheet.hardConstraints.join(" ").toLowerCase();
  if (!session.demo) {
    for (const keyword of fixture.expect.hardConstraintKeywords) {
      add(
        `captures the hard constraint "${keyword}"`,
        constraints.includes(keyword.toLowerCase()),
        session.sheet.hardConstraints.join("; "),
      );
    }
  }
  if (!session.demo && fixture.expect.buildBudget !== undefined) {
    const build = session.sheet.budget.build;
    add("records the build budget as an amount", build?.amount === fixture.expect.buildBudget, JSON.stringify(build));
  }

  // The costing: every option broken into work packages, priced by the code, in the debate's one currency.
  const proposals = Object.entries(currentProposals(session));
  add(
    "breaks every option into work packages with effort per role",
    proposals.every(
      ([, proposal]) => proposal.estimate.workPackages.length > 0 && proposal.estimate.workPackages.every((item) => item.effort.length > 0),
    ),
  );
  const costings = proposals.map(([seat, proposal]) => ({ seat, costing: proposalCosting(session, proposal) }));
  const unpriced = costings.flatMap(({ seat, costing }) => (costing?.unpriced ?? []).map((role) => `${seat}: ${role}`));
  add(
    "computes every build cost from its work packages",
    costings.every(
      ({ costing }) =>
        costing !== null &&
        costing.rates !== "legacy" &&
        costing.total.high > 0 &&
        costing.total.low === costing.packages.reduce((sum, item) => sum + item.cost.low, 0) &&
        costing.total.high === costing.packages.reduce((sum, item) => sum + item.cost.high, 0),
    ),
  );
  add("prices every role it uses", unpriced.length === 0, unpriced.join(", "));
  add(
    "gives every amount in one currency",
    session.currency === fixture.expect.currency && costings.every(({ costing }) => costing?.currency === session.currency),
    `${session.currency} / ${costings.map(({ costing }) => costing?.currency).join(", ")}`,
  );
  const profile = sessionProfile(session);
  if (profile) {
    add(
      "prices with the profile's rate card",
      costings.every(({ costing }) => costing?.rates === "profile"),
    );
    if (!session.demo) {
      const forbidden = profile.forbiddenTechnologies.map((item) => item.toLowerCase());
      const used = proposals.flatMap(([seat, proposal]) =>
        proposal.stack.filter((item) => forbidden.some((banned) => item.toLowerCase().includes(banned))).map((item) => `${seat}: ${item}`),
      );
      add("stays clear of the profile's forbidden technologies", used.length === 0, used.join(", "));
    }
  }
  checks.push(costRecorded(session));
  checks.push(...researchChecks(session, context.live));
  return checks;
}

/** What every audit must give: an opinion, findings quoting the document, the checklist, the figures recomputed, questions. */
export function auditChecks(session: Session, fixture: Fixture, calls: RawCall[]): Check[] {
  const checks: Check[] = [];
  const add = adder(checks);
  const audit = auditOf(session.verdict);
  if (!audit) return [{ name: "gives an audit", passed: false }];
  add("gives an overall opinion", (AUDIT_OPINIONS as readonly string[]).includes(audit.opinion), audit.opinion);
  add(
    "gives findings with severities",
    audit.findings.length > 0 && audit.findings.every((finding) => ["blocking", "major", "minor"].includes(finding.severity)),
  );
  const quotable = audit.findings.filter((finding) => finding.category !== "missing");
  const quoted = quotable.filter((finding) => finding.quote);
  add("quotes the document when it can", quoted.length * 2 >= quotable.length, `${quoted.length} of ${quotable.length}`);
  // Checked on the models' own answers: the stored audit keeps only the quotes found in the document.
  const quotes = rawAuditQuotes(calls);
  const wrong = misquotes(auditedDocuments(session), quotes);
  add("quotes only passages of the document", quotes.length > 0 && wrong.length === 0, wrong.join(" | "));
  add(
    "covers the whole checklist",
    AUDIT_CHECKLIST.every((item) => audit.coverage.some((entry) => entry.item === item)),
  );
  for (const item of fixture.expect.audit?.missing ?? []) {
    const status = audit.coverage.find((entry) => entry.item === item)?.status;
    add(`reports "${item}" as missing`, status === "missing", status);
  }
  add("lists questions to ask the provider", audit.questions.length >= 3, String(audit.questions.length));
  add("lists points to negotiate", audit.negotiation.length > 0);
  const ranges = rawMarketRanges(calls);
  add(
    "gives the market range as an estimated range",
    ranges.length > 0 && ranges.every(validRange),
    JSON.stringify(ranges.filter((range) => !validRange(range))),
  );
  const critics = criticSeats(session);
  add(
    "has every critic examine the document",
    critics.every((seat) => session.debate.some((entry) => entry.kind === "critiques" && entry.seat === seat && entry.round === 1)),
  );
  add(
    "rules on the document and its alternative only",
    (session.verdict?.options ?? []).every((option) => option.seat === "U" || (fixture.alternative && option.seat === "A")),
  );
  const expected = fixture.expect.audit;
  const recomputed = quoteCheck(session);
  if (expected) {
    add(
      "recomputes the price from the days and rates",
      recomputed !== null &&
        recomputed.lines.length === expected.lines &&
        recomputed.statedTotal === expected.statedTotal &&
        recomputed.linesTotal === expected.linesTotal &&
        recomputed.totalGap === expected.totalGap &&
        recomputed.mismatches === expected.mismatches,
      JSON.stringify(recomputed && { ...recomputed, lines: recomputed.lines.length }),
    );
  }
  add("gives every amount in one currency", session.currency === fixture.expect.currency, String(session.currency));
  checks.push(costRecorded(session));
  return checks;
}
