import type {
  Audience,
  Brief,
  CritiqueRound,
  InterviewTurn,
  Probe,
  Proposal,
  RequirementsSheet,
  Revision,
  Verdict,
  VerdictUpdate,
} from "./schemas.ts";

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
  users: { launch: 4_000, oneYear: 6_000, note: "Peak on Sunday evenings, when the week's classes open." },
  budget: {
    build: { amount: 15_000, currency: "EUR" },
    run: { amount: 400, currency: "EUR", period: "month" },
    note: "The running budget is a firm cap; the build budget can stretch a little.",
  },
  existingInfrastructure: ["Website on a shared WordPress host", "Stripe account already open"],
  team: { people: 2, skills: ["React", "Node.js", "JavaScript"], note: "Two in-house developers, about 3 days a week each." },
  deadline: { date: null, duration: { amount: 5, unit: "month" }, note: "Launch before September." },
  compliance: { gdpr: true, healthData: false, paymentCards: false, accessibility: false, publicSector: false },
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
  monthlyCost: { low: 120, high: 260, basis: "Hosting, database and SMS for 6,000 members; estimate." },
  estimate: {
    workPackages: [
      {
        name: "Framing",
        description: "Workshops with two studio managers, booking rules, data model.",
        effort: [
          { role: "project_manager", low: 2, high: 3 },
          { role: "architect", low: 2, high: 3 },
        ],
      },
      {
        name: "Back end",
        description: "Schedules, bookings with a capacity lock, passes, Stripe Checkout and webhooks.",
        effort: [{ role: "developer", low: 16, high: 19 }],
      },
      {
        name: "Front end",
        description: "Member booking pages and the studio back office.",
        effort: [{ role: "developer", low: 14, high: 17 }],
      },
      {
        name: "Integrations",
        description: "Email and SMS reminders through a managed scheduler.",
        effort: [{ role: "developer", low: 4, high: 5 }],
      },
      {
        name: "Testing",
        description: "End-to-end tests and a load test of the Sunday evening peak.",
        effort: [{ role: "developer", low: 4, high: 6 }],
      },
      { name: "Deployment", description: "EU hosting, backups, CI and monitoring.", effort: [{ role: "devops", low: 2, high: 2 }] },
      {
        name: "Project management",
        description: "Fortnightly reviews with the studios until launch.",
        effort: [{ role: "project_manager", low: 3, high: 4 }],
      },
    ],
    dayRates: [
      { role: "project_manager", dailyRate: 300 },
      { role: "architect", dailyRate: 350 },
      { role: "developer", dailyRate: 250 },
      { role: "devops", dailyRate: 300 },
    ],
    assumptions: ["In-house developers at their internal cost", "Studio managers available for the framing workshops"],
    exclusions: ["Native mobile apps", "Data migration from the current spreadsheets"],
  },
  buildTime: "About 4 months for two developers at 3 days a week",
  buildWeeks: { low: 16, high: 18 },
  components: [
    { id: "members", label: "Members (web and mobile)", kind: "client" },
    { id: "office", label: "Studio back office", kind: "client" },
    { id: "app", label: "Next.js app", kind: "service" },
    { id: "db", label: "Postgres (EU)", kind: "database" },
    { id: "jobs", label: "Reminder scheduler", kind: "queue" },
    { id: "stripe", label: "Stripe", kind: "external" },
    { id: "sms", label: "Email and SMS API", kind: "external" },
  ],
  flows: [
    { from: "members", to: "app", label: "book, buy passes" },
    { from: "office", to: "app", label: "manage schedules" },
    { from: "app", to: "db", label: "bookings, passes" },
    { from: "app", to: "stripe", label: "checkout" },
    { from: "stripe", to: "app", label: "webhooks" },
    { from: "jobs", to: "db", label: "upcoming classes" },
    { from: "jobs", to: "sms", label: "reminders" },
  ],
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
  monthlyCost: { low: 360, high: 600, basis: "Typical per-location subscription for 12 locations; estimate." },
  estimate: {
    workPackages: [
      {
        name: "Framing",
        description: "Vendor selection against the cost cap and EU hosting.",
        effort: [{ role: "project_manager", low: 2, high: 3 }],
      },
      {
        name: "Configuration",
        description: "Schedules, passes and reminders for the 12 studios; member data import.",
        effort: [{ role: "developer", low: 8, high: 12 }],
      },
      {
        name: "Integrations",
        description: "Booking widgets in the WordPress site, Stripe connection.",
        effort: [{ role: "developer", low: 4, high: 6 }],
      },
      { name: "Testing", description: "Bookings and payments tested in every studio.", effort: [{ role: "developer", low: 2, high: 3 }] },
      {
        name: "Project management",
        description: "Training of the studio managers and launch.",
        effort: [{ role: "project_manager", low: 2, high: 3 }],
      },
    ],
    dayRates: [
      { role: "project_manager", dailyRate: 300 },
      { role: "developer", dailyRate: 250 },
    ],
    assumptions: ["The vendor's import tool accepts the current member list"],
    exclusions: ["The platform subscription, counted in the monthly cost", "A redesign of the website"],
  },
  buildTime: "About 6 weeks of configuration and integration",
  buildWeeks: { low: 6, high: 8 },
  components: [
    { id: "members", label: "Members", kind: "client" },
    { id: "site", label: "WordPress site", kind: "service" },
    { id: "platform", label: "Booking platform (SaaS)", kind: "external" },
    { id: "stripe", label: "Stripe", kind: "external" },
  ],
  flows: [
    { from: "members", to: "site", label: "visit" },
    { from: "site", to: "platform", label: "embedded booking widgets" },
    { from: "platform", to: "stripe", label: "payments" },
  ],
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

