import type { CritiqueRound, InterviewTurn, Proposal, RequirementsSheet, Revision, Verdict } from "./schemas.ts";

// A complete scripted debate, replayed by the mock provider so people can try Quorumind
// without an API key, and used by the tests and the quality bench.

export const DEMO_IDEA =
  "An online booking and membership app for our network of 12 yoga studios: members book classes, buy passes and get reminders.";

export const DEMO_QUESTIONS: InterviewTurn = {
  speech:
    "A booking app for 12 studios is a clear goal. Before the models start designing, I need your budget, your team and your constraints, because they decide which options are even possible.",
  status: "ask",
  questions: [
    {
      id: "budget",
      text: "What can you spend to build it, and each month to run it?",
      why: "The monthly budget rules out some hosted platforms straight away.",
      examples: ["€15,000 to build, €400 a month", "As little as possible", "I don't know yet"],
    },
    {
      id: "team",
      text: "Who will build and maintain it?",
      why: "A solution your team cannot maintain becomes a risk after launch.",
      examples: ["Two JavaScript developers, part time", "An agency", "Nobody technical in-house"],
    },
    {
      id: "constraints",
      text: "Are there constraints you cannot negotiate?",
      why: "A violated hard constraint makes an option infeasible.",
      examples: ["Member data must stay in the EU", "Must launch before September", "None"],
    },
  ],
  sheet: null,
};

export const DEMO_SHEET: RequirementsSheet = {
  projectName: "Studio booking app",
  summary:
    "A web and mobile-friendly app where members of 12 yoga studios book classes, buy passes and receive reminders, and studio managers manage schedules.",
  goals: ["Replace phone and email bookings", "Sell passes online", "Cut no-shows with reminders"],
  successCriteria: ["70% of bookings online after 6 months", "No-show rate below 8%"],
  mustHave: ["Class schedule per studio", "Booking and cancellation", "Pass purchase with card payment", "Email and SMS reminders"],
  niceToHave: ["Waiting lists", "Teacher substitution", "Native mobile apps"],
  outOfScope: ["Accounting", "Payroll"],
  users: "About 4,000 members at launch, 6,000 in a year; peak on Sunday evenings when the week's classes open.",
  budget: "€15,000 to build, at most €400 per month to run.",
  existingInfrastructure: ["Website on a shared WordPress host", "Stripe account already open"],
  team: "Two JavaScript developers, about 3 days a week each, comfortable with React and Node.js.",
  deadline: "Launch before September, about 5 months away.",
  hardConstraints: ["Member data hosted in the EU (GDPR)", "Running cost at most €400 per month"],
  softConstraints: ["Reuse the existing Stripe account", "Studio managers are not technical"],
  priorities: [
    { criterion: "Running cost", weight: 5 },
    { criterion: "Time to market", weight: 4 },
    { criterion: "Ease of maintenance", weight: 4 },
    { criterion: "Scalability", weight: 2 },
  ],
  assumptions: ["SMS reminders can be capped to keep the monthly cost under budget"],
};

export const DEMO_DONE: InterviewTurn = {
  speech:
    "Thank you, I have what the debate needs. Please check the requirements sheet: the proposers will treat the hard constraints as non-negotiable.",
  status: "done",
  questions: [],
  sheet: DEMO_SHEET,
};

