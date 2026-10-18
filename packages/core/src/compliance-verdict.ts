import { z } from "zod";
import { COMPLIANCE_STATUSES, type ComplianceCheck, type ComplianceRequirement } from "./compliance.ts";
import { toStrictJsonSchema, Verdict, VerdictUpdate } from "./schemas.ts";

// The arbiter's compliance assessment: how each final option meets each requirement of the debate. It is part of the
// verdict when the debate has requirements, and absent otherwise.

export const ComplianceCheckSchema = z.object({
  requirement: z.string().describe("The id of the requirement, as given in brackets."),
  seat: z.string().describe("Seat letter of the option."),
  status: z.enum(COMPLIANCE_STATUSES),
  reason: z.string().describe("One line: how the option meets the requirement, or what is missing."),
});

export const VerdictWithCompliance = Verdict.extend({
  compliance: z.array(ComplianceCheckSchema).describe("Every final option against every compliance requirement."),
});
export type VerdictWithCompliance = z.infer<typeof VerdictWithCompliance>;

/** A revised verdict (rule again on new facts) with its compliance assessment. */
export const VerdictUpdateWithCompliance = VerdictUpdate.extend({
  compliance: z.array(ComplianceCheckSchema).describe("Every final option against every compliance requirement."),
});

/** The schema of a revised verdict when the debate has compliance requirements. */
export const COMPLIANCE_UPDATE = {
  zod: VerdictUpdateWithCompliance,
  json: toStrictJsonSchema(VerdictUpdateWithCompliance),
  name: "verdict_update_compliance",
  maxTokens: 24_000,
} as const;

/** The verdict's schema when the debate has compliance requirements. */
export const COMPLIANCE_VERDICT = {
  zod: VerdictWithCompliance,
  json: toStrictJsonSchema(VerdictWithCompliance),
  name: "verdict_compliance",
  maxTokens: 24_000,
} as const;

/**
 * Keeps the checks of known requirements and options, one per pair, and holds the arbiter to its rule: an option that
 * does not meet a hard requirement is infeasible, and is not recommended.
 */
export function settleCompliance(verdict: VerdictWithCompliance, requirements: readonly ComplianceRequirement[]): VerdictWithCompliance {
  const known = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const seats = new Set(verdict.options.map((option) => option.seat));
  const seen = new Set<string>();
  verdict.compliance = verdict.compliance.flatMap((check) => {
    const requirement = check.requirement.replace(/^\[|\]$/g, "").trim();
    const key = `${requirement}\u0000${check.seat}`;
    if (!known.has(requirement) || !seats.has(check.seat) || seen.has(key)) return [];
    seen.add(key);
    return [{ ...check, requirement, reason: check.reason.trim() }];
  });
  for (const option of verdict.options) {
    const failed = verdict.compliance.find(
      (check) => check.seat === option.seat && check.status === "not_met" && known.get(check.requirement)?.hard,
    );
    if (!failed || option.feasibility === "infeasible") continue;
    option.feasibility = "infeasible";
    if (failed.reason && !option.reason.includes(failed.reason)) option.reason = `${option.reason} ${failed.reason}`.trim();
  }
  const recommended = verdict.options.find((option) => option.seat === verdict.recommendation.seat);
  if (recommended?.feasibility === "infeasible") verdict.recommendation.seat = null;
  return verdict;
}

/** The demo's assessment of its two options, for the requirements of personal data its sheet checks. */
export const DEMO_COMPLIANCE: ComplianceCheck[] = [
  {
    requirement: "gdpr_lawful_basis",
    seat: "A",
    status: "met",
    reason: "Bookings and passes rest on the membership contract; SMS reminders on consent.",
  },
  {
    requirement: "gdpr_lawful_basis",
    seat: "B",
    status: "met",
    reason: "Same purposes and bases; the platform acts on the studios' instructions.",
  },
  {
    requirement: "gdpr_processors",
    seat: "A",
    status: "met",
    reason: "The EU host, the e-mail and SMS providers and Stripe each offer a data processing agreement.",
  },
  {
    requirement: "gdpr_processors",
    seat: "B",
    status: "partly",
    reason: "The platform's agreement and its list of sub-processors still have to be obtained.",
  },
  { requirement: "gdpr_transfers", seat: "A", status: "met", reason: "Hosted in the EU; no transfer outside the EEA is planned." },
  {
    requirement: "gdpr_transfers",
    seat: "B",
    status: "partly",
    reason: "Where the platform stores member data is not confirmed yet.",
  },
  { requirement: "gdpr_retention", seat: "A", status: "partly", reason: "No retention period is set yet for inactive members." },
  { requirement: "gdpr_retention", seat: "B", status: "partly", reason: "Depends on the platform's deletion settings." },
  { requirement: "gdpr_rights", seat: "A", status: "met", reason: "Members export and delete their account from their profile." },
  { requirement: "gdpr_rights", seat: "B", status: "partly", reason: "Export and erasure go through the platform's support." },
  { requirement: "gdpr_security", seat: "A", status: "met", reason: "Managed hosting with encryption, backups and access logs." },
  {
    requirement: "gdpr_security",
    seat: "B",
    status: "met",
    reason: "The platform's security is certified; the studios keep the incident procedure.",
  },
  {
    requirement: "gdpr_dpia",
    seat: "A",
    status: "not_applicable",
    reason: "No sensitive data on a large scale, no systematic monitoring.",
  },
  {
    requirement: "gdpr_dpia",
    seat: "B",
    status: "not_applicable",
    reason: "No sensitive data on a large scale, no systematic monitoring.",
  },
  { requirement: "gdpr_cookies", seat: "A", status: "met", reason: "Audience measurement without trackers that need consent." },
  {
    requirement: "gdpr_cookies",
    seat: "B",
    status: "partly",
    reason: "The platform's widget sets marketing cookies: a consent banner is needed.",
  },
];
