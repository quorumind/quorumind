import { z } from "zod";
import {
  AUDIT_CHECKLIST,
  AUDIT_DOCUMENT_KINDS,
  AUDIT_OPINIONS,
  COVERAGE_STATUSES,
  FINDING_CATEGORIES,
  PRICE_ASSESSMENTS,
  TIMELINE_ASSESSMENTS,
} from "./audit-constants.ts";
import { ComplianceCheckSchema } from "./compliance-verdict.ts";
import { Severity, toStrictJsonSchema, Verdict, VerdictUpdate } from "./schemas.ts";

export * from "./audit-constants.ts";

// The audit of a document the person received from a provider: a quote, a statement of work, an architecture or a
// technical proposal. The formalizer restates what the document commits to, the critics examine it against the need
// and good practice, and the arbiter gives an opinion with findings, questions to ask and points to negotiate.
// As in schemas.ts, every schema here is sent to the models as a strict JSON schema: optional values are nullable.

/** A passage of the audited document, copied word for word; empty when the document says nothing about the point. */
const Quote = z
  .string()
  .describe(
    "The exact passage of the document, copied word for word, at most two sentences; empty when the document says nothing about it.",
  );

/** What the document says about one of its terms, or null when it says nothing. */
const Term = z.string().nullable().describe("What the document says about it, in one or two sentences; null when it says nothing.");

/** What the audited document commits to, as written: its figures are never completed or corrected here. */
export const AuditExtraction = z.object({
  speech: z.string(),
  title: z.string().describe("What the document is, e.g. Quote for a booking website."),
  provider: z.string().nullable().describe("The provider's name as the document gives it; null when it gives none."),
  kind: z.enum(AUDIT_DOCUMENT_KINDS),
  summary: z.string().describe("Two or three sentences: what the provider offers to do, in plain words."),
  currency: z.string().nullable().describe("ISO 4217 code of the document's amounts, e.g. EUR; null when it states no amount."),
  scope: z.array(z.string()).describe("What the document commits to build or do, item by item."),
  deliverables: z.array(z.string()),
  workPackages: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        days: z.number().nullable().describe("Person-days the document states for this line; null when it states none."),
        dailyRate: z.number().nullable().describe("The day rate the document applies to this line; null when it states none."),
        amount: z.number().nullable().describe("The amount the document states for this line, as written; null when it states none."),
        quote: Quote,
      }),
    )
    .describe(
      "The document's own breakdown, line by line, with its figures as written. Never compute a figure the document does not give.",
    ),
  dayRates: z
    .array(z.object({ role: z.string(), dailyRate: z.number(), quote: Quote }))
    .describe("Day rates the document states apart from its lines, e.g. a rate card."),
  total: z
    .object({
      amount: z.number().nullable().describe("The total price as stated; null when the document states none."),
      taxIncluded: z
        .boolean()
        .nullable()
        .describe("True when the total includes tax (VAT), false when it excludes it, null when the document does not say."),
      quote: Quote,
    })
    .describe("The total price of the build, as the document states it."),
  monthlyCost: z
    .object({
      amount: z
        .number()
        .nullable()
        .describe(
          "Recurring cost per month the document states (hosting, maintenance, licences); a yearly amount divided by 12; null when it states none.",
        ),
      quote: Quote,
    })
    .describe("The recurring cost after the launch."),
  timeline: z.object({
    text: Term,
    weeks: z
      .number()
      .nullable()
      .describe("Calendar weeks from the start to the delivery, when the document allows it to be read; null otherwise."),
    quote: Quote,
  }),
  technologies: z.array(z.string()),
  hosting: Term,
  maintenance: Term.describe("Maintenance and support after the delivery: what it covers, for how long, at what price."),
  warranties: Term,
  paymentTerms: Term,
  ownership: Term.describe("Who owns the code, the designs and the data, and what is handed over at the end."),
  exclusions: z.array(z.string()),
  assumptions: z.array(z.string()).describe("What the document assumes the client provides or decides."),
});
export type AuditExtraction = z.infer<typeof AuditExtraction>;

/** What a critic found in the document. Code adds the target (always the document, seat U) to make it a critique. */
export const AuditFindingInput = z.object({
  severity: Severity,
  category: z.enum(FINDING_CATEGORIES),
  requirement: z.string().describe("The point of the requirements sheet, or the good practice, the finding relies on."),
  point: z.string().describe("The finding in one sentence."),
  argument: z.string().describe("Why it matters for this project, and what would fix it."),
  quote: Quote,
  ask: z.string().describe("The question to ask the provider about it, ready to send; empty when there is none."),
});

