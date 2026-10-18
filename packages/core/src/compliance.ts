// Compliance templates: the regulations a project must meet, on top of its domain template (SaaS, mobile…). Each one adds
// interview focus points and requirements that the proposers must meet, the critics check and the arbiter assesses
// option by option; a hard requirement an option does not meet makes it infeasible.
// The texts go to the models, so they stay in English; compliance-labels.ts gives the documents and the interface a
// short statement of each requirement in every language. They state the rule and its source without adding to it:
// when a rule depends on facts about the project, the text says to check whether it applies.
// Browser-safe: the interface lists the templates and the requirements from here.

import type { Compliance, RequirementsSheet, Verdict } from "./schemas.ts";

export type ComplianceTemplateId = "personal_data" | "health_data" | "public_sector" | "finance" | "consumer";

export interface ComplianceRequirement {
  id: string;
  template: ComplianceTemplateId;
  /** An option that does not meet a hard requirement is infeasible. */
  hard: boolean;
  /** The box of the requirements sheet that brings this requirement in, even when its template was not chosen. */
  flag?: keyof Compliance;
  /** The rule and its source, as the models read it. */
  text: string;
}

export interface ComplianceTemplate {
  /** What the interviewer must also cover. */
  focus: string[];
  /** The boxes of the requirements sheet the template checks. */
  flags: (keyof Compliance)[];
}

export const COMPLIANCE_TEMPLATES: Record<ComplianceTemplateId, ComplianceTemplate> = {
  personal_data: {
    focus: [
      "which personal data is collected, about whom and for which purposes",
      "the lawful basis of each purpose",
      "the providers that will process the data (hosting, e-mail, analytics, support, AI services) and where they process it",
      "how long each kind of data is kept",
      "how people exercise their rights: access, erasure, portability",
      "cookies and trackers",
    ],
    flags: ["gdpr"],
  },
  health_data: {
    focus: [
      "which health data is processed, about whom and for what purpose: care, prevention, research or wellness",
      "on whose behalf the data is hosted, and in which country",
      "who accesses the data and how they sign in",
      "connections to national health services or other health systems",
      "reuse of the data for research or statistics",
    ],
    flags: ["healthData", "gdpr"],
  },
  public_sector: {
    focus: [
      "the public body, and whether its data is sensitive or covered by a secret protected by law",
      "the accessibility level required, and who audits it",
      "procurement: a tender, a framework agreement or an existing contract, and its duration",
      "hosting constraints: qualified cloud offers, the state's own clouds, sovereignty",
      "sign-in for citizens or public agents through the state's identity services",
      "reversibility, open formats and the open-source policy",
    ],
    flags: ["publicSector", "accessibility"],
  },
  finance: {
    focus: [
      "the kind of entity the client is (bank, payment or e-money institution, insurer, investment firm, crypto-asset service provider), or whether it supplies one",
      "whether payment card data is stored, processed or transmitted, and by whom",
      "availability targets, recovery time and recovery point objectives",
      "critical third-party providers, their contracts and the exit plan",
      "incident detection and reporting",
      "audit trails and how long records are kept",
    ],
    flags: [],
  },
  consumer: {
    focus: [
      "the countries of sale, and whether the buyers are consumers or businesses",
      "pre-contractual information, terms of sale and legal notices",
      "withdrawal, returns and refunds",
      "prices shown with taxes and delivery costs, and promotions",
      "customer reviews",
      "accessibility of the shop, and the size of the company (micro-enterprise or not)",
    ],
    flags: [],
  },
};

export const COMPLIANCE_TEMPLATE_IDS = Object.keys(COMPLIANCE_TEMPLATES) as ComplianceTemplateId[];

export const isComplianceTemplateId = (value: unknown): value is ComplianceTemplateId =>
  typeof value === "string" && value in COMPLIANCE_TEMPLATES;

