import type { InterviewQuestion, RequirementsSheet, Session } from "@quorumind/core";
import type { PriceQuote, SessionCosts, SessionState } from "./client.ts";

// Everything here is read by a coding agent: plain Markdown, short, and always ending on what to do next.

export type Status = "interview_questions" | "sheet_review" | "debate_questions" | "complete" | "failed" | "running" | "stalled";

export interface Snapshot {
  sessionId: string;
  phase: Session["phase"];
  busy: boolean;
  status: Status;
  /** What the providers charged so far, in US dollars; left out when the host does not show it. */
  costUsd?: number;
  /** False when a model's price is unknown, so the cost is a lower bound. */
  costComplete?: boolean;
  /** The host's price of the debate (hosted version), when it sets one. */
  price?: PriceQuote;
  url: string;
  next: string;
  questions?: InterviewQuestion[];
  debateQuestions?: string[];
  sheet?: RequirementsSheet;
  recommendation?: { seat: string | null; title: string | null; rationale: string };
  options?: { seat: string; title: string; feasibility: string }[];
  error?: { code: string; message: string };
}

export function interviewQuestions(session: Session): InterviewQuestion[] {
  const last = session.interview.findLast((entry) => entry.kind === "interviewer");
  return last?.kind === "interviewer" ? last.data.questions : [];
}

export function debateQuestions(session: Session): string[] {
  const last = session.debate.findLast((entry) => entry.kind === "questions");
  return last?.kind === "questions" ? last.questions : [];
}

export function cost(session: Session) {
  let usd = 0;
  let complete = true;
  for (const record of session.usage) {
    if (record.costUsd === null) complete = false;
    else usd += record.costUsd;
  }
  return { usd, complete };
}

export function statusOf({ session, busy }: SessionState, outcome: "stopped" | "timeout" | "stalled" | "now" = "now"): Status {
  if (outcome === "stalled") return "stalled";
  if (busy || outcome === "timeout") {
    if (session.phase === "failed") return "failed";
    if (session.phase === "complete") return "complete";
    return "running";
  }
  switch (session.phase) {
    case "interview":
      return session.interview.at(-1)?.kind === "interviewer" ? "interview_questions" : "stalled";
    case "review":
      return "sheet_review";
    case "awaiting_answers":
      return "debate_questions";
    case "complete":
      return "complete";
    case "failed":
      return "failed";
    default:
      return "stalled";
  }
}

const NEXT: Record<Status, string> = {
  interview_questions:
    "Ask the user these questions (they know their budget, team and constraints better than you), then call quorumind_answer with their answers. Answer a question yourself only with facts you checked in the codebase, and say so in the answer.",
  sheet_review:
    "Show the requirements sheet to the user. Call quorumind_confirm to start the debate, with `edits` for anything the user corrects.",
  debate_questions:
    "The debate is paused on these questions. Ask the user, then call quorumind_answer with their answers; the debate resumes.",
  complete:
    "Read the verdict with quorumind_verdict (format summary, markdown or adr), and write the hand-off files for coding agents with quorumind_handoff.",
  failed:
    "Call quorumind_resume to retry the step that failed. If the cost cap was reached, ask the user whether to raise it and pass budget_usd (on a hosted server, the debate's price includes its cap, which cannot be raised).",
  running: "The models are still working. Call quorumind_status with wait: true to keep waiting.",
  stalled:
    "The server is not working on this session any more (it may have restarted). Open the session in the Quorumind interface to see where it stands.",
};

export function snapshot(client: { sessionUrl(id: string): string }, state: SessionState, status: Status): Snapshot {
  const { session, busy } = state;
  const result: Snapshot = {
    sessionId: session.id,
    phase: session.phase,
    busy,
    status,
    url: client.sessionUrl(session.id),
    next: NEXT[status],
  };
  // A host that sells debates at a price sends no provider cost: a total of zero would be wrong.
  if (state.providerCosts !== false) {
    const spent = cost(session);
    result.costUsd = Math.round(spent.usd * 10_000) / 10_000;
    result.costComplete = spent.complete;
  }
  if (state.price) result.price = state.price;
  if (status === "interview_questions") result.questions = interviewQuestions(session);
  if (status === "debate_questions") result.debateQuestions = debateQuestions(session);
  if (status === "sheet_review" && session.sheet) result.sheet = session.sheet;
  if (session.verdict) {
    const option = (seat: string | null) => session.verdict?.options.find((item) => item.seat === seat);
    result.recommendation = {
      seat: session.verdict.recommendation.seat,
      title: option(session.verdict.recommendation.seat)?.title ?? null,
      rationale: session.verdict.recommendation.rationale,
    };
    result.options = session.verdict.options.map(({ seat, title, feasibility }) => ({ seat, title, feasibility }));
  }
  if (session.error) result.error = session.error;
  return result;
}

