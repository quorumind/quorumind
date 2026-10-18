import { z } from "zod";

// Every schema here is sent to the models as a JSON schema for structured output.
// Both Anthropic and OpenAI strict modes require every property to be listed as required
// and reject most numeric or length constraints, so optional values are expressed as
// nullable fields and ranges are enforced in code after parsing.

// Each role answers with a short natural-language `speech` first, so the interface can
// stream it while the rest of the JSON is still being generated.

export const Priority = z.object({
  criterion: z.string().describe("A decision criterion, e.g. cost, time to market, maintainability."),
  weight: z.number().describe("Importance from 1 (low) to 5 (critical)."),
});

export const Money = z.object({ amount: z.number(), currency: z.string().describe("ISO 4217 code, e.g. EUR.") });
export type Money = z.infer<typeof Money>;

export const BudgetPeriod = z.enum(["month", "year"]);
export type BudgetPeriod = z.infer<typeof BudgetPeriod>;

export const DurationUnit = z.enum(["week", "month"]);
export type DurationUnit = z.infer<typeof DurationUnit>;

/** Regulations and kinds of data that weigh on the design: each one is a hard constraint when checked. */
export const Compliance = z.object({
  gdpr: z.boolean().describe("Personal data of people in the EU."),
  healthData: z.boolean(),
  paymentCards: z.boolean().describe("Card data handled by the system itself (PCI DSS)."),
  accessibility: z.boolean().describe("An accessibility standard must be met, e.g. WCAG or RGAA."),
  publicSector: z.boolean().describe("A public-sector client: procurement, sovereignty and accessibility rules."),
});
export type Compliance = z.infer<typeof Compliance>;
export const RequirementsSheet = z.object({
  projectName: z.string(),
  summary: z.string().describe("Two or three sentences describing the project."),
  goals: z.array(z.string()),
  successCriteria: z.array(z.string()),
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  outOfScope: z.array(z.string()),
  users: z.object({
    launch: z.number().nullable().describe("Expected users at launch; null when unknown."),
    oneYear: z.number().nullable().describe("Expected users after a year; null when unknown."),
    note: z.string().describe("Usage peaks, load and anything the numbers do not say."),
  }),
  budget: z.object({
    build: Money.nullable().describe("The one-off budget to build it; null when unknown."),
    run: Money.extend({ period: BudgetPeriod })
      .nullable()
      .describe("The running budget (hosting, licences, services) per month or year; null when unknown."),
    note: z.string().describe("Nuance: what the budget covers, how firm it is."),
  }),
  existingInfrastructure: z.array(z.string()),
  team: z.object({
    people: z.number().nullable().describe("How many people build it; null when unknown."),
    skills: z.array(z.string()),
    note: z.string().describe("Who builds and maintains it, and their available time."),
  }),
  deadline: z.object({
    date: z.string().nullable().describe("Launch date as YYYY-MM-DD, when there is one."),
    duration: z
      .object({ amount: z.number(), unit: DurationUnit })
      .nullable()
      .describe("Time available from the start, when there is no date."),
    note: z.string(),
  }),
  compliance: Compliance,
  hardConstraints: z.array(z.string()).describe("Constraints that make an option infeasible when violated."),
  softConstraints: z.array(z.string()),
  priorities: z.array(Priority),
  assumptions: z.array(z.string()).describe("Answers the user did not know, turned into explicit assumptions."),
});
export type RequirementsSheet = z.infer<typeof RequirementsSheet>;

export const InterviewQuestion = z.object({
  id: z.string(),
  text: z.string(),
  why: z.string().describe("One short sentence on why this answer matters."),
  examples: z.array(z.string()).describe("Two to four example answers the user can pick from."),
});
export type InterviewQuestion = z.infer<typeof InterviewQuestion>;

export const InterviewTurn = z.object({
  speech: z.string(),
  status: z.enum(["ask", "done"]),
  questions: z.array(InterviewQuestion),
  sheet: RequirementsSheet.nullable(),
});
export type InterviewTurn = z.infer<typeof InterviewTurn>;

export const ComponentKind = z.enum(["client", "service", "database", "storage", "queue", "external", "infra"]);
export type ComponentKind = z.infer<typeof ComponentKind>;

