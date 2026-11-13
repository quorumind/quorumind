import type { Session, Task } from "@quorumind/core";
import type { TFunction } from "i18next";
import type { LiveSpeech } from "./useSession.ts";

// Where the debate stands, in words: the step at work, and who writes in it. Computed from the session and what its
// roles are writing, so it needs nothing new from the server.

/** The name of a seat of the debate: a proposer, the person's own solution, the devil's advocate. */
export function seatName(seat: string, t: TFunction): string {
  if (seat === "devil") return t("role.devil");
  if (seat === "U") return t("role.yourSolution");
  return t("role.proposer", { seat });
}

/** The tasks shown in the debate's transcript; the others are followed elsewhere (the interview, a reader version…). */
const DEBATE_TASKS = new Set<Task>(["research", "proposal", "critique", "revision", "probe", "verdict"]);

/** The round a seat's critique or revision belongs to: the one after those it already gave, at most the last. */
export function roundOf(session: Session, task: Task, seat: string | null): number {
  const kind = task === "critique" ? "critiques" : "revision";
  const next = session.debate.filter((entry) => entry.kind === kind && "seat" in entry && entry.seat === seat).length + 1;
  // A call made again after a failure belongs to the round it failed in: never past the debate's last round.
  return Math.min(next, Math.max(1, session.rounds));
}

/** The name of a step of the work, for a task of the debate (and the few around it). */
export function taskStepLabel(session: Session, task: Task, seat: string | null, t: TFunction): string {
  switch (task) {
    case "research":
    case "search":
      return t("debate.research");
    case "proposal":
      return seat === "U" ? t("debate.yourSolution") : t("debate.blind");
    case "critique":
      return t("progress.critiques", { round: roundOf(session, task, seat), total: session.rounds });
    case "revision":
      return t("progress.revisions", { round: roundOf(session, task, seat), total: session.rounds });
    case "probe":
      return t("debate.probe");
    case "verdict":
      return t("debate.verdict");
    default:
      return t(`task.${task}`);
  }
}

/** Who plays a task: its seat, the interviewer, or the arbiter. */
export function taskRole(task: Task, seat: string | null, t: TFunction): string {
  if (seat) return seatName(seat, t);
  return task === "interview" ? t("role.interviewer") : t("role.arbiter");
}

/** The order of the steps of a debate: the furthest step at work names where the debate stands. */
const STEP_RANK: Partial<Record<Task, number>> = { research: 0, search: 0, proposal: 1, critique: 2, revision: 3, probe: 4, verdict: 5 };

/** Where a step falls in the debate, rounds included: critiques 1 < revisions 1 < critiques 2 < … < probe < verdict. */
function stepOrder(task: Task, round: number): number {
  if (task === "critique") return 10 * round + 2;
  if (task === "revision") return 10 * round + 3;
  if (task === "probe") return 10_000;
  if (task === "verdict") return 10_001;
  return STEP_RANK[task] ?? 0;
}

export interface DebateStep {
  /** Stable while the debate stays in this step: it changes once per step, which is what is announced. */
  key: string;
  label: string;
  /** Where the step falls in the debate: a debate only moves forward, so a lower one is never news. */
  order: number;
}

function step(task: Task, round: number, label: string): DebateStep {
  return { key: `${task}:${round}`, label, order: stepOrder(task, round) };
}

/** The step the debate last recorded, or the one about to start: what stands between two calls. */
function recordedStep(session: Session, t: TFunction): DebateStep {
  const last = session.debate.at(-1);
  if (!last) return session.research ? step("research", 0, t("debate.research")) : step("proposal", 0, t("debate.blind"));
  switch (last.kind) {
    case "proposal":
      return step("proposal", 0, t("debate.blind"));
    case "critiques":
      return step("critique", last.round, t("progress.critiques", { round: last.round, total: session.rounds }));
    case "questions":
    case "answers":
    case "revision":
      return step("revision", last.round, t("progress.revisions", { round: last.round, total: session.rounds }));
    case "probe":
      return step("probe", 0, t("debate.probe"));
    default:
      return step("verdict", 0, t("debate.verdict"));
  }
}

/**
 * The step the debate is in while it runs; null when it is not running. The furthest of what the roles write and what
 * the debate recorded: a role that just finished (its entry not saved yet) or a reconnection (nobody writing yet) never
 * takes the debate a step back.
 */
export function debateStep(session: Session, live: LiveSpeech, t: TFunction): DebateStep | null {
  if (session.phase !== "debating") return null;
  const recorded = recordedStep(session, t);
  const working = Object.values(live).filter((speech) => DEBATE_TASKS.has(speech.task) || speech.task === "search");
  if (working.length === 0) return recorded;
  const furthest = working.reduce((best, speech) => ((STEP_RANK[speech.task] ?? 0) > (STEP_RANK[best.task] ?? 0) ? speech : best));
  const round = furthest.task === "critique" || furthest.task === "revision" ? roundOf(session, furthest.task, furthest.seat) : 0;
  const task = furthest.task === "search" ? "research" : furthest.task;
  const writing = step(task, round, taskStepLabel(session, furthest.task, furthest.seat, t));
  return writing.order >= recorded.order ? writing : recorded;
}

/** Who is writing in the debate right now, as one list in the person's language; empty when nobody is. */
export function debateWriters(session: Session, live: LiveSpeech, t: TFunction, language: string): string {
  // A revision of the verdict is followed on the verdict tab, not in the debate.
  if (session.revising) return "";
  const names = Object.values(live)
    .filter((speech) => DEBATE_TASKS.has(speech.task))
    .map((speech) => taskRole(speech.task, speech.seat, t));
  return names.length > 0 ? new Intl.ListFormat(language, { type: "conjunction" }).format([...new Set(names)]) : "";
}
