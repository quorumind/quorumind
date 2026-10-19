import type { z } from "zod";
import type { AuditCritiqueInput, AuditExtraction, AuditVerdict, AuditVerdictUpdate } from "./audit.ts";
import type { ComplianceCheck } from "./compliance.ts";
import { DEMO_COMPLIANCE } from "./compliance-verdict.ts";

// A scripted audit, replayed by the mock provider for the tests and the quality bench. It audits the fictional quote
// of bench/fixtures/web-agency-quote.md against the need of the demo (DEMO_SHEET): every passage quoted here is copied
// from that quote, word for word.

const EXTRACTION: AuditExtraction = {
  speech:
    "Pixelforge Studio offers to build a WordPress booking website for the 12 studios in 10 weeks, for 38,000 € excluding VAT, then to host and maintain it for 240 € a month.",
  title: "Quote Q-2026-117: booking website",
  provider: "Pixelforge Studio",
  kind: "quote",
  summary:
    "A responsive WordPress website with an adapted booking plugin: class schedules per studio, booking and cancellation, passes paid through Stripe, e-mail reminders and a back office. Hosting and maintenance by the agency.",
  currency: "EUR",
  scope: [
    "Responsive website on WordPress with an adapted booking plugin",
    "Class schedule for each studio, managed by the studio managers",
    "Online booking and cancellation of classes",
    "Sale of 5-class and 10-class passes through Stripe",
    "E-mail reminders 24 hours before each class",
    "Back office for the network's staff",
    "Data migration from the current tool, if needed",
  ],
  deliverables: ["The website in production", "Training of the staff"],
  workPackages: [
    {
      name: "Project management",
      description: "",
      days: 6,
      dailyRate: 600,
      amount: 3_600,
      quote: "| Project management | 6 | 600 € | 3,600 € |",
    },
    {
      name: "UX and visual design",
      description: "",
      days: 8,
      dailyRate: 650,
      amount: 5_200,
      quote: "| UX and visual design | 8 | 650 € | 5,200 € |",
    },
    {
      name: "WordPress development and plugin adaptation",
      description: "",
      days: 30,
      dailyRate: 600,
      amount: 18_000,
      quote: "| WordPress development and plugin adaptation | 30 | 600 € | 18,000 € |",
    },
    {
      name: "Payment and passes",
      description: "",
      days: 8,
      dailyRate: 600,
      amount: 5_800,
      quote: "| Payment and passes | 8 | 600 € | 5,800 € |",
    },
    {
      name: "Testing and acceptance",
      description: "",
      days: 4,
      dailyRate: 550,
      amount: 2_200,
      quote: "| Testing and acceptance | 4 | 550 € | 2,200 € |",
    },
    {
      name: "Deployment and training",
      description: "",
      days: 3,
      dailyRate: 600,
      amount: 1_800,
      quote: "| Deployment and training | 3 | 600 € | 1,800 € |",
    },
  ],
  dayRates: [],
  total: { amount: 38_000, taxIncluded: false, quote: "Total: 38,000 € excl. VAT" },
  monthlyCost: { amount: 240, quote: "Hosting on our managed WordPress server: 90 € excl. VAT per month." },
  timeline: {
    text: "Delivery 10 weeks after the order and the deposit, provided the content is supplied on time.",
    weeks: 10,
    quote: "Delivery 10 weeks after the order and receipt of the deposit",
  },
  technologies: ["WordPress", "Booking plugin", "Stripe"],
  hosting: "On the agency's managed WordPress server, for 90 € excluding VAT a month; its location is not stated.",
  maintenance: "Corrective maintenance and plugin updates for 150 € excluding VAT a month, with a 12-month commitment.",
  warranties: "Bugs reported within one month of delivery are fixed at no cost.",
  paymentTerms: "40% on order, 40% at the approval of the designs, 20% on delivery.",
  ownership: null,
  exclusions: ["Writing of the texts and photographs", "Translation into other languages", "Stripe fees"],
  assumptions: [
    "The client supplies the texts and pictures before development starts",
    "Specific developments beyond the plugin's standard features are quoted separately",
  ],
};

