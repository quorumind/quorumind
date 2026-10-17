// Quality bench: replays reference projects end to end and checks properties every good
// verdict must have. Run it after any change to prompts, schemas or models:
//   npm run bench                      demo models, checks the pipeline (free)
//   QUORUMIND_BENCH=live npm run bench  the models configured in the environment (costs money)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSession,
  DEMO_LINEUP,
  DebateEngine,
  type Lineup,
  type Locale,
  liveLineupFromEnv,
  providersFor,
  type Session,
  totalCost,
} from "@quorumind/core";

interface Fixture {
  id: string;
  locale: Locale;
  idea: string;
  interviewAnswers: string[];
  debateAnswers: string[];
  expect: { hardConstraintKeywords: string[] };
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

async function run(fixture: Fixture) {
  const engine = new DebateEngine(providersFor(lineup, process.env, { mockDelayMs: 0 }), { emit: () => {}, save: () => {} });
  const session = createSession({ locale: fixture.locale, idea: fixture.idea, demo: !live, budgetUsd: 5, ...lineup });
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

function check(session: Session, fixture: Fixture): Check[] {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail ? { detail } : {}) });
  add("reaches a verdict", session.phase === "complete", session.error?.message);
  const verdict = session.verdict;
  if (!verdict || !session.sheet) return checks;
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
