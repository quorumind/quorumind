import { describe, expect, it } from "vitest";
import { DEMO_LINEUP, providersFor } from "./config.ts";
import { availableWeeks, checkFacts, debateCurrency, deliveryChecks, proposalCosting, roundDays, sessionProfile } from "./costing.ts";
import { DEMO_IDEA, DEMO_SCRIPT, DEMO_SHEET } from "./demo.ts";
import { DebateEngine } from "./engine.ts";
import { EMPTY_PROFILE, type OrgProfile, withRoleIds } from "./profile.ts";
import { MockProvider } from "./providers/mock.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "./providers/types.ts";
import { renderReport } from "./report.ts";
import type { Proposal, RequirementsSheet } from "./schemas.ts";
import { createSession, normalizeSession, type Session } from "./session.ts";

const PROFILE: OrgProfile = {
  ...EMPTY_PROFILE,
  name: "Atelier Nord",
  preferredTechnologies: ["TypeScript", "PostgreSQL"],
  forbiddenTechnologies: ["PHP", "MongoDB"],
  hosting: { euOnly: true, providers: ["Scaleway"], onPremises: false, notes: "" },
  currency: "EUR",
  roles: withRoleIds([
    { name: "Senior developer", dailyRate: 650 },
    { name: "Project manager", dailyRate: 750 },
    { name: "Analyst", dailyRate: 333.33 },
  ]),
  capacity: { people: 6, typicalTeamSize: 3 },
  deliverables: ["Technical documentation"],
  guarantees: ["Three-month warranty"],
  updatedAt: "2026-10-01T09:00:00.000Z",
};

const base = DEMO_SCRIPT.proposals.A as Proposal;

/** A proposal whose estimate exercises the rounding, the matching of roles and a role the rate card lacks. */
const PRICED: Proposal = {
  ...base,
  estimate: {
    workPackages: [
      { name: "Framing", description: "", effort: [{ role: "project_manager", low: 1.2, high: 2.3 }] },
      {
        name: "Back end",
        description: "",
        effort: [
          // Low and high the wrong way round: the range is put back in order.
          { role: "senior_developer", low: 12, high: 10 },
          // The name instead of the id.
          { role: "Project Manager", low: 0.75, high: 1 },
        ],
      },
      { name: "Design", description: "", effort: [{ role: "designer", low: 3, high: 4 }] },
    ],
    dayRates: [{ role: "senior_developer", dailyRate: 1 }],
    assumptions: ["Content provided by the client"],
    exclusions: ["Hosting fees"],
  },
  buildWeeks: { low: 12, high: 14 },
};

function sessionWith(proposal: Proposal, options: { profile?: OrgProfile | null; sheet?: Partial<RequirementsSheet> } = {}): Session {
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP, profile: options.profile ?? null });
  session.sheet = { ...DEMO_SHEET, ...options.sheet };
  session.sheetConfirmedAt = "2026-01-01T10:00:00.000Z";
  session.debate.push({ kind: "proposal", round: 0, seat: "A", data: proposal });
  return session;
}

