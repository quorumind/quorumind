import type { SessionSummary } from "./api.ts";

// Whether a session of the history waits for the person who reads the list. The menu's word for it ("Waiting for your
// answers") and the ring of its dot both come from here, so they never disagree.

/**
 * The session is the person's own and waits for them: their answers to the interview or to the debate's question, or
 * their check of the requirements. Someone else's session waits for its author, not for the reader.
 */
export function waitsForYou(item: Pick<SessionSummary, "phase" | "mine">): boolean {
  if (item.mine === false) return false;
  return item.phase === "interview" || item.phase === "awaiting_answers" || item.phase === "review";
}