const FINDINGS: Record<string, AuditCritiqueInput> = {
  A: {
    speech:
      "The scope matches most of the need, but the price is far above the budget and two lines of the breakdown do not add up. SMS reminders, a must-have, are missing.",
    findings: [
      {
        severity: "blocking",
        category: "price",
        requirement: "Build budget of €15,000",
        point: "The quote is more than twice the build budget.",
        argument:
          "At 38,000 € excluding VAT the build alone exceeds the budget by 23,000 €. Either the scope is cut to the must-haves, or the plugin is used as it is instead of being adapted for 30 days.",
        quote: "Total: 38,000 € excl. VAT",
        ask: "Which lines could be reduced or removed to bring the build under 20,000 € excluding VAT, and what would each saving cost in features?",
      },
      {
        severity: "major",
        category: "price",
        requirement: "Consistency of the figures",
        point: "The payment line and the total do not match the days and rates of the breakdown.",
        argument: "8 days at 600 € make 4,800 €, not 5,800 €, and the lines add up to 36,600 €, not 38,000 €: 2,400 € are not explained.",
        quote: "| Payment and passes | 8 | 600 € | 5,800 € |",
        ask: "Can you explain the 5,800 € of the payment line, which is 8 days at 600 €, and the 1,400 € between the sum of the lines and the total?",
      },
      {
        severity: "major",
        category: "missing",
        requirement: "Email and SMS reminders (must have)",
        point: "Only e-mail reminders are quoted: SMS reminders are missing.",
        argument: "SMS reminders are a must-have to cut no-shows. Their set-up and their running cost per message must be quoted.",
        quote: "E-mail reminders 24 hours before each class.",
        ask: "Can you add SMS reminders to the quote, with their set-up cost and the cost per message?",
      },
    ],
    questionsForUser: [],
  },
  B: {
    speech:
      "The timeline fits the deadline and the payment terms are usual, but the commitments on migration and specific developments are vague, and nothing says who owns the website.",
    findings: [
      {
        severity: "major",
        category: "vague",
        requirement: "Migration of the current bookings and members",
        point: "Data migration is promised only if needed, with no days and no amount.",
        argument: 'Members and their passes must be moved: "if needed" leaves both the work and its price open.',
        quote: "Data migration from the current tool if needed.",
        ask: "Is the migration of members, passes and bookings from our current tool included in the 38,000 €, and how many days does it take?",
      },
      {
        severity: "major",
        category: "assumption",
        requirement: "A firm price",
        point: "Any need beyond the plugin's standard features is billed separately.",
        argument:
          "Rules such as cancellation deadlines per studio may fall outside the plugin: this assumption can turn the fixed price into a moving one.",
        quote: "specific developments will be quoted separately if necessary",
        ask: "Which of our booking rules does the plugin cover as it is, and which would be specific developments?",
      },
      {
        severity: "major",
        category: "legal",
        requirement: "Good practice: ownership of the code and the data",
        point: "The quote does not say who owns the code, the designs and the data.",
        argument: "Without a transfer of rights and of the data, the network cannot change provider without starting again.",
        quote: "",
        ask: "Will the source code, the designs and the data belong to us at the end of the project, with the access to the hosting?",
      },
    ],
    questionsForUser: [],
  },
  devil: {
    speech:
      "The real cost is in the hosting and maintenance: the website lives on the agency's server, with a year of commitment, and the warranty is short.",
    findings: [
      {
        severity: "blocking",
        category: "lock_in",
        requirement: "Member data hosted in the EU (GDPR)",
        point: "The website is hosted on the agency's own server, and the quote does not say where.",
        argument:
          "The EU hosting of member data is a hard constraint, and hosting with the agency ties the network to it: leaving means moving the site, the plugin and the data.",
        quote: "Hosting on our managed WordPress server: 90 € excl. VAT per month.",
        ask: "Where is your server located, who is its hosting provider, and how would we move the website and its data to another host?",
      },
      {
        severity: "minor",
        category: "legal",
        requirement: "Good practice: a warranty of three to twelve months",
        point: "The warranty lasts one month only.",
        argument: "Booking peaks reveal bugs after the launch: a month leaves the first busy weeks uncovered.",
        quote: "Bugs reported within one month of delivery are fixed at no cost.",
        ask: "Could the warranty be extended to three months after delivery?",
      },
    ],
    questionsForUser: ["Must your two developers be able to maintain the website themselves, or would you leave it to the agency?"],
  },
};

