// The decision register: one decision per session that reached a verdict, with who approved which version of it,
// a short note, and when to revisit it. The decision travels with its session (Session.decision): its reports, its
// ADR and its data export carry it, and it goes when the session is deleted. Its status follows from what was
// recorded: an approval holds for the revision it was given to, so a new revision, or another scenario adopted,
// puts the decision back to "proposed" until someone approves again. Browser-safe.

import { currentRevision, type RevisionReason, type Session } from "./session.ts";

/** proposed: a verdict nobody approved yet (or not this version of it). The others are recorded by someone. */
export type DecisionStatus = "proposed" | "approved" | "rejected" | "superseded";
export const DECISION_STATUSES: readonly DecisionStatus[] = ["proposed", "approved", "rejected", "superseded"];

/** Who did something in the register: the user id on a hosted server (null for the local user), and their name. */
export interface DecisionActor {
  id: string | null;
  /** The name shown in the register and the documents; null when none is known. */
  name: string | null;
}

export interface DecisionApproval {
  by: DecisionActor;
  at: string;
  comment: string | null;
  /** The revision of the verdict that was approved. */
  revision: number;
}

/** A member who may not approve asked those who can. */
export interface DecisionRequest {
  by: DecisionActor;
  at: string;
  comment: string | null;
}

/** A decision closed by hand: turned down, or replaced by another one. */
export interface DecisionClosure {
  status: "rejected" | "superseded";
  by: DecisionActor;
  at: string;
  comment: string | null;
  /** The session of the decision that replaces this one, and its title then. */
  supersededBy: string | null;
  supersededTitle: string | null;
}

/** When to look at the decision again: on a date (with a reminder), or when an assumption changes. */
export interface DecisionReview {
  /** YYYY-MM-DD; null without a date. */
  on: string | null;
  /** The assumption whose change calls for a review, in the team's words. */
  when: string | null;
  /** The review date a reminder was sent for; null until then. */
  remindedFor: string | null;
}

export type DecisionEventKind = "requested" | "approved" | "rejected" | "superseded" | "reopened";

/** One step of the decision's history, for the record of who did what. */
export interface DecisionEvent {
  kind: DecisionEventKind;
  by: DecisionActor;
  at: string;
  comment: string | null;
  /** The revision the decision showed then. */
  revision: number | null;
  supersededBy?: string | null;
}

export interface Decision {
  /** A short note on the decision, in the team's words. */
  note: string | null;
  approval: DecisionApproval | null;
  /** The latest request for approval since the decision was last approved, rejected or reopened. */
  request: DecisionRequest | null;
  closure: DecisionClosure | null;
  review: DecisionReview;
  history: DecisionEvent[];
}

/** Limits of what the register records, checked by the server and shown by the forms. */
export const DECISION_LIMITS = { note: 1_000, comment: 1_000, when: 300, name: 120, history: 200 } as const;

/** Why a step of the register is refused: the code the interfaces explain. */
export class DecisionError extends Error {
  readonly code: "no_verdict" | "already_approved" | "not_approved" | "closed" | "not_closed" | "self_superseding";
  constructor(code: DecisionError["code"], message: string) {
    super(message);
    this.name = "DecisionError";
    this.code = code;
  }
}

const empty = (): Decision => ({
  note: null,
  approval: null,
  request: null,
  closure: null,
  review: { on: null, when: null, remindedFor: null },
  history: [],
});

/** The status of a session's decision; null before the verdict. */
export function decisionStatus(session: Session): DecisionStatus | null {
  if (session.phase !== "complete" || !session.verdict) return null;
  const decision = session.decision;
  if (decision?.closure) return decision.closure.status;
  return approvalOf(session) ? "approved" : "proposed";
}

/** The approval of the revision the session shows (or of `revision`), if it was approved. */
export function approvalOf(session: Session, revision = currentRevision(session)?.number ?? null): DecisionApproval | null {
  const approval = session.decision?.approval ?? null;
  return approval && approval.revision === revision ? approval : null;
}

function record(session: Session, event: Omit<DecisionEvent, "revision">): Decision {
  if (session.phase !== "complete" || !session.verdict) throw new DecisionError("no_verdict", "The verdict is not ready yet.");
  session.decision ??= empty();
  const decision = session.decision;
  decision.history.push({ ...event, revision: currentRevision(session)?.number ?? null });
  // The oldest steps go first once the history is long: the latest ones say where the decision stands.
  if (decision.history.length > DECISION_LIMITS.history) decision.history.splice(0, decision.history.length - DECISION_LIMITS.history);
  return decision;
}

/** A member who may not approve asks those who can; the request stays until the decision is approved or closed. */
export function requestApproval(session: Session, by: DecisionActor, comment: string | null, at: string): void {
  const status = decisionStatus(session);
  if (status === "approved") throw new DecisionError("already_approved", "This version of the decision is already approved.");
  if (status === "rejected" || status === "superseded") throw new DecisionError("closed", "This decision is closed. Reopen it first.");
  const decision = record(session, { kind: "requested", by, at, comment });
  decision.request = { by, at, comment };
}

/** Approves the version of the decision the session shows. */
export function approveDecision(session: Session, by: DecisionActor, comment: string | null, at: string): void {
  const status = decisionStatus(session);
  if (status === "approved") throw new DecisionError("already_approved", "This version of the decision is already approved.");
  if (status === "rejected" || status === "superseded") throw new DecisionError("closed", "This decision is closed. Reopen it first.");
  const decision = record(session, { kind: "approved", by, at, comment });
  decision.approval = { by, at, comment, revision: currentRevision(session)?.number ?? 1 };
  decision.request = null;
}