export const COMPLIANCE_REQUIREMENTS: readonly ComplianceRequirement[] = [
  // Personal data (GDPR, regulation (EU) 2016/679).
  {
    id: "gdpr_lawful_basis",
    template: "personal_data",
    hard: true,
    flag: "gdpr",
    text:
      "GDPR articles 5 and 6: each purpose of the processing has a lawful basis (consent, contract, legal obligation, vital interests, " +
      "public task or legitimate interests), and only the personal data that the purpose needs is collected.",
  },
  {
    id: "gdpr_processors",
    template: "personal_data",
    hard: true,
    flag: "gdpr",
    text:
      "GDPR article 28: every provider that processes personal data on the client's behalf (hosting, e-mail, analytics, support, " +
      "AI services) signs a data processing agreement, and its sub-processors are known.",
  },
  {
    id: "gdpr_transfers",
    template: "personal_data",
    hard: true,
    flag: "gdpr",
    text:
      "GDPR chapter V: personal data stored or accessed outside the European Economic Area, remote access by a provider's staff " +
      "included, needs a transfer tool: an adequacy decision (for the United States, only towards a company certified under the " +
      "EU-US Data Privacy Framework), standard contractual clauses with a transfer impact assessment, or another tool of chapter V. " +
      "State where each component stores and processes data.",
  },
  {
    id: "gdpr_retention",
    template: "personal_data",
    hard: true,
    flag: "gdpr",
    text:
      "GDPR article 5(1)(e): each kind of personal data has a retention period, after which it is deleted or anonymised, " +
      "backups and logs included.",
  },
  {
    id: "gdpr_rights",
    template: "personal_data",
    hard: false,
    flag: "gdpr",
    text:
      "GDPR articles 15 to 22: people can exercise their rights (access, rectification, erasure, objection and portability, among " +
      "others); the system can find, export and delete the data of one person.",
  },
  {
    id: "gdpr_security",
    template: "personal_data",
    hard: false,
    flag: "gdpr",
    text:
      "GDPR articles 32 and 33: security appropriate to the risk (access control, encryption where relevant, logs), and a procedure " +
      "to notify a personal data breach to the supervisory authority within 72 hours when notification is required.",
  },
  {
    id: "gdpr_dpia",
    template: "personal_data",
    hard: false,
    flag: "gdpr",
    text:
      "GDPR article 35: a data protection impact assessment is carried out before any processing likely to result in a high risk, " +
      "for example sensitive data on a large scale, systematic monitoring, or profiling with significant effects; supervisory " +
      "authorities such as the CNIL publish lists of such processing. Check whether it applies.",
  },
  {
    id: "gdpr_cookies",
    template: "personal_data",
    hard: false,
    flag: "gdpr",
    text:
      "ePrivacy directive 2002/58/EC article 5(3) (in France, article 82 of the Data Protection Act): cookies and trackers that are " +
      "not strictly necessary need the user's prior consent. Check whether the project uses any.",
  },
  // Health data.
  {
    id: "health_special_category",
    template: "health_data",
    hard: true,
    flag: "healthData",
    text:
      "GDPR article 9: health data is a special category of personal data. Processing it is forbidden unless an exception of " +
      "article 9(2) applies, for example explicit consent, or care provided by health professionals bound by professional secrecy. " +
      "The option names that exception, in addition to the lawful basis of article 6.",
  },
  {
    id: "health_hds",
    template: "health_data",
    hard: true,
    flag: "healthData",
    text:
      "France, article L.1111-8 of the Public Health Code: a provider that hosts, on behalf of someone else, personal health data " +
      "collected during prevention, diagnosis, care or social and medico-social follow-up must be certified HDS (Hébergeur de " +
      "Données de Santé) for the activities it performs. Check whether it applies; when it does, every host of the data, backups " +
      "included, holds that certification.",
  },
  {
    id: "health_hds_location",
    template: "health_data",
    hard: true,
    flag: "healthData",
    text:
      "France, HDS certification framework revised in 2024: a certified host keeps the health data physically in the European " +
      "Economic Area, and states publicly whether the data may be transferred or accessed from outside it. Check whether HDS applies.",
  },
  {
    id: "health_access",
    template: "health_data",
    hard: false,
    flag: "healthData",
    text:
      "GDPR article 32 for health data: access restricted to the people who need it, strong authentication, access logs, and " +
      "encryption in transit and at rest.",
  },
  {
    id: "health_dpia",
    template: "health_data",
    hard: false,
    flag: "healthData",
    text:
      "GDPR article 35: processing health data on a large scale requires a data protection impact assessment before it starts, and " +
      "the CNIL's list covers several kinds of health data processing. Check whether it applies.",
  },
  // Public sector.
  {
    id: "public_secnumcloud",
    template: "public_sector",
    hard: true,
    flag: "publicSector",
    text:
      "France, the state's 'cloud au centre' doctrine and article 31 of law 2024-449 (SREN): state administrations and some of " +
      "their operators host data of particular sensitivity with a cloud offer qualified SecNumCloud by ANSSI, or one with an " +
      "equivalent protection against access by authorities outside the EU. Check whether the client and its data are concerned; " +
      "when they are, only such offers are acceptable.",
  },
  {
    id: "public_accessibility",
    template: "public_sector",
    hard: true,
    flag: "publicSector",
    text:
      "France, article 47 of law 2005-102: public bodies make their websites, intranets, applications and software accessible, " +
      "measured with the RGAA (based on WCAG 2.1 level AA), and publish an accessibility statement and a multi-year plan. Elsewhere " +
      "in the EU, directive (EU) 2016/2102 and the EN 301 549 standard set the same level.",
  },
  {
    id: "public_rgs",
    template: "public_sector",
    hard: false,
    flag: "publicSector",
    text:
      "France, decree 2010-112 (RGS, general security framework): an online service of an administrative authority goes through " +
      "a security accreditation (homologation) before it opens. Check whether it applies, and plan the risk analysis and audits it needs.",
  },
  {
    id: "public_sovereignty",
    template: "public_sector",
    hard: false,
    flag: "publicSector",
    text:
      "Sovereignty: the option states where each component is hosted and by which legal entity, and whether that entity is subject " +
      "to non-EU laws with extraterritorial reach, such as the US CLOUD Act.",
  },
  {
    id: "public_reversibility",
    template: "public_sector",
    hard: false,
    flag: "publicSector",
    text:
      "Reversibility and procurement: the client can recover its data and code in open formats and change provider, and the " +
      "purchase follows public procurement rules (directive 2014/24/EU; in France, the Public Procurement Code), through a " +
      "competitive procedure or an existing framework agreement.",
  },
  // Finance.
  {
    id: "finance_dora",
    template: "finance",
    hard: true,
    text:
      "Regulation (EU) 2022/2554 (DORA), applicable since 17 January 2025: the financial entities of its article 2 (banks, payment " +
      "and e-money institutions, investment firms, insurers, crypto-asset service providers, among others) manage ICT risk, " +
      "classify and report major ICT incidents, and test their digital resilience. Check whether the client is such an entity; " +
      "when it is, the option documents recovery time and recovery point objectives, backups with tested restoration, and incident detection.",
  },
  {
    id: "finance_dora_providers",
    template: "finance",
    hard: true,
    text:
      "DORA articles 28 and 30, when DORA applies: contracts with ICT third-party providers contain the required clauses " +
      "(description and locations of the services, access and audit rights, termination rights, exit strategy), and the entity " +
      "keeps a register of them. Every cloud or software provider of the option accepts such terms, and critical services have an exit plan.",
  },
  {
    id: "finance_pci_dss",
    template: "finance",
    hard: true,
    flag: "paymentCards",
    text:
      "PCI DSS: when the system stores, processes or transmits payment card data, that part of the system complies with the " +
      "PCI DSS standard. A payment provider's hosted payment page or fields keep card data out of the system and reduce that scope; " +
      "the card security code is never stored after authorisation. Check whether it applies.",
  },
  {
    id: "finance_aml_records",
    template: "finance",
    hard: false,
    text:
      "Anti-money laundering, directive (EU) 2015/849 article 40: when the client is an obliged entity, customer due diligence and " +
      "transaction records are kept for five years after the end of the business relationship or the transaction. Check whether it applies.",
  },
  // Consumer law for online sales (business to consumer).
  {
    id: "consumer_information",
    template: "consumer",
    hard: true,
    text:
      "Directive 2011/83/EU article 6: before the order, consumers receive the seller's identity and contact details, the main " +
      "characteristics of the product, the total price with taxes and delivery costs, the payment and delivery terms, the right of " +
      "withdrawal and the legal guarantee.",
  },
  {
    id: "consumer_order_button",
    template: "consumer",
    hard: true,
    text:
      "Directive 2011/83/EU article 8(2): the button that places the order states plainly that ordering means paying, for example " +
      '"order with obligation to pay".',
  },
  {
    id: "consumer_withdrawal",
    template: "consumer",
    hard: true,
    text:
      "Directive 2011/83/EU articles 9 to 16: consumers may withdraw from a distance contract within 14 days without giving a " +
      "reason, except in the cases listed; the seller refunds the payment, standard delivery included, within 14 days of being told " +
      "(it may wait until the goods come back). Directive (EU) 2023/2673 adds, from 19 June 2026, a withdrawal function for " +
      "contracts concluded online: a clearly labelled button available throughout the withdrawal period. Check the national " +
      "transposition in each country of sale.",
  },
  {
    id: "consumer_guarantee",
    template: "consumer",
    hard: false,
    text:
      "Directive (EU) 2019/771: goods sold to consumers carry a legal guarantee of conformity of at least two years; the shop " +
      "informs about it and handles claims.",
  },
  {
    id: "consumer_price_reduction",
    template: "consumer",
    hard: false,
    text:
      "Directive 98/6/EC article 6a: an announced price reduction shows the prior price, the lowest price applied during at least " +
      "the 30 days before the reduction.",
  },
  {
    id: "consumer_reviews",
    template: "consumer",
    hard: false,
    text:
      "Directive 2005/29/EC as amended by directive (EU) 2019/2161: when customer reviews are shown, the shop says whether and how " +
      "it checks that they come from customers who used or bought the product.",
  },
  {
    id: "consumer_accessibility",
    template: "consumer",
    hard: true,
    text:
      "Directive (EU) 2019/882 (European Accessibility Act), applicable since 28 June 2025: e-commerce services offered to consumers " +
      "meet its accessibility requirements, in practice the EN 301 549 standard (WCAG 2.1 level AA for the web). Micro-enterprises " +
      "providing services (fewer than 10 people, and an annual turnover or balance sheet of at most 2 million euros) are exempt. " +
      "Check whether it applies.",
  },
  {
    id: "consumer_mediation",
    template: "consumer",
    hard: false,
    text:
      "France, Consumer Code article L.612-1: the seller gives consumers free access to a consumer mediator, and names it on the " +
      "site and in its terms of sale. Check whether it applies in each country of sale.",
  },
];