describe("costing", () => {
  it("prices the days with the profile's rates, rounded to the half day and the unit, and sums the rounded lines", () => {
    const costing = proposalCosting(sessionWith(PRICED, { profile: PROFILE }), PRICED)!;
    expect(costing.rates).toBe("profile");
    expect(costing.currency).toBe("EUR");
    const [framing, backEnd, design] = costing.packages;
    expect(framing?.lines[0]).toMatchObject({
      role: "project_manager",
      name: "Project manager",
      days: { low: 1, high: 2.5 },
      cost: { low: 750, high: 1875 },
    });
    expect(backEnd?.lines.map((line) => line.cost)).toEqual([
      { low: 6500, high: 7800 },
      { low: 750, high: 750 },
    ]);
    expect(backEnd?.lines[1]?.role).toBe("project_manager");
    // The model's own rate is ignored when the profile has one.
    expect(backEnd?.lines[0]?.dailyRate).toBe(650);
    expect(design?.lines[0]).toMatchObject({ role: "designer", dailyRate: null, cost: null, days: { low: 3, high: 4 } });
    expect(design?.cost).toEqual({ low: 0, high: 0 });
    expect(costing.unpriced).toEqual(["designer"]);
    expect(costing.days).toEqual({ low: 15, high: 19.5 });
    expect(costing.total).toEqual({ low: 8000, high: 10425 });
    expect(costing.assumptions).toEqual(["Content provided by the client"]);
    expect(costing.exclusions).toEqual(["Hosting fees"]);
  });

  it("rounds each line to the unit of the currency", () => {
    const proposal: Proposal = {
      ...PRICED,
      estimate: {
        ...PRICED.estimate,
        workPackages: [{ name: "Analysis", description: "", effort: [{ role: "analyst", low: 1.5, high: 2.5 }] }],
      },
    };
    const costing = proposalCosting(sessionWith(proposal, { profile: PROFILE }), proposal)!;
    // 1.5 × 333.33 = 499.995 and 2.5 × 333.33 = 833.325.
    expect(costing.total).toEqual({ low: 500, high: 833 });
    expect(roundDays(-3)).toBe(0);
    expect(roundDays(Number.NaN)).toBe(0);
    expect(roundDays(2.74)).toBe(2.5);
    expect(roundDays(2.76)).toBe(3);
  });

  it("uses the proposer's own day rates without a profile, and marks them as estimated", () => {
    const costing = proposalCosting(sessionWith(base), base)!;
    expect(costing.rates).toBe("estimated");
    expect(costing.total).toEqual({ low: 12_300, high: 15_500 });
    expect(costing.days).toEqual({ low: 47, high: 59 });
    expect(costing.unpriced).toEqual([]);
  });

  it("never trusts a total the model writes", () => {
    const tampered = { ...base, buildCost: { low: 1, high: 2, currency: "EUR", basis: "made up" } };
    expect(proposalCosting(sessionWith(tampered), tampered)?.total).toEqual({ low: 12_300, high: 15_500 });
  });

  it("keeps one currency per debate: the profile's, else the budget's, else the language's", () => {
    const withProfile = sessionWith(base, { profile: { ...PROFILE, currency: "CHF" } });
    expect(debateCurrency(withProfile)).toBe("CHF");
    expect(proposalCosting(withProfile, base)?.currency).toBe("CHF");
    expect(debateCurrency(sessionWith(base))).toBe("EUR");
    const noBudget = sessionWith(base, {
      sheet: { budget: { build: null, run: { amount: 500, currency: "gbp", period: "month" }, note: "" } },
    });
    expect(debateCurrency(noBudget)).toBe("GBP");
    const unknown = sessionWith(base, { sheet: { budget: { build: null, run: null, note: "" } } });
    expect(debateCurrency(unknown)).toBe("USD");
    unknown.locale = "ja";
    expect(debateCurrency(unknown)).toBe("JPY");
    // Once fixed at confirmation, it does not move.
    unknown.currency = "EUR";
    expect(debateCurrency(unknown)).toBe("EUR");
  });
});

describe("budget and deadline checks", () => {
  const checksFor = (sheet: Partial<RequirementsSheet>, profile: OrgProfile | null = PROFILE) =>
    deliveryChecks(sessionWith(PRICED, { profile, sheet })).A!;
  const budget = (build: number | null, run: { amount: number; period: "month" | "year"; currency?: string } | null = null) => ({
    budget: {
      build: build === null ? null : { amount: build, currency: "EUR" },
      run: run ? { amount: run.amount, period: run.period, currency: run.currency ?? "EUR" } : null,
      note: "",
    },
  });

  it("compares the computed build cost with the build budget", () => {
    expect(checksFor(budget(12_000)).build).toEqual({ status: "within", budget: 12_000, currency: "EUR", by: 0 });
    expect(checksFor(budget(9_000)).build).toEqual({ status: "at_risk", budget: 9_000, currency: "EUR", by: 1_425 });
    expect(checksFor(budget(7_000)).build).toEqual({ status: "over", budget: 7_000, currency: "EUR", by: 1_000 });
    // A budget in another currency cannot be compared without an exchange rate.
    expect(checksFor({ budget: { build: { amount: 9_000, currency: "USD" }, run: null, note: "" } }).build).toBeNull();
    expect(checksFor(budget(null)).build).toBeNull();
  });

  it("compares the monthly cost with the running budget, per month", () => {
    expect(checksFor(budget(null, { amount: 200, period: "month" })).run).toMatchObject({ status: "at_risk", by: 60 });
    expect(checksFor(budget(null, { amount: 2_400, period: "year" })).run).toMatchObject({ status: "at_risk", budget: 200, by: 60 });
    expect(checksFor(budget(null, { amount: 100, period: "month" })).run).toMatchObject({ status: "over", by: 20 });
    expect(checksFor(budget(null, { amount: 300, period: "month" })).run).toMatchObject({ status: "within", by: 0 });
  });

  it("compares the build time with the deadline, as a duration or a date from the confirmation", () => {
    const months = (amount: number) => ({ deadline: { date: null, duration: { amount, unit: "month" as const }, note: "" } });
    expect(checksFor(months(3)).time).toEqual({ status: "at_risk", availableWeeks: 13, by: 1 });
    expect(checksFor(months(5)).time).toMatchObject({ status: "within", by: 0 });
    const date = { deadline: { date: "2026-03-12", duration: null, note: "" } };
    expect(availableWeeks({ ...DEMO_SHEET, ...date }, "2026-01-01T10:00:00.000Z")).toBe(10);
    expect(checksFor(date).time).toEqual({ status: "over", availableWeeks: 10, by: 2 });
    expect(checksFor({ deadline: { date: null, duration: null, note: "Soon" } }).time).toBeNull();
  });

  it("gives the arbiter the checks it could compute as facts", () => {
    const facts = checkFacts(sessionWith(PRICED, { profile: PROFILE, sheet: budget(9_000, { amount: 100, period: "month" }) }));
    expect(facts).toContain(
      "Option A: build cost 8,000 EUR to 10,425 EUR (computed from its work packages) against a build budget of 9,000 EUR: may exceed it by up to 1,425 EUR.",
    );
    expect(facts).toContain("Option A: running cost against a running budget of 100 EUR per month: over by at least 20 EUR per month.");
    expect(facts.some((fact) => fact.startsWith("Option A: build time against 21.7 weeks to the deadline: on time"))).toBe(true);
  });

  it("shows them as badges in the report", () => {
    const report = renderReport({
      ...sessionWith(PRICED, { profile: PROFILE, sheet: budget(7_000) }),
      verdict: { ...DEMO_SCRIPT.verdict, options: DEMO_SCRIPT.verdict.options.slice(0, 1) },
      phase: "complete",
    });
    expect(report).toContain("  - Budget and deadline: Over budget by €1,000; On time");
    expect(report).toContain("| Over budget by €1,000; On time |");
  });
});