const PROPOSAL_A: Proposal = {
  speech:
    "I propose a custom app on a stack your developers already know, hosted in the EU. It costs more to build, but it stays cheap to run and fully yours.",
  title: "Custom React app with managed EU hosting",
  summary: "A Next.js app with a managed Postgres database in an EU region, Stripe for payments and a transactional email and SMS service.",
  architecture: [
    "Next.js app serving members and the studio back office",
    "Managed Postgres in an EU region for schedules, bookings and passes",
    "Stripe Checkout and webhooks for pass purchases",
    "Scheduled job sending reminders 24 h and 2 h before class",
  ],
  stack: ["Next.js", "TypeScript", "PostgreSQL", "Stripe", "Transactional email and SMS API"],
  infrastructure: ["EU-region platform hosting with preview environments", "Daily database backups", "CI on every pull request"],
  monthlyCost: { low: 120, high: 260, currency: "EUR", basis: "Hosting, database and SMS for 6,000 members; estimate." },
  buildTime: "About 4 months for two developers at 3 days a week",
  risks: ["Build time is tight for a September launch", "Booking concurrency on Sunday evening peaks"],
  assumptions: ["The team can spend 3 days a week each until launch"],
};

const PROPOSAL_B: Proposal = {
  speech:
    "I propose not to build the booking engine at all: configure a booking platform made for studios and spend the budget on integration and a branded site.",
  title: "Configured studio booking platform plus branded site",
  summary:
    "A hosted booking platform for fitness studios, configured for the 12 studios, embedded in the existing website, with Stripe connected.",
  architecture: [
    "Hosted booking platform handling schedules, bookings, passes and reminders",
    "Booking widgets embedded in the WordPress site",
    "Stripe connected through the platform's payment integration",
  ],
  stack: ["Hosted booking platform", "WordPress", "Stripe"],
  infrastructure: ["No servers to run", "Platform-managed backups"],
  monthlyCost: { low: 360, high: 600, currency: "EUR", basis: "Typical per-location subscription for 12 locations; estimate." },
  buildTime: "About 6 weeks of configuration and integration",
  risks: ["Per-location pricing grows with the network", "Data location depends on the vendor"],
  assumptions: ["A vendor with EU hosting and per-location pricing under €50 exists"],
};

const CRITIQUES_A: CritiqueRound = {
  speech:
    "Option B is fast, but its monthly cost likely breaks your €400 cap, and EU hosting is not guaranteed. Both are hard constraints.",
  critiques: [
    {
      target: "B",
      severity: "blocking",
      requirement: "Running cost at most €400 per month",
      point: "The monthly cost range goes up to €600.",
      argument: "At 12 locations, per-location pricing above €33 already exceeds the cap, before SMS costs.",
    },
    {
      target: "B",
      severity: "major",
      requirement: "Member data hosted in the EU (GDPR)",
      point: "EU hosting depends on an unnamed vendor.",
      argument: "Until a vendor with EU hosting is confirmed, the option rests on an assumption.",
    },
  ],
  questionsForUser: ["Would you accept a hosted platform if a vendor fits the €400 cap with EU hosting?"],
};

const CRITIQUES_B: CritiqueRound = {
  speech:
    "Option A is solid, but four months of part-time work leaves no margin before September, and someone has to maintain it afterwards.",
  critiques: [
    {
      target: "A",
      severity: "major",
      requirement: "Launch before September",
      point: "Four months of build for a five-month deadline.",
      argument: "Any slip in payments or reminders pushes the launch past the deadline.",
    },
    {
      target: "A",
      severity: "minor",
      requirement: "Ease of maintenance",
      point: "The team owns booking concurrency and reminders forever.",
      argument: "These are solved problems on hosted platforms.",
    },
  ],
  questionsForUser: [],
};

const REVISION_A: Revision = {
  speech:
    "I accept the deadline risk and cut the first release to what must exist in September; waiting lists and teacher substitution move after launch.",
  replies: [
    {
      critique: "Four months of build for a five-month deadline.",
      stance: "accepted",
      reply: "The first release drops nice-to-have features and ships in about 3 months.",
    },
    {
      critique: "The team owns booking concurrency and reminders forever.",
      stance: "partially_accepted",
      reply: "Reminders move to a managed scheduler; booking stays in the database with a capacity lock.",
    },
  ],
  withdrawn: false,
  endorses: null,
  proposal: { ...PROPOSAL_A, buildTime: "About 3 months for the first release", speech: "Revised: a smaller first release, same stack." },
};