/** How an option meets a requirement, as the arbiter assessed it. "not_applicable": the rule does not apply to this project. */
export const COMPLIANCE_STATUSES = ["met", "partly", "not_met", "not_applicable"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export interface ComplianceCheck {
  /** The id of the requirement. */
  requirement: string;
  seat: string;
  status: ComplianceStatus;
  /** One line: how the option meets the requirement, or what is missing. */
  reason: string;
}

/** The compliance assessment of a verdict (compliance-verdict.ts); empty for a verdict without one. */
export function verdictCompliance(verdict: Verdict | null | undefined): ComplianceCheck[] {
  const checks = (verdict as { compliance?: unknown } | null | undefined)?.compliance;
  if (!Array.isArray(checks)) return [];
  return checks.filter(
    (check): check is ComplianceCheck =>
      typeof check?.requirement === "string" &&
      typeof check.seat === "string" &&
      typeof check.reason === "string" &&
      COMPLIANCE_STATUSES.includes(check.status),
  );
}

/** The compliance templates of a session, cleaned: known ids, in the order of COMPLIANCE_TEMPLATE_IDS, without repeats. */
export function cleanTemplates(values: readonly unknown[] | null | undefined): ComplianceTemplateId[] {
  const chosen = new Set((values ?? []).filter(isComplianceTemplateId));
  return COMPLIANCE_TEMPLATE_IDS.filter((id) => chosen.has(id));
}

/**
 * The requirements a debate checks: those of the templates the person chose, and those the requirements sheet brings in
 * through its compliance boxes (personal data, health data, public sector, payment cards).
 */
export function activeRequirements(session: {
  complianceTemplates?: readonly ComplianceTemplateId[] | null;
  sheet: Pick<RequirementsSheet, "compliance"> | null;
}): ComplianceRequirement[] {
  const templates = new Set(session.complianceTemplates ?? []);
  const boxes = session.sheet?.compliance;
  return COMPLIANCE_REQUIREMENTS.filter(
    (requirement) => templates.has(requirement.template) || (requirement.flag !== undefined && boxes?.[requirement.flag] === true),
  );
}

/** Checks the boxes of the sheet that the chosen templates stand for; the person can still uncheck them at the review. */
export function withTemplateFlags<T extends Pick<RequirementsSheet, "compliance">>(
  sheet: T,
  templates: readonly ComplianceTemplateId[],
): T {
  const flags = templates.flatMap((id) => COMPLIANCE_TEMPLATES[id].flags);
  if (flags.every((flag) => sheet.compliance[flag])) return sheet;
  return { ...sheet, compliance: { ...sheet.compliance, ...Object.fromEntries(flags.map((flag) => [flag, true])) } };
}

const TEMPLATE_NAMES: Record<ComplianceTemplateId, string> = {
  personal_data: "personal data (GDPR)",
  health_data: "health data",
  public_sector: "public sector",
  finance: "finance",
  consumer: "consumer law for online sales",
};

/** What the interviewer must also cover for the chosen templates; empty without any. */
export function complianceInterviewRule(templates: readonly ComplianceTemplateId[]): string {
  if (templates.length === 0) return "";
  const focus = templates.flatMap((id) => COMPLIANCE_TEMPLATES[id].focus);
  return `

Compliance: the person chose these compliance templates: ${templates.map((id) => TEMPLATE_NAMES[id]).join(", ")}.
Also make sure you cover ${focus.join("; ")}.
Whether a regulation applies often depends on facts such as who the client is or what data is processed: ask instead of assuming,
and record what stays unknown as an assumption.`;
}

/** The requirements as the models read them, one per line, with their id. */
function requirementLines(requirements: readonly ComplianceRequirement[]): string {
  return requirements.map((requirement) => `- [${requirement.id}]${requirement.hard ? " [hard]" : ""} ${requirement.text}`).join("\n");
}

export type ComplianceRole = "design" | "critique" | "arbiter";

const ROLE_RULES: Record<ComplianceRole, string> = {
  design: `Meet every requirement. Say in the proposal how the option meets each hard one: where data is hosted and by whom,
which certifications the providers hold, which contracts are needed. When a requirement depends on facts the sheet does not give,
state your assumption.`,
  critique: `An option that fails a hard requirement that applies to this project gets a "blocking" critique, which names the requirement id in "requirement".`,
  arbiter: `In "compliance", assess every final option against every requirement above: one entry per option and requirement, with
"status" set to "met", "partly", "not_met", or "not_applicable" when the requirement does not apply to this project, and a reason of one line.
An option with "not_met" on a hard requirement is infeasible: say which requirement in its reason.`,
};

/** The compliance requirements of a debate, for one role, to append to its instructions; empty without any. */
export function complianceRule(requirements: readonly ComplianceRequirement[], role: ComplianceRole): string {
  if (requirements.length === 0) return "";
  return `

Compliance requirements of this project, each with its id. "[hard]" marks a hard constraint: an option that does not meet it is infeasible.
When a requirement says to check whether it applies, decide from the requirements sheet, and say what you assume when it does not tell.
${requirementLines(requirements)}
${ROLE_RULES[role]}`;
}