/** Replays the demo while keeping every request, to read what each role was told. */
class Recorder implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  readonly requests: GenerateRequest[] = [];
  private readonly inner = new MockProvider({ chunkDelayMs: 0 });
  generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    this.requests.push(request);
    return this.inner.generate(request, onDelta);
  }
}

async function debate(options: { profile: OrgProfile | null; ignoreProfile?: boolean }) {
  const recorder = new Recorder();
  const engine = new DebateEngine(
    { interviewer: recorder, arbiter: recorder, proposers: { A: recorder, B: recorder }, devil: recorder },
    { emit: () => {}, save: () => {} },
  );
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: false, ...DEMO_LINEUP, profile: options.profile });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet!, options.ignoreProfile === undefined ? {} : { ignoreProfile: options.ignoreProfile });
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted platform?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  const prompt = (task: GenerateRequest["task"]) =>
    recorder.requests
      .filter((request) => request.task === task)
      .map((request) => request.messages.map((message) => message.content).join("\n"));
  return { session, recorder, prompt };
}

describe("the organisation profile in the debate", () => {
  it("is given to the interviewer, the proposers, the critics, the revisers and the arbiter as constraints", async () => {
    const { session, prompt, recorder } = await debate({ profile: PROFILE });
    expect(session.phase).toBe("complete");
    for (const task of ["interview", "proposal", "critique", "revision", "verdict"] as const) {
      const prompts = prompt(task);
      expect(prompts.length, task).toBeGreaterThan(0);
      for (const text of prompts) {
        expect(text, task).toContain("Forbidden technologies (hard constraint): PHP; MongoDB");
        expect(text, task).toContain("data and services hosted in the European Union only; only with these providers: Scaleway");
        expect(text, task).toContain("Preferred technologies (preference): TypeScript; PostgreSQL");
      }
    }
    // The rate card goes to those who estimate, never the rates to the person's own data blocks.
    for (const text of [...prompt("proposal"), ...prompt("revision")]) {
      expect(text).toContain("- senior_developer: Senior developer, 650 EUR");
      expect(text).toContain("Every amount is in EUR.");
    }
    expect(prompt("verdict")[0]).toContain('"computedBuildCost"');
    const systems = recorder.requests.map((request) => `${request.task}: ${request.system}`);
    expect(systems.find((text) => text.startsWith("proposal:"))).toContain("Never use a forbidden technology");
    expect(systems.find((text) => text.startsWith("verdict:"))).toContain("Facts in <checks> are computed by Quorumind");
  });

  it("feeds the checks to the arbiter as facts", async () => {
    const { prompt } = await debate({ profile: null });
    const verdict = prompt("verdict")[0]!;
    expect(verdict).toContain("<checks>");
    expect(verdict).toContain("Option A: build cost 12,300 EUR to 15,500 EUR (computed from its work packages)");
    expect(prompt("proposal")[0]).toContain("No rate card: use these role ids");
  });

  it("is left out of every prompt when the person sets it aside for the debate", async () => {
    const { session, prompt } = await debate({ profile: { ...PROFILE, currency: "CHF" }, ignoreProfile: true });
    expect(session.ignoreProfile).toBe(true);
    expect(sessionProfile(session)).toBeNull();
    // The snapshot is kept: the person may still see what was set aside.
    expect(session.profile?.name).toBe("Atelier Nord");
    for (const task of ["proposal", "critique", "revision", "verdict"] as const) {
      for (const text of prompt(task)) expect(text, task).not.toContain("PHP");
    }
    // Without the profile, the budget's currency is the debate's.
    expect(session.currency).toBe("EUR");
  });

  it("fixes the currency of the debate when the sheet is confirmed", async () => {
    const { session } = await debate({ profile: { ...PROFILE, currency: "CHF" } });
    expect(session.currency).toBe("CHF");
    const report = renderReport(session);
    expect(report).toContain("CHF");
    expect(report).not.toContain("€12,300");
  });
});