export const AuditCritiqueInput = z.object({
  speech: z.string(),
  findings: z.array(AuditFindingInput),
  questionsForUser: z.array(z.string()).describe("Only questions to the person whose answer would change your judgement."),
});
export type AuditCritiqueInput = z.infer<typeof AuditCritiqueInput>;

/** A critic's finding as stored: a critique of option U with the passage it is about and the question it raises. */
export type AuditFinding = z.infer<typeof AuditFindingInput> & { target: string };

/** The arbiter's audit of the document, ruled with the rest of the verdict. */
export const AuditReport = z.object({
  opinion: z
    .enum(AUDIT_OPINIONS)
    .describe("sound: fit to sign. sound_with_reservations: fit once the major findings are settled. not_sound: not fit as it stands."),
  findings: z
    .array(
      z.object({
        severity: Severity,
        category: z.enum(FINDING_CATEGORIES),
        title: z.string().describe("The finding in one sentence."),
        detail: z.string().describe("Why it matters for this project."),
        quote: Quote,
        fix: z.string().describe("What the document should say or change."),
      }),
    )
    .describe("Every finding that holds, merged when the critics found the same thing, most serious first."),
  coverage: z
    .array(z.object({ item: z.enum(AUDIT_CHECKLIST), status: z.enum(COVERAGE_STATUSES), note: z.string() }))
    .describe("Every item of the checklist, once each: whether the document covers it."),
  price: z.object({
    assessment: z.enum(PRICE_ASSESSMENTS),
    market: z
      .object({ low: z.number(), high: z.number(), basis: z.string().describe("What the range covers and how it was estimated.") })
      .nullable()
      .describe(
        "The usual market price for this scope, as a range in the currency named in <rates>: an estimate, never a fact. Null when it cannot be estimated.",
      ),
    comment: z.string(),
  }),
  timeline: z.object({ assessment: z.enum(TIMELINE_ASSESSMENTS), comment: z.string() }),
  questions: z
    .array(z.string())
    .describe("Questions to send the provider, each one self-contained and polite, ready to send, most important first."),
  negotiation: z.array(z.string()).describe("Points to negotiate before signing, most valuable first."),
});
export type AuditReport = z.infer<typeof AuditReport>;

export const AuditVerdict = Verdict.extend({ audit: AuditReport });
export const AuditVerdictUpdate = VerdictUpdate.extend({ audit: AuditReport });

const Compliance = z.array(ComplianceCheckSchema).describe("Every final option against every compliance requirement.");

const output = <T extends z.ZodType>(zod: T, name: string, maxTokens: number) => ({ zod, json: toStrictJsonSchema(zod), name, maxTokens });

// What each step of an audit answers with, in place of the schema of the debate task it stands for.
export const AUDIT_EXTRACTION = output(AuditExtraction, "audit_extraction", 12_000);
export const AUDIT_FINDINGS = output(AuditCritiqueInput, "audit_findings", 10_000);
const AUDIT_VERDICTS = {
  plain: output(AuditVerdict, "audit_verdict", 24_000),
  compliance: output(AuditVerdict.extend({ compliance: Compliance }), "audit_verdict_compliance", 24_000),
};
const AUDIT_UPDATES = {
  plain: output(AuditVerdictUpdate, "audit_verdict_update", 24_000),
  compliance: output(AuditVerdictUpdate.extend({ compliance: Compliance }), "audit_verdict_update_compliance", 24_000),
};

/** The audit's verdict, with the compliance assessment when the debate has compliance requirements. */
export const auditVerdictOutput = (compliance: boolean) => AUDIT_VERDICTS[compliance ? "compliance" : "plain"];
/** The audit ruled again on new facts, with the compliance assessment when the debate has compliance requirements. */
export const auditUpdateOutput = (compliance: boolean) => AUDIT_UPDATES[compliance ? "compliance" : "plain"];

/** A verdict with its audit, as an audit session stores it. */
export type AuditedVerdict = Verdict & { audit: AuditReport };

/** How an audit session is set up, and what the document was read to commit to. */
export interface AuditSettings {
  /** The attached documents under audit, by id; the others are background, such as the person's own specification. */
  documentIds: string[];
  /** A proposer sketches one alternative approach, without reading the document, for comparison. */
  alternative: boolean;
  /** What the document commits to, as the formalizer read it; null until then. */
  extraction: AuditExtraction | null;
}
