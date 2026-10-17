import type { EngineEvent, Session, Task } from "@quorumind/core";
import type { QuorumindClient, SessionState } from "./client.ts";

/** What the session looked like before an action, so a stale state is not taken for its result. */
export interface Baseline {
  interviewerTurns: number;
  debateLength: number;
}

export const baselineOf = (session: Session | null): Baseline => ({
  interviewerTurns: session ? session.interview.filter((entry) => entry.kind === "interviewer").length : 0,
  debateLength: session ? session.debate.length : 0,
});

/** True when the session waits for the person (or is over) and no model is working. */
export function isStoppingPoint({ session, busy }: SessionState, baseline: Baseline | null): boolean {
  if (busy) return false;
  switch (session.phase) {
    case "debating":
      return false;
    case "interview": {
      if (session.interview.at(-1)?.kind !== "interviewer") return false;
      return !baseline || baselineOf(session).interviewerTurns > baseline.interviewerTurns;
    }
    case "awaiting_answers":
      return !baseline || session.debate.length > baseline.debateLength;
    default:
      return true;
  }
}

/** Not busy, yet not waiting for anyone: the server lost track of the work, e.g. after a restart. */
const looksStalled = ({ session, busy }: SessionState) =>
  !busy && (session.phase === "debating" || (session.phase === "interview" && session.interview.at(-1)?.kind !== "interviewer"));

export interface WaitOptions {
  timeoutMs: number;
  /** Polling interval when the event stream is unavailable or quiet. */
  pollMs?: number;
  /** How long a session may look stalled before the wait gives up on it. */
  stallMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface WaitResult {
  state: SessionState;
  outcome: "stopped" | "timeout" | "stalled";
}

/**
 * Waits until the session reaches its next stopping point. Follows the live event stream to
 * react at once and report progress; polls every few seconds in any case, so a missing or broken
 * stream only slows it down.
 */
export async function waitForStoppingPoint(
  client: QuorumindClient,
  id: string,
  baseline: Baseline | null,
  options: WaitOptions,
): Promise<WaitResult> {
  const { timeoutMs, pollMs = 2_000, stallMs = 10_000, signal, onProgress } = options;
  const deadline = Date.now() + timeoutMs;
  const stream = new AbortController();
  const abortStream = () => stream.abort();
  signal?.addEventListener("abort", abortStream, { once: true });
  let wake: (() => void) | null = null;

  client
    .events(id, stream.signal, (event) => {
      const message = describeEvent(event);
      if (message) onProgress?.(message);
      if (event.type === "session" || event.type === "spoke") wake?.();
    })
    .catch(() => {
      // No live stream: polling alone carries on.
    });

  let stalledSince: number | null = null;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new Error("Cancelled.");
      const state = await client.getSession(id);
      if (isStoppingPoint(state, baseline)) return { state, outcome: "stopped" };
      if (looksStalled(state)) {
        stalledSince ??= Date.now();
        if (Date.now() - stalledSince >= stallMs) return { state, outcome: "stalled" };
      } else {
        stalledSince = null;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { state, outcome: "timeout" };
      // The server clears its busy flag just after its last save: check again soon when the phase already looks final.
      const almostThere = state.busy && state.session.phase !== "debating";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(remaining, almostThere ? 50 : pollMs));
        signal?.addEventListener("abort", done, { once: true });
        wake = done;
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          wake = null;
          resolve();
        }
      });
    }
  } finally {
    signal?.removeEventListener("abort", abortStream);
    stream.abort();
  }
}

const TASKS: Record<Task, string> = {
  interview: "preparing the interview",
  proposal: "writing a proposal",
  critique: "criticising the proposals",
  revision: "revising its proposal",
  probe: "probing the consensus",
  verdict: "writing the verdict",
  brief: "writing a brief",
};

export function describeEvent(event: EngineEvent): string | null {
  if (event.type !== "speaking") return null;
  const who =
    event.task === "interview"
      ? "The interviewer"
      : event.task === "verdict" || event.task === "probe" || event.task === "brief"
        ? "The arbiter"
        : event.seat === "devil"
          ? "The devil's advocate"
          : event.seat === "U"
            ? "The interviewer, writing up your solution,"
            : event.seat
              ? `Seat ${event.seat}`
              : "A model";
  return `${who} is ${TASKS[event.task] ?? event.task}.`;
}
