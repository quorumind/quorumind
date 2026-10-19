// The vocabulary of an audit, shared by its schemas (audit.ts), its checks and its labels. Browser-safe.

export const AUDIT_DOCUMENT_KINDS = ["quote", "statement_of_work", "architecture", "technical_proposal", "other"] as const;
export type AuditDocumentKind = (typeof AUDIT_DOCUMENT_KINDS)[number];

export const FINDING_CATEGORIES = [
  "missing",
  "assumption",
  "vague",
  "effort",
  "price",
  "timeline",
  "lock_in",
  "security",
  "legal",
  "other",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** The good practices every audit checks the document against. */
export const AUDIT_CHECKLIST = [
  "tests",
  "security",
  "accessibility",
  "data_migration",
  "documentation",
  "training",
  "maintenance",
  "reversibility",
  "ownership",
  "gdpr",
] as const;
export type ChecklistItem = (typeof AUDIT_CHECKLIST)[number];

/** sound: fit to sign. sound_with_reservations: fit once its major findings are settled. not_sound: not fit as it stands. */
export const AUDIT_OPINIONS = ["sound", "sound_with_reservations", "not_sound"] as const;
export type AuditOpinion = (typeof AUDIT_OPINIONS)[number];

export const COVERAGE_STATUSES = ["covered", "partial", "missing", "not_applicable"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const PRICE_ASSESSMENTS = ["consistent", "high", "low", "unclear"] as const;
export type PriceAssessment = (typeof PRICE_ASSESSMENTS)[number];

export const TIMELINE_ASSESSMENTS = ["realistic", "tight", "unrealistic", "unclear"] as const;
export type TimelineAssessment = (typeof TIMELINE_ASSESSMENTS)[number];
