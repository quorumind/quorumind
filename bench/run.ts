// Quality bench: replays reference projects end to end and checks properties every good
// verdict must have. Run it after any change to prompts, schemas or models:
//   npm run bench                      demo models, checks the pipeline (free)
//   QUORUMIND_BENCH=live npm run bench  the models configured in the environment (costs money)
// Every debate checks the facts on the web first. On the demo, the searches replay recorded answers of OpenRouter's
// web plugin (fixtures/research/openrouter.json); live, they use the search engine configured (QUORUMIND_SEARCH).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_CHECKLIST,
  AUDIT_OPINIONS,
  auditedDocuments,
  auditOf,
  cleanQuery,
  createSession,
  criticSeats,
  currentProposals,
  DEMO_LINEUP,
  DebateEngine,
  EMPTY_PROFILE,
  findQuote,
  isPriceReferenceStale,
  type Lineup,
  type Locale,
  liveLineupFromEnv,
  MAX_QUERY_CHARS,
  OpenRouterSearch,
  type OrgProfile,
  PRICE_REFERENCE,
  type ProfileRole,
  proposalCosting,
  providersFor,
  quoteCheck,
  type SearchProvider,
  type Session,
  sessionProfile,
  totalCost,
  withRoleIds,
} from "@quorumind/core";

interface Fixture {
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

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const here = import.meta.dirname;
const live = process.env.QUORUMIND_BENCH === "live";
const configured = live ? liveLineupFromEnv(process.env) : DEMO_LINEUP;
if (!configured) {
  console.error("QUORUMIND_BENCH=live needs ANTHROPIC_API_KEY and/or OPENAI_API_KEY with OPENAI_MODEL.");
  process.exit(1);
}
const lineup: Lineup = configured;

/** The recorded answers of OpenRouter's web plugin, replayed for the demo: the answer whose keyword the query names. */
function recordedSearch(): SearchProvider {
  const recorded = JSON.parse(readFileSync(join(here, "fixtures", "research", "openrouter.json"), "utf8")) as {
    answers: { match: string; response: unknown }[];
  };
  const replay = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const query = body.messages.at(-1)?.content.toLowerCase() ?? "";
    const answer = recorded.answers.find((item) => query.includes(item.match));
    const response = answer?.response ?? { choices: [{ message: { content: "Nothing found.", annotations: [] } }], usage: { cost: 0.007 } };
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return new OpenRouterSearch({ apiKey: "recorded", fetch: replay });
}

async function run(fixture: Fixture) {
  const providers = providersFor(lineup, process.env, { mockDelayMs: 0 });
  const engine = new DebateEngine(live ? providers : { ...providers, search: recordedSearch() }, { emit: () => {}, save: () => {} });
  const profile: OrgProfile | null = fixture.profile
    ? { ...EMPTY_PROFILE, ...fixture.profile, roles: withRoleIds(fixture.profile.roles), updatedAt: null }
    : null;
  const document = fixture.document
    ? [
        {
          id: "document",
          kind: "file" as const,
          name: fixture.document.name,
          text: readFileSync(join(here, "fixtures", fixture.document.file), "utf8"),
        },
      ]
    : [];
  const session = createSession({
    locale: fixture.locale,
    idea: fixture.idea,
    demo: !live,
    budgetUsd: 5,
    webResearch: { maxQueries: 6, budgetUsd: 0.3 },
    ...lineup,
    profile,
    ...(fixture.mode ? { mode: fixture.mode, context: document, audit: { alternative: fixture.alternative ?? false } } : {}),
  });
  const started = Date.now();

  await engine.startInterview(session);
  let turns = 0;
  while (session.phase === "interview" && turns < 6) {
    const last = session.interview.at(-1);
    if (last?.kind !== "interviewer") break;
    const answers = last.data.questions.map((question, index) => ({
      question: question.text,
      answer: fixture.interviewAnswers[index] ?? fixture.interviewAnswers.at(-1) ?? "I don't know",
    }));
    await engine.answerInterview(session, answers);
    turns++;
  }
  if (session.phase === "review" && session.sheet) {
    await engine.confirmSheet(session, session.sheet);
    await engine.runDebate(session);
    // The engine mutates the phase; re-read it as the full union on each pass.
    while ((session.phase as Session["phase"]) === "awaiting_answers") {
      const pending = session.debate.findLast((entry) => entry.kind === "questions");
      const questions = pending?.kind === "questions" ? pending.questions : [];
      await engine.answerDebate(
        session,
        questions.map((question, index) => ({ question, answer: fixture.debateAnswers[index] ?? "No preference." })),
      );
      await engine.runDebate(session);
    }
  }
  return { session, seconds: (Date.now() - started) / 1000, checks: check(session, fixture) };
}

/**
 * The web research and the claims that rest on it: every "verified" claim cites a source the research found, the facts
 * cite theirs, every source is dated, and only short, generic queries were sent to the search engine.
 */
function researchChecks(session: Session): Check[] {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail ? { detail } : {}) });
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
    session.usage.filter((record) => record.task === "search").every((record) => record.costUsd !== null),
  );
  return checks;
}