/** Turns the decision down: the team will not go this way. */
export function rejectDecision(session: Session, by: DecisionActor, comment: string | null, at: string): void {
  if (session.decision?.closure) throw new DecisionError("closed", "This decision is already closed.");
  const decision = record(session, { kind: "rejected", by, at, comment });
  decision.closure = { status: "rejected", by, at, comment, supersededBy: null, supersededTitle: null };
  decision.request = null;
}

/** Closes the decision as replaced by the one of another session: its id, and its title then. */
export function supersedeDecision(
  session: Session,
  by: DecisionActor,
  replacement: { id: string; title: string | null },
  comment: string | null,
  at: string,
): void {
  const supersededBy = replacement.id;
  if (supersededBy === session.id) throw new DecisionError("self_superseding", "A decision cannot supersede itself.");
  if (session.decision?.closure) throw new DecisionError("closed", "This decision is already closed.");
  const decision = record(session, { kind: "superseded", by, at, comment, supersededBy });
  decision.closure = { status: "superseded", by, at, comment, supersededBy, supersededTitle: replacement.title };
  decision.request = null;
}

/** Opens a closed decision again, or withdraws an approval: the decision is proposed again. */
export function reopenDecision(session: Session, by: DecisionActor, comment: string | null, at: string): void {
  const status = decisionStatus(session);
  if (status === "proposed") throw new DecisionError("not_closed", "This decision is already open.");
  const decision = record(session, { kind: "reopened", by, at, comment });
  decision.closure = null;
  decision.approval = null;
  decision.request = null;
}

/**
 * Changes the note and the review of a decision; a field left out keeps its value. A new review date sends a new
 * reminder when it comes.
 */
export function setDecisionDetails(
  session: Session,
  details: { note?: string | null; review?: { on: string | null; when: string | null } },
): void {
  if (session.phase !== "complete" || !session.verdict) throw new DecisionError("no_verdict", "The verdict is not ready yet.");
  session.decision ??= empty();
  const decision = session.decision;
  if (details.note !== undefined) decision.note = details.note;
  if (details.review) {
    const remindedFor =
      details.review.on !== null && details.review.on === decision.review.remindedFor ? decision.review.remindedFor : null;
    decision.review = { on: details.review.on, when: details.review.when, remindedFor };
  }
}

/** True when a decision's review date has come (`today` is YYYY-MM-DD) and no reminder was sent for it. */
export function reviewDue(session: Session, today: string): boolean {
  const review = session.decision?.review;
  const status = decisionStatus(session);
  if (!review?.on || status === null || status === "rejected" || status === "superseded") return false;
  return review.on <= today && review.remindedFor !== review.on;
}

/** One row of the register, as the lists and the CSV export show it. */
export interface RegisterEntry {
  sessionId: string;
  title: string;
  status: DecisionStatus;
  /** When the debate reached its verdict. */
  decidedAt: string;
  /** When the decision last changed: a new revision, an approval, a note. */
  updatedAt: string;
  /** The revision the decision shows: the adopted scenario, or the latest revision. */
  revision: { number: number; reason: RevisionReason; scenario: string | null };
  /** The recommended option of that revision; null when none is feasible. */
  recommendation: { seat: string; title: string } | null;
  approval: { name: string | null; by: string | null; at: string; comment: string | null; revision: number } | null;
  /** An approval given to an earlier revision, now outdated. */
  previousApproval: { name: string | null; at: string; revision: number } | null;
  request: { name: string | null; by: string | null; at: string; comment: string | null } | null;
  note: string | null;
  review: { on: string | null; when: string | null };
  supersededBy: string | null;
  /** The decision this session revisits, when it was started from an earlier one. */
  revisits: string | null;
}

/** The register's row of a session; null before its verdict. */
export function registerEntry(session: Session): RegisterEntry | null {
  const status = decisionStatus(session);
  const current = currentRevision(session);
  const verdict = session.verdict;
  if (!status || !current || !verdict) return null;
  const decision = session.decision ?? empty();
  const seat = verdict.recommendation.seat;
  const option = seat ? verdict.options.find((item) => item.seat === seat) : undefined;
  const approval = approvalOf(session);
  const previous = !approval && decision.approval ? decision.approval : null;
  const changedAt = [session.updatedAt, decision.history.at(-1)?.at ?? ""].sort().at(-1) ?? session.updatedAt;
  return {
    sessionId: session.id,
    title: session.sheet?.projectName ?? session.idea.slice(0, 120),
    status,
    decidedAt: session.revisions[0]?.createdAt ?? current.createdAt,
    updatedAt: changedAt,
    revision: { number: current.number, reason: current.reason, scenario: current.scenario?.title ?? null },
    recommendation: seat ? { seat, title: option?.title ?? seat } : null,
    approval: approval
      ? { name: approval.by.name, by: approval.by.id, at: approval.at, comment: approval.comment, revision: approval.revision }
      : null,
    previousApproval: previous ? { name: previous.by.name, at: previous.at, revision: previous.revision } : null,
    request: decision.request
      ? { name: decision.request.by.name, by: decision.request.by.id, at: decision.request.at, comment: decision.request.comment }
      : null,
    note: decision.note,
    review: { on: decision.review.on, when: decision.review.when },
    supersededBy: decision.closure?.supersededBy ?? null,
    revisits: session.parentId,
  };
}
