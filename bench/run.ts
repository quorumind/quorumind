// Quality bench: replays reference projects end to end and checks properties every good
// verdict must have (checks.ts). Run it after any change to prompts, schemas or models:
//   npm run bench                      demo models, checks the pipeline (free)
//   QUORUMIND_BENCH=live npm run bench  the models configured in the environment (costs money)
// Every debate checks the facts on the web first. On the demo, the searches replay recorded answers of OpenRouter's
// web plugin (fixtures/research/openrouter.json); live, they use the search engine configured (QUORUMIND_SEARCH).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogFromEnv,
  createSession,
  DEMO_LINEUP,
  DebateEngine,
  EMPTY_PROFILE,
  isPriceReferenceStale,
  type Lineup,
  liveLineupFromEnv,
  OpenRouterSearch,
  type OrgProfile,
  PRICE_REFERENCE,
  type ProviderSet,
  providersFor,
  type SearchProvider,
  type Session,
  totalCost,
  withRoleIds,
} from "@quorumind/core";
import { type Check, check, type Fixture, type RawCall, recording } from "./checks.ts";

const here = import.meta.dirname;
const live = process.env.QUORUMIND_BENCH === "live";
// Live, the catalog gives OpenRouter models their prices and tells which of them reason.
const configured = live ? liveLineupFromEnv(process.env, await catalogFromEnv(process.env)) : DEMO_LINEUP;
if (!configured) {
  console.error(
    "QUORUMIND_BENCH=live needs a configured provider: ANTHROPIC_API_KEY, OPENAI_API_KEY with OPENAI_MODEL, GEMINI_API_KEY with GEMINI_MODEL, OPENROUTER_API_KEY, or OLLAMA_BASE_URL / OLLAMA_MODELS.",
  );
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

/** The providers of the lineup, each keeping the answers it gives as they came, for the checks the engine would hide. */
function recorded(calls: RawCall[]): ProviderSet {
  const providers = providersFor(lineup, process.env, { mockDelayMs: 0 });
  return {
    interviewer: recording(providers.interviewer, calls),
    arbiter: recording(providers.arbiter, calls),
    proposers: Object.fromEntries(Object.entries(providers.proposers).map(([seat, provider]) => [seat, recording(provider, calls)])),
    devil: providers.devil ? recording(providers.devil, calls) : null,
    search: live ? providers.search : recordedSearch(),
  };
}

async function run(fixture: Fixture) {
  const calls: RawCall[] = [];
  const engine = new DebateEngine(recorded(calls), { emit: () => {}, save: () => {} });
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
  return { session, seconds: (Date.now() - started) / 1000, checks: check(session, fixture, { live, calls }) };
}

// The proposers read the reference cloud prices: say when they are out of date (npm run prices:check).
if (isPriceReferenceStale())
  console.warn(`Warning: the reference cloud prices date from ${PRICE_REFERENCE.asOf}; run npm run prices:check.`);

const fixtures = readdirSync(join(here, "fixtures"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(here, "fixtures", file), "utf8")) as Fixture);

const results = [];
let failures = 0;
for (const fixture of fixtures) {
  let outcome: { session: Session | null; seconds: number; checks: Check[] };
  try {
    outcome = await run(fixture);
  } catch (error) {
    // One fixture that throws fails its own checks; the others still run and the results are still written.
    outcome = { session: null, seconds: 0, checks: [{ name: "runs without an error", passed: false, detail: String(error) }] };
  }
  const { session, seconds, checks } = outcome;
  const failed = checks.filter((item) => !item.passed);
  failures += failed.length;
  const cost = session ? totalCost(session) : { usd: 0, complete: true };
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