/** The text answer of a tool that reached (or gave up waiting for) a stopping point. */
export function renderSnapshot(snap: Snapshot, session: Session, costs: SessionCosts = {}): string {
  const lines: string[] = [];
  const header: Record<Status, string> = {
    interview_questions: "The interviewer has questions.",
    sheet_review: "The interview is over: the requirements sheet is ready for review.",
    debate_questions: "The debate needs answers from the user.",
    complete: "The debate is over: the verdict is ready.",
    failed: "The session failed.",
    running: "Still running.",
    stalled: "The session is not progressing.",
  };
  lines.push(`**${header[snap.status]}** Session \`${snap.sessionId}\`, phase ${snap.phase}${snap.busy ? " (a model is working)" : ""}.`);
  const spending = snap.price
    ? `Price: ${formatPrice(snap.price)}. `
    : snap.costUsd !== undefined
      ? `Cost so far: ${formatUsd(snap.costUsd)}${snap.costComplete ? "" : " (at least; a model's price is unknown)"}. `
      : "";
  lines.push(`${spending}Follow live: ${snap.url}`, "");

  if (snap.questions) lines.push(formatInterviewQuestions(snap.questions), "");
  if (snap.debateQuestions) lines.push(snap.debateQuestions.map((question, i) => `${i + 1}. ${question}`).join("\n"), "");
  if (snap.sheet) lines.push(formatSheet(snap.sheet), "");
  if (snap.status === "complete" && session.verdict) lines.push(formatVerdictSummary(session, costs), "");
  if (snap.error) lines.push(`Error (${snap.error.code}): ${snap.error.message}`, "");
  lines.push(`Next: ${snap.next}`);
  return lines.join("\n");
}