const CRITIQUES_DEVIL: CritiqueRound = {
  speech:
    "Both options hide costs. A underestimates what the team will spend keeping the app alive; B assumes a vendor that nobody has named yet.",
  critiques: [
    {
      target: "A",
      severity: "major",
      requirement: "Ease of maintenance",
      point: "No budget for maintenance after launch.",
      argument: "Security updates, payment changes and support will take several days a month, paid by the same two part-time developers.",
    },
    {
      target: "B",
      severity: "major",
      requirement: "Running cost at most €400 per month",
      point: "SMS and payment fees come on top of the subscription.",
      argument: "Booking platforms often bill SMS and card fees separately: the real monthly cost is higher than the subscription.",
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
  proposal: {
    ...PROPOSAL_A,
    buildTime: "About 3 months for the first release",
    buildWeeks: { low: 12, high: 14 },
    speech: "Revised: a smaller first release, same stack.",
  },
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
    monthlyCost: { low: 300, high: 400, basis: "Only vendors under €30 per location; estimate." },
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
  topics: [
    {
      topic: "Stripe stays the payment provider",
      status: "agreement",
      positions: [
        { seat: "A", position: "Stripe Checkout and webhooks" },
        { seat: "B", position: "Stripe through the platform's integration" },
      ],
    },
    {
      topic: "Reminders are essential to cut no-shows",
      status: "agreement",
      positions: [
        { seat: "A", position: "Managed scheduler, 24 h and 2 h before class" },
        { seat: "B", position: "Built into the platform" },
      ],
    },
    {
      topic: "Cost of maintenance after launch",
      status: "divided",
      positions: [
        { seat: "A", position: "A few days a month, accepted for the control it gives" },
        { seat: "B", position: "Near zero: the vendor maintains the platform" },
        { seat: "devil", position: "Underestimated by A, and B's fees grow with every studio" },
      ],
    },
    {
      topic: "Build or configure",
      status: "opposed",
      positions: [
        { seat: "A", position: "Owning the code keeps running costs low" },
        { seat: "B", position: "A hosted platform removes maintenance work" },
      ],
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
    { claim: "Option A runs at €120 to €260 per month", confidence: "estimated", sources: [] },
    { claim: "Option A may exceed the €15,000 build budget by up to €500", confidence: "estimated", sources: [] },
    // The two claims the recorded research supports: the demo cites its sources (research.ts).
    { claim: "Stripe charges 1.5% + €0.25 per payment with a standard EEA card", confidence: "verified", sources: ["S1"] },
    { claim: "PostgreSQL 18, which option A runs on, is supported until November 2030", confidence: "verified", sources: ["S2"] },
    { claim: "A suitable EU booking vendor exists", confidence: "assumed", sources: [] },
  ],
  openQuestions: ["Which SMS provider meets the cost assumption?"],
};

const PROBE: Probe = {
  speech: "You agree too quickly. Nobody has looked at what happens when a studio leaves or joins the network.",
  angle: "What happens to cost and data when the network grows to 20 studios, or when a studio leaves with its members?",
  rationale: "Per-location pricing and data ownership both change with the size of the network.",
};

const BRIEFS: Record<Audience, Brief> = {
  cto: {
    speech: "Build option A, scoped down: Next.js and Postgres in the EU, Stripe, a managed scheduler.",
    headline: "Build a lean custom app on the stack the team knows",
    summary: "Option A respects both hard constraints: EU hosting and a running cost of €120 to €260 per month (estimate).",
    sections: [
      {
        title: "Architecture",
        body: "Next.js app, managed Postgres in an EU region, Stripe Checkout with webhooks, managed reminder jobs.",
      },
      { title: "Main risk", body: "Deadline: freeze the first-release scope now, review every two weeks." },
    ],
    nextSteps: ["Freeze the first-release scope", "Load test the Sunday evening peak"],
  },
  executive: {
    speech: "We recommend building our own booking app: it fits the budget and keeps member data in Europe.",
    headline: "Our own app, live before September, within budget",
    summary: "About €12,300 to €15,500 to build and €120 to €260 a month to run (estimates), with member data kept in Europe.",
    sections: [{ title: "What we need from you", body: "Approve a smaller first release; extras come after launch." }],
    nextSteps: ["Approve the first-release scope"],
  },
  client: {
    speech: "Your members will book classes and buy passes online, from September, without going over your monthly budget.",
    headline: "Online booking for your 12 studios by September",
    summary: "Members book, pay and get reminders; your managers update schedules themselves.",
    sections: [{ title: "Cost", body: "About €12,300 to €15,500 once, then €120 to €260 a month (estimates)." }],
    nextSteps: ["Confirm the list of features for September"],
  },
};

/** The verdict ruled again once the open question is answered: a verdict revision of the demo. */
const REASSESSMENT: VerdictUpdate = {
  ...VERDICT,
  speech:
    "The SMS answer confirms option A's running cost, now lower than estimated. Option A stays the recommendation; option B still depends on a vendor nobody has named.",
  options: VERDICT.options.map((option) =>
    option.seat === "A"
      ? {
          ...option,
          scores: option.scores.map((score) => (score.criterion === "Ease of maintenance" ? { ...score, score: 4 } : score)),
        }
      : option,
  ),
  risks: [
    ...VERDICT.risks,
    {
      risk: "SMS volume grows faster than the members",
      likelihood: "low",
      impact: "medium",
      mitigation: "Send reminders by e-mail first and by SMS only to members who ask for it.",
    },
  ],
  claims: [
    { claim: "Option A runs at €140 to €220 per month", confidence: "estimated", sources: [] },
    ...VERDICT.claims.filter((claim) => !claim.claim.startsWith("Option A runs")),
  ],
  openQuestions: [],
  costs: [
    {
      seat: "A",
      monthlyCost: { low: 140, high: 220, basis: "Hosting, database and SMS at the confirmed provider's rate; estimate." },
    },
  ],
  schedules: [],
};

/** A "what if" scenario of the demo ruled on: two more developers shorten option A's build. */
const SCENARIO: VerdictUpdate = {
  ...VERDICT,
  speech:
    "With four developers, option A's first release takes about ten weeks instead of thirteen: the deadline is no longer at risk. Option A stays the recommendation, now with margin.",
  options: VERDICT.options.map((option) =>
    option.seat === "A"
      ? {
          ...option,
          reason: "Meets EU hosting and the monthly cap, and with four developers the first release fits the deadline with margin.",
          scores: option.scores.map((score) => (score.criterion === "Time to market" ? { ...score, score: 4 } : score)),
        }
      : option,
  ),
  risks: VERDICT.risks.map((risk) =>
    risk.risk === "Launch slips past September" ? { ...risk, likelihood: "low", mitigation: "Keep the two-weekly progress review." } : risk,
  ),
  costs: [],
  schedules: [{ seat: "A", buildWeeks: { low: 9, high: 11 } }],
};

export const DEMO_SCRIPT = {
  proposals: { A: PROPOSAL_A, B: PROPOSAL_B } as Record<string, Proposal>,
  critiques: { A: CRITIQUES_A, B: CRITIQUES_B, devil: CRITIQUES_DEVIL } as Record<string, CritiqueRound>,
  probe: PROBE,
  briefs: BRIEFS,
  revisions: { A: REVISION_A, B: REVISION_B } as Record<string, Revision>,
  verdict: VERDICT,
  reassessment: REASSESSMENT,
  scenario: SCENARIO,
};