const REPORT = {
  opinion: "not_sound",
  findings: [
    {
      severity: "blocking",
      category: "price",
      title: "The quote is more than twice the build budget.",
      detail: "38,000 € excluding VAT against a budget of 15,000 €: the build alone exceeds it by 23,000 €.",
      quote: "Total: 38,000 € excl. VAT",
      fix: "Ask for a version reduced to the must-haves, using the booking plugin as it is.",
    },
    {
      severity: "blocking",
      category: "lock_in",
      title: "The hosting location is not stated, and the website is hosted by the agency.",
      detail: "Member data must stay in the EU, and hosting with the agency makes leaving it costly.",
      quote: "Hosting on our managed WordPress server: 90 € excl. VAT per month.",
      fix: "Name an EU host, and give the network the hosting account and its access.",
    },
    {
      severity: "major",
      category: "price",
      title: "The breakdown does not add up.",
      detail: "The payment line is 1,000 € above its days and rate, and the lines add up to 36,600 € against a total of 38,000 €.",
      quote: "| Payment and passes | 8 | 600 € | 5,800 € |",
      fix: "Correct the payment line and explain or remove the difference with the total.",
    },
    {
      severity: "major",
      category: "missing",
      title: "SMS reminders, a must-have, are not quoted.",
      detail: "Only e-mail reminders are included.",
      quote: "E-mail reminders 24 hours before each class.",
      fix: "Add SMS reminders with their set-up and their cost per message.",
    },
    {
      severity: "major",
      category: "legal",
      title: "Nothing says who owns the code, the designs and the data.",
      detail: "Without a transfer of rights, changing provider means starting again.",
      quote: "",
      fix: "Add a clause transferring the code, the designs and the data to the network on full payment.",
    },
    {
      severity: "major",
      category: "vague",
      title: "The migration and the specific developments are left open.",
      detail: "Both can add days to a price presented as fixed.",
      quote: "Data migration from the current tool if needed.",
      fix: "Quote the migration in days, and list the booking rules the plugin covers as it is.",
    },
    {
      severity: "minor",
      category: "legal",
      title: "The warranty lasts one month only.",
      detail: "The first busy weeks after the launch are not covered.",
      quote: "Bugs reported within one month of delivery are fixed at no cost.",
      fix: "Extend the warranty to three months.",
    },
  ],
  coverage: [
    { item: "tests", status: "partial", note: "Four days of testing and acceptance, with no test plan or acceptance criteria." },
    { item: "security", status: "missing", note: "Nothing on updates of WordPress itself, backups or access control." },
    { item: "accessibility", status: "not_applicable", note: "No accessibility standard is required, though good practice still applies." },
    { item: "data_migration", status: "partial", note: "Promised only if needed, with no days." },
    { item: "documentation", status: "missing", note: "No documentation for the staff or for another provider." },
    { item: "training", status: "partial", note: "Included in the deployment line, with no duration." },
    { item: "maintenance", status: "covered", note: "150 € a month for corrective maintenance and plugin updates, for 12 months." },
    { item: "reversibility", status: "missing", note: "Nothing on how to leave the agency's hosting." },
    { item: "ownership", status: "missing", note: "Nothing on the ownership of the code, the designs and the data." },
    {
      item: "gdpr",
      status: "missing",
      note: "No data processing agreement and no hosting location, although member data is personal data.",
    },
  ],
  price: {
    assessment: "high",
    market: {
      low: 22_000,
      high: 40_000,
      basis: "A WordPress booking website with payments for a network of studios, built by a French agency: estimate.",
    },
    comment:
      "The day rates are usual for an agency, but 30 days to adapt a plugin is a lot, and 2,400 € of the total are not explained by the breakdown.",
  },
  timeline: { assessment: "realistic", comment: "10 weeks fit the scope and the 5 months available, if the content is ready on time." },
  questions: [
    "Can you explain the 5,800 € of the payment line, which is 8 days at 600 €, and the 1,400 € between the sum of the lines and the total?",
    "Where is your server located, who is its hosting provider, and how would we move the website and its data to another host?",
    "Will the source code, the designs and the data belong to us at the end of the project, with the access to the hosting?",
    "Is the migration of members, passes and bookings from our current tool included in the 38,000 €, and how many days does it take?",
    "Can you add SMS reminders to the quote, with their set-up cost and the cost per message?",
    "Which of our booking rules does the plugin cover as it is, and which would be specific developments?",
    "Which lines could be reduced or removed to bring the build under 20,000 € excluding VAT?",
  ],
  negotiation: [
    "A version reduced to the must-haves, with the plugin used as it is",
    "The transfer of the code, the designs and the data on full payment",
    "Hosting in the EU on an account in the network's name",
    "A three-month warranty",
    "Maintenance without a 12-month commitment",
  ],
} satisfies z.infer<typeof AuditVerdict>["audit"];