export function formatInterviewQuestions(questions: InterviewQuestion[]): string {
  return questions
    .map((question, i) => {
      const lines = [`${i + 1}. ${question.text} (id: ${question.id})`];
      if (question.why) lines.push(`   Why it matters: ${question.why}`);
      if (question.examples.length > 0) lines.push(`   Example answers: ${question.examples.join(" | ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

export function formatSheet(sheet: RequirementsSheet): string {
  const list = (items: string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)");
  const section = (title: string, body: string) => `### ${title}\n${body}`;
  return [
    `## Requirements sheet: ${sheet.projectName}`,
    sheet.summary,
    section("Goals (goals)", list(sheet.goals)),
    section("Success criteria (successCriteria)", list(sheet.successCriteria)),
    section("Must have (mustHave)", list(sheet.mustHave)),
    section("Nice to have (niceToHave)", list(sheet.niceToHave)),
    section("Out of scope (outOfScope)", list(sheet.outOfScope)),
    section("Users and load (users)", json(sheet.users)),
    section("Budget (budget: build and run amounts with an ISO currency, run per month or year)", json(sheet.budget)),
    section("Existing infrastructure (existingInfrastructure)", list(sheet.existingInfrastructure)),
    section("Team (team)", json(sheet.team)),
    section("Deadline (deadline: a YYYY-MM-DD date or a duration in weeks or months)", json(sheet.deadline)),
    section("Compliance (compliance)", json(sheet.compliance)),
    section("Hard constraints (hardConstraints)", list(sheet.hardConstraints)),
    section("Soft constraints (softConstraints)", list(sheet.softConstraints)),
    section("Priorities (priorities, weight 1 to 5)", list(sheet.priorities.map((p) => `${p.criterion}: ${p.weight}`))),
    section("Assumptions (assumptions)", list(sheet.assumptions)),
  ].join("\n\n");
}

const json = (value: unknown) => `\`${JSON.stringify(value)}\``;

/**
 * The organisation profile the proposals will follow, for quorumind_review; null when there is none or the person set
 * it aside.
 */
export function profileNotice(session: Session): string | null {
  const profile = session.profile;
  if (!profile || session.ignoreProfile) return null;
  const rules = [
    profile.forbiddenTechnologies.length > 0 ? `never ${profile.forbiddenTechnologies.join(", ")}` : "",
    profile.hosting.euOnly ? "EU hosting only" : "",
    profile.hosting.providers.length > 0 ? `hosting with ${profile.hosting.providers.join(", ")}` : "",
    profile.hosting.onPremises ? "on-premises accepted" : "",
    profile.roles.length > 0 ? `priced with ${profile.roles.length} day rate(s) in ${profile.currency}` : "",
  ].filter(Boolean);
  return `### Organisation profile\nProposals will stay within the profile of ${profile.name.trim() || "the organisation"}${
    rules.length > 0 ? `: ${rules.join("; ")}` : ""
  }. To debate without it, call quorumind_confirm with ignore_profile: true.`;
}

const amount = (value: number, currency: string) => `${value.toLocaleString("en")} ${currency}`;

export function formatVerdictSummary(session: Session, costs: SessionCosts = {}): string {
  const verdict = session.verdict;
  if (!verdict) return "No verdict yet.";
  const title = (seat: string | null) => verdict.options.find((option) => option.seat === seat)?.title;
  const lines = [`## Verdict: ${session.sheet?.projectName ?? session.idea}`, ""];
  const seat = verdict.recommendation.seat;
  lines.push(seat ? `**Recommended: option ${seat}, ${title(seat) ?? ""}**` : "**No option is recommended.**");
  lines.push(verdict.recommendation.rationale, "", "### Options");
  for (const option of verdict.options) {
    lines.push(`- ${option.seat}: ${option.title} (${option.feasibility}). ${option.reason}`);
    if (option.conditions.length > 0) lines.push(`  Conditions: ${option.conditions.join("; ")}`);
    const costing = costs.costings?.[option.seat];
    if (costing) {
      lines.push(
        `  Build cost: ${amount(costing.total.low, costing.currency)} to ${amount(costing.total.high, costing.currency)}` +
          (costing.packages.length > 0
            ? `, ${costing.days.low} to ${costing.days.high} person-days in ${costing.packages.length} work packages`
            : ""),
      );
    }
    const checks = costs.checks?.[option.seat];
    const issues = [
      checks?.build && checks.build.status !== "within"
        ? `build budget ${checks.build.status === "over" ? "exceeded" : "at risk"} by ${amount(checks.build.by, checks.build.currency)}`
        : "",
      checks?.run && checks.run.status !== "within"
        ? `running budget ${checks.run.status === "over" ? "exceeded" : "at risk"} by ${amount(checks.run.by, checks.run.currency)} a month`
        : "",
      checks?.time && checks.time.status !== "within"
        ? `${checks.time.status === "over" ? "late" : "may be late"} by ${checks.time.by} week(s)`
        : "",
    ].filter(Boolean);
    if (issues.length > 0) lines.push(`  Checks: ${issues.join("; ")}`);
  }
  if (verdict.risks.length > 0) {
    lines.push("", "### Main risks");
    for (const risk of verdict.risks.slice(0, 5))
      lines.push(`- ${risk.risk} (${risk.likelihood} likelihood, ${risk.impact} impact). ${risk.mitigation}`);
  }
  if (verdict.roadmap.length > 0) {
    lines.push("", "### Roadmap");
    for (const step of verdict.roadmap) lines.push(`- ${step.phase}: ${step.content} Done when: ${step.exitCriterion}`);
  }
  if (verdict.openQuestions.length > 0) lines.push("", "### Open questions", ...verdict.openQuestions.map((q) => `- ${q}`));
  return lines.join("\n");
}

export const formatUsd = (usd: number) => `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** A host's price, e.g. "Standard debate, 7.00 EUR", or its label alone when the plan covers it. */
export const formatPrice = (price: PriceQuote) =>
  price.amount > 0 ? `${price.label}, ${price.amount.toFixed(2)} ${price.currency}` : price.label;