describe("sessions stored before the structured requirements and the work packages", () => {
  /** A session as the previous version stored it: free-text budget, team, deadline and load, and costs per proposal. */
  function legacy(): Session {
    const session = sessionWith(base);
    const sheet = {
      ...DEMO_SHEET,
      users: "About 4,000 members at launch",
      budget: "€15,000 to build, at most €400 per month to run.",
      team: "Two JavaScript developers",
      deadline: "Launch before September",
      compliance: undefined,
    };
    const { estimate: _estimate, buildWeeks: _weeks, ...old } = base;
    const proposal = {
      ...old,
      monthlyCost: { ...base.monthlyCost, currency: "EUR" },
      buildCost: { low: 12_000, high: 15_000, currency: "EUR", basis: "Two developers for 4 months" },
    };
    const stored = JSON.parse(JSON.stringify({ ...session, sheet, debate: [{ kind: "proposal", round: 0, seat: "A", data: proposal }] }));
    delete stored.profile;
    delete stored.ignoreProfile;
    delete stored.currency;
    return stored as Session;
  }

  it("keeps the old free text as the note of each structured field", () => {
    const session = normalizeSession(legacy());
    expect(session.sheet?.budget).toEqual({ build: null, run: null, note: "€15,000 to build, at most €400 per month to run." });
    expect(session.sheet?.team).toEqual({ people: null, skills: [], note: "Two JavaScript developers" });
    expect(session.sheet?.deadline).toEqual({ date: null, duration: null, note: "Launch before September" });
    expect(session.sheet?.users).toEqual({ launch: null, oneYear: null, note: "About 4,000 members at launch" });
    expect(session.sheet?.compliance).toEqual({
      gdpr: false,
      healthData: false,
      paymentCards: false,
      accessibility: false,
      publicSector: false,
    });
    expect(session.profile).toBeNull();
    expect(session.ignoreProfile).toBe(false);
    expect(session.currency).toBe("EUR");
    // A sheet already in the new shape is left as it is.
    expect(normalizeSession(session).sheet).toEqual(session.sheet);
  });

  it("shows the build cost the model gave, and makes no check it cannot make", () => {
    const session = normalizeSession(legacy());
    const proposal = session.debate[0]?.kind === "proposal" ? session.debate[0].data : null;
    const costing = proposalCosting(session, proposal!)!;
    expect(costing).toMatchObject({ rates: "legacy", packages: [], total: { low: 12_000, high: 15_000 }, currency: "EUR" });
    expect(deliveryChecks(session).A).toEqual({ build: null, run: null, time: null });
    const report = renderReport({ ...session, verdict: DEMO_SCRIPT.verdict, phase: "complete" });
    expect(report).toContain("- Budget: €15,000 to build, at most €400 per month to run.");
    expect(report).toContain("**Build cost:** €12,000 – €15,000 (estimate)");
    expect(report).toContain("_Build cost given as a whole by the proposer._");
  });

  it("runs a demo end to end on the provider set the server builds", async () => {
    const engine = new DebateEngine(providersFor(DEMO_LINEUP, {}, { mockDelayMs: 0 }), { emit: () => {}, save: () => {} });
    const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
    await engine.startInterview(session);
    await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
    await engine.confirmSheet(session, session.sheet!);
    expect(session.currency).toBe("EUR");
  });
});