const VERDICT: z.infer<typeof AuditVerdict> = {
  speech:
    "The quote describes the right website, but not at the right price nor on the right terms: it is more than twice the budget, does not say where member data is hosted, and leaves the code and the data with the agency. Send the questions before negotiating.",
  options: [
    {
      seat: "U",
      title: "Quote Q-2026-117: booking website",
      feasibility: "infeasible",
      reason: "It exceeds the build budget by 23,000 € and does not show that member data stays in the EU, a hard constraint.",
      conditions: ["A version under 20,000 €", "EU hosting stated in the contract"],
      scores: [
        { criterion: "Running cost", score: 4 },
        { criterion: "Time to market", score: 4 },
        { criterion: "Ease of maintenance", score: 2 },
        { criterion: "Scalability", score: 3 },
      ],
    },
    {
      seat: "A",
      title: "Custom React app with managed EU hosting",
      feasibility: "conditional",
      reason: "An independent estimate of the same need, built by the in-house team, lands near the budget.",
      conditions: ["The two developers are available three days a week"],
      scores: [
        { criterion: "Running cost", score: 4 },
        { criterion: "Time to market", score: 3 },
        { criterion: "Ease of maintenance", score: 4 },
        { criterion: "Scalability", score: 4 },
      ],
    },
  ],
  recommendation: {
    seat: null,
    rationale:
      "Do not sign the quote as it stands. Send the questions, ask for a version reduced to the must-haves with EU hosting and the transfer of the code and the data, then compare it again with your budget.",
  },
  topics: [
    {
      topic: "Price against the budget",
      status: "agreement",
      positions: [
        { seat: "A", position: "More than twice the budget." },
        { seat: "devil", position: "The monthly costs add to it for a year at least." },
      ],
    },
    {
      topic: "Seriousness of the hosting terms",
      status: "divided",
      positions: [
        { seat: "B", position: "A question to clear up." },
        { seat: "devil", position: "Blocking until the EU location is in the contract." },
      ],
    },
  ],
  risks: [
    {
      risk: "Specific developments billed on top of the fixed price",
      likelihood: "high",
      impact: "medium",
      mitigation: "List the booking rules in the contract and have the agency say which ones the plugin covers.",
    },
    {
      risk: "Being tied to the agency for hosting and maintenance",
      likelihood: "medium",
      impact: "high",
      mitigation: "Hosting account in the network's name and a clause transferring the code and the data.",
    },
  ],
  roadmap: [
    { phase: "Send the questions", content: "Send the seven questions to the agency.", exitCriterion: "Written answers to every question" },
    {
      phase: "Negotiate",
      content: "Ask for a version reduced to the must-haves with the points to negotiate.",
      exitCriterion: "A revised quote under 20,000 €",
    },
    { phase: "Decide", content: "Run the audit again on the revised quote before signing.", exitCriterion: "No blocking finding left" },
  ],
  claims: [
    { claim: "The lines of the breakdown add up to 36,600 €, against a stated total of 38,000 €.", confidence: "verified" },
    { claim: "A comparable website costs 22,000 € to 40,000 € from a French agency.", confidence: "estimated" },
    { claim: "The booking plugin covers cancellations by studio without specific development.", confidence: "assumed" },
  ],
  openQuestions: ["Must your two developers be able to maintain the website themselves?"],
  audit: REPORT,
};