const REVISION_B: Revision = {
  speech: "With your answer, I keep the hosted option only if a vendor meets both the cap and EU hosting; otherwise I support option A.",
  replies: [
    {
      critique: "The monthly cost range goes up to €600.",
      stance: "accepted",
      reply: "Only vendors under €30 per location with SMS included qualify.",
    },
    {
      critique: "EU hosting depends on an unnamed vendor.",
      stance: "accepted",
      reply: "EU hosting becomes a selection criterion, verified before any contract.",
    },
  ],
  withdrawn: false,
  endorses: null,
  proposal: {
    ...PROPOSAL_B,
    monthlyCost: { low: 300, high: 400, currency: "EUR", basis: "Only vendors under €30 per location; estimate." },
    speech: "Revised: stricter vendor criteria.",
  },
};

const VERDICT: Verdict = {
  speech:
    "Option A is the one that respects every hard constraint today. Option B could be cheaper and faster, but only if a vendor meeting both the cost cap and EU hosting is confirmed.",
  options: [
    {
      seat: "A",
      title: PROPOSAL_A.title,
      feasibility: "feasible",
      reason: "Meets EU hosting and the monthly cap with a reduced first release that fits the deadline.",
      conditions: [],
      scores: [
        { criterion: "Running cost", score: 5 },
        { criterion: "Time to market", score: 3 },
        { criterion: "Ease of maintenance", score: 3 },
        { criterion: "Scalability", score: 4 },
      ],
    },
    {
      seat: "B",
      title: PROPOSAL_B.title,
      feasibility: "conditional",
      reason: "Fast to launch, but both hard constraints depend on a vendor that is not identified yet.",
      conditions: ["A vendor under €30 per location with SMS included", "Contractual EU hosting of member data"],
      scores: [
        { criterion: "Running cost", score: 2 },
        { criterion: "Time to market", score: 5 },
        { criterion: "Ease of maintenance", score: 5 },
        { criterion: "Scalability", score: 3 },
      ],
    },
  ],
  recommendation: {
    seat: "A",
    rationale: "Running cost is your top priority and a hard constraint; option A meets it with margin and keeps your data in the EU.",
  },
  consensus: ["Stripe stays the payment provider", "Reminders are essential to cut no-shows", "Waiting lists can wait until after launch"],
  disagreements: [
    {
      topic: "Build or configure",
      positions: ["A: owning the code keeps running costs low", "B: a hosted platform removes maintenance work"],
    },
  ],
  risks: [
    {
      risk: "Launch slips past September",
      likelihood: "medium",
      impact: "high",
      mitigation: "Freeze the first-release scope now and review progress every two weeks.",
    },
    {
      risk: "Sunday evening booking peak",
      likelihood: "medium",
      impact: "medium",
      mitigation: "Capacity lock in the database and a load test before launch.",
    },
  ],
  roadmap: [
    { phase: "First release", content: "Schedules, booking, passes, reminders", exitCriterion: "All 12 studios take bookings online" },
    { phase: "After launch", content: "Waiting lists and teacher substitution", exitCriterion: "No-show rate below 8%" },
  ],
  claims: [
    { claim: "Option A runs at €120 to €260 per month", confidence: "estimated" },
    { claim: "The team knows React and Node.js", confidence: "verified" },
    { claim: "A suitable EU booking vendor exists", confidence: "assumed" },
  ],
  openQuestions: ["Which SMS provider meets the cost assumption?"],
};

export const DEMO_SCRIPT = {
  proposals: { A: PROPOSAL_A, B: PROPOSAL_B } as Record<string, Proposal>,
  critiques: { A: CRITIQUES_A, B: CRITIQUES_B } as Record<string, CritiqueRound>,
  revisions: { A: REVISION_A, B: REVISION_B } as Record<string, Revision>,
  verdict: VERDICT,
};