function check(session: Session, fixture: Fixture): Check[] {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail ? { detail } : {}) });
  add("reaches a verdict", session.phase === "complete", session.error?.message);
  const verdict = session.verdict;
  if (!verdict || !session.sheet) return checks;
  if (fixture.mode === "audit") return [...checks, ...auditChecks(session, fixture), ...researchChecks(session)];
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
  add("records the cost of every call", session.usage.length > 0 && session.usage.every((record) => record.inputTokens >= 0));
  checks.push(...researchChecks(session));
  return checks;
}

// The proposers read the reference cloud prices: say when they are out of date (npm run prices:check).
if (isPriceReferenceStale())
  console.warn(`Warning: the reference cloud prices date from ${PRICE_REFERENCE.asOf}; run npm run prices:check.`);

/** What every audit must give: an opinion, findings quoting the document, the checklist, the figures recomputed, questions. */
function auditChecks(session: Session, fixture: Fixture): Check[] {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail ? { detail } : {}) });
  const audit = auditOf(session.verdict);
  if (!audit) return [{ name: "gives an audit", passed: false }];
  add("gives an overall opinion", (AUDIT_OPINIONS as readonly string[]).includes(audit.opinion), audit.opinion);
  add(
    "gives findings with severities",
    audit.findings.length > 0 && audit.findings.every((finding) => ["blocking", "major", "minor"].includes(finding.severity)),
  );
  const documents = auditedDocuments(session);
  const quotable = audit.findings.filter((finding) => finding.category !== "missing");
  const quoted = quotable.filter((finding) => finding.quote);
  add("quotes the document when it can", quoted.length * 2 >= quotable.length, `${quoted.length} of ${quotable.length}`);
  const misquoted = audit.findings.filter((finding) => finding.quote && !findQuote(documents, finding.quote));
  add("quotes only passages of the document", misquoted.length === 0, misquoted.map((finding) => finding.quote).join(" | "));
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
  const market = audit.price.market;
  add("gives the market range as an estimated range", market === null || (market.low <= market.high && market.basis.trim().length > 0));
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
  const check = quoteCheck(session);
  if (expected) {
    add(
      "recomputes the price from the days and rates",
      check !== null &&
        check.lines.length === expected.lines &&
        check.statedTotal === expected.statedTotal &&
        check.linesTotal === expected.linesTotal &&
        check.totalGap === expected.totalGap &&
        check.mismatches === expected.mismatches,
      JSON.stringify(check && { ...check, lines: check.lines.length }),
    );
  }
  add("gives every amount in one currency", session.currency === fixture.expect.currency, String(session.currency));
  add("records the cost of every call", session.usage.length > 0 && session.usage.every((record) => record.inputTokens >= 0));
  return checks;
}

const fixtures = readdirSync(join(here, "fixtures"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(here, "fixtures", file), "utf8")) as Fixture);

const results = [];
let failures = 0;
for (const fixture of fixtures) {
  const { session, seconds, checks } = await run(fixture);
  const failed = checks.filter((item) => !item.passed);
  failures += failed.length;
  const cost = totalCost(session);
  console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"} ${fixture.id} (${seconds.toFixed(1)} s, $${cost.usd.toFixed(3)})`);
  for (const item of checks)
    console.log(`  ${item.passed ? "✓" : "✗"} ${item.name}${!item.passed && item.detail ? ` — ${item.detail}` : ""}`);
  results.push({ fixture: fixture.id, mode: live ? "live" : "demo", seconds, costUsd: cost.usd, checks, session });
}

const outDir = join(here, "results");
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${new Date().toISOString().replaceAll(":", "-")}-${live ? "live" : "demo"}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`} Details: ${file}`);
process.exit(failures === 0 ? 0 : 1);