const REASSESSMENT: z.infer<typeof AuditVerdictUpdate> = {
  ...VERDICT,
  speech:
    "The agency's answers settle the hosting and the ownership: the website will be hosted in France on an account in your name, and the code and data will be yours. The price is still above the budget.",
  options: VERDICT.options.map((option) =>
    option.seat === "U"
      ? {
          ...option,
          feasibility: "conditional",
          reason: "The hosting and the ownership are settled; the price still has to come down.",
          conditions: ["A version under 20,000 €"],
        }
      : option,
  ),
  recommendation: { seat: "U", rationale: "Sign once the reduced version is under 20,000 € and the payment line is corrected." },
  audit: {
    ...REPORT,
    opinion: "sound_with_reservations",
    findings: REPORT.findings.filter((finding) => finding.category !== "lock_in" && finding.category !== "legal"),
    questions: REPORT.questions.filter(
      (question) => !question.startsWith("Where is your server") && !question.startsWith("Will the source code"),
    ),
  },
  costs: [],
  schedules: [],
};

/** The quote against the requirements of personal data the demo's sheet checks; the alternative keeps the demo's own. */
const COMPLIANCE: ComplianceCheck[] = [
  { requirement: "gdpr_lawful_basis", seat: "U", status: "met", reason: "Bookings and passes rest on the membership contract." },
  {
    requirement: "gdpr_processors",
    seat: "U",
    status: "not_met",
    reason: "No data processing agreement with the agency, which hosts the data.",
  },
  { requirement: "gdpr_transfers", seat: "U", status: "not_met", reason: "The quote does not say where the agency's server is." },
  { requirement: "gdpr_retention", seat: "U", status: "partly", reason: "No retention period is mentioned yet." },
  { requirement: "gdpr_rights", seat: "U", status: "partly", reason: "Depends on what the booking plugin can export and delete." },
  {
    requirement: "gdpr_security",
    seat: "U",
    status: "partly",
    reason: "Plugin updates are maintained; backups and access control are not mentioned.",
  },
  ...DEMO_COMPLIANCE.filter((check) => check.seat === "A"),
];

/** After the agency's answers: the data is hosted in France, under a data processing agreement. */
const REVISED_COMPLIANCE: ComplianceCheck[] = COMPLIANCE.map((check) =>
  check.seat === "U" && (check.requirement === "gdpr_processors" || check.requirement === "gdpr_transfers")
    ? { ...check, status: "met", reason: "Hosted in France by the agency, under a data processing agreement." }
    : check,
);

/** The scripted answer to an audit call, by the name of its schema, or undefined for any other call. */
export function demoAuditAnswer(schemaName: string, seat: string | null): unknown {
  switch (schemaName) {
    case "audit_extraction":
      return EXTRACTION;
    case "audit_findings":
      return FINDINGS[seat ?? "A"] ?? { speech: "No further finding.", findings: [], questionsForUser: [] };
    case "audit_verdict":
      return VERDICT;
    case "audit_verdict_compliance":
      return { ...VERDICT, compliance: COMPLIANCE };
    case "audit_verdict_update":
      return REASSESSMENT;
    case "audit_verdict_update_compliance":
      return { ...REASSESSMENT, compliance: REVISED_COMPLIANCE };
    default:
      return undefined;
  }
}