export const Proposal = z.object({
  speech: z.string(),
  title: z.string(),
  summary: z.string(),
  architecture: z.array(z.string()).describe("Main components and how they interact."),
  stack: z.array(z.string()),
  infrastructure: z.array(z.string()).describe("Hosting, environments, CI/CD, data storage."),
  monthlyCost: z.object({
    low: z.number(),
    high: z.number(),
    basis: z.string().describe("What the estimate covers and how it was derived."),
  }),
  estimate: z.object({
    workPackages: z
      .array(
        z.object({
          name: z.string().describe("e.g. Framing, Back end, Front end, Integrations, Testing, Deployment, Project management."),
          description: z.string(),
          effort: z.array(
            z.object({
              role: z.string().describe("A role id of the rate card."),
              low: z.number().describe("Person-days, low estimate."),
              high: z.number().describe("Person-days, high estimate."),
            }),
          ),
        }),
      )
      .describe("The whole build, from framing to deployment and project management."),
    dayRates: z
      .array(z.object({ role: z.string(), dailyRate: z.number() }))
      .describe("Only without a rate card: the daily rate you assume for each role. Empty when a rate card is given."),
    assumptions: z.array(z.string()).describe("What the estimate rests on."),
    exclusions: z.array(z.string()).describe("What the estimate does not cover."),
  }),
  buildTime: z.string(),
  buildWeeks: z
    .object({ low: z.number(), high: z.number() })
    .nullable()
    .describe("Calendar weeks from the start to the launch; null only when it cannot be estimated."),
  components: z
    .array(
      z.object({
        id: z.string().describe("Short identifier, e.g. api, db."),
        label: z.string(),
        kind: ComponentKind,
      }),
    )
    .describe("The main boxes of the architecture diagram: three to nine components."),
  flows: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string() }))
    .describe("Arrows between component ids: who calls or feeds whom."),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
});
/**
 * A proposal as stored. Those made before work packages carry the build cost the model gave itself, and their costs
 * a currency of their own (normalizeSession keeps them readable).
 */
export type Proposal = z.infer<typeof Proposal> & {
  buildCost?: { low: number; high: number; currency: string; basis: string };
};
export type WorkPackage = Proposal["estimate"]["workPackages"][number];

export const Severity = z.enum(["blocking", "major", "minor"]);
export type Severity = z.infer<typeof Severity>;

export const Critique = z.object({
  target: z.string().describe("Seat letter of the proposal being criticised."),
  severity: Severity,
  requirement: z.string().describe("The point of the requirements sheet this critique relies on."),
  point: z.string(),
  argument: z.string(),
});
export type Critique = z.infer<typeof Critique>;

export const CritiqueRound = z.object({
  speech: z.string(),
  critiques: z.array(Critique),
  questionsForUser: z.array(z.string()).describe("Only questions whose answer would change the outcome."),
});
export type CritiqueRound = z.infer<typeof CritiqueRound>;

export const Revision = z.object({
  speech: z.string(),
  replies: z.array(
    z.object({
      critique: z.string().describe("A short quote of the critique being answered."),
      stance: z.enum(["accepted", "partially_accepted", "rejected"]),
      reply: z.string(),
    }),
  ),
  withdrawn: z.boolean().describe("True when this proposer abandons its option."),
  endorses: z.string().nullable().describe("Seat letter of the option this proposer now supports, if withdrawn."),
  proposal: Proposal,
});
export type Revision = z.infer<typeof Revision>;

export const Feasibility = z.enum(["feasible", "conditional", "infeasible"]);
export type Feasibility = z.infer<typeof Feasibility>;

export const Confidence = z.enum(["verified", "estimated", "assumed"]);

export const TopicStatus = z.enum(["agreement", "divided", "opposed"]);
export type TopicStatus = z.infer<typeof TopicStatus>;

export const Verdict = z.object({
  speech: z.string(),
  options: z.array(
    z.object({
      seat: z.string(),
      title: z.string(),
      feasibility: Feasibility,
      reason: z.string(),
      conditions: z.array(z.string()),
      scores: z.array(z.object({ criterion: z.string(), score: z.number().describe("1 to 5.") })),
    }),
  ),
  recommendation: z.object({
    seat: z.string().nullable().describe("Seat letter of the recommended option, null when none is feasible."),
    rationale: z.string(),
  }),
  topics: z
    .array(
      z.object({
        topic: z.string(),
        status: TopicStatus,
        positions: z.array(z.object({ seat: z.string(), position: z.string() })),
      }),
    )
    .describe("The map of the debate: every topic discussed, whether the participants agree, and where each one stands."),
  risks: z.array(
    z.object({
      risk: z.string(),
      likelihood: z.enum(["low", "medium", "high"]),
      impact: z.enum(["low", "medium", "high"]),
      mitigation: z.string(),
    }),
  ),
  roadmap: z.array(z.object({ phase: z.string(), content: z.string(), exitCriterion: z.string() })),
  claims: z.array(z.object({ claim: z.string(), confidence: Confidence })),
  openQuestions: z.array(z.string()),
});
export type Verdict = z.infer<typeof Verdict>;

/** Raised by the arbiter when the participants agree too fast: an angle nobody has examined yet. */
export const Probe = z.object({
  speech: z.string(),
  angle: z.string().describe("One sentence: the question or scenario the participants must now examine."),
  rationale: z.string(),
});
export type Probe = z.infer<typeof Probe>;

export const Audience = z.enum(["cto", "executive", "client"]);
export type Audience = z.infer<typeof Audience>;

/** The verdict rewritten for one kind of reader. */
export const Brief = z.object({
  speech: z.string(),
  headline: z.string(),
  summary: z.string(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
  nextSteps: z.array(z.string()),
});
export type Brief = z.infer<typeof Brief>;

type JsonSchema = { [key: string]: unknown };

// Converts a zod schema to the strict JSON schema dialect both providers accept:
// every object closed and every property required.
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw" }) as JsonSchema;
  delete json.$schema;
  return close(json) as JsonSchema;
}

function close(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(close);
  if (!node || typeof node !== "object") return node;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) out[key] = close(value);
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

export const clampScore = (value: number) => Math.min(5, Math.max(1, Math.round(value)));
