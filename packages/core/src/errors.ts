import type { RequirementsSheet } from "./schemas.ts";
import type { Session, SessionError } from "./session.ts";

/**
 * Why an action does not fit where the session stands. wrong_phase: the session is not at the step the action
 * belongs to; the server adds its own codes (session_busy, not_running).
 */
export class InvalidStateError extends Error {
  readonly code: string;
  readonly params: SessionError["params"];
  constructor(message: string, code = "wrong_phase", params?: SessionError["params"]) {
    super(message);
    this.name = "InvalidStateError";
    this.code = code;
    this.params = params;
  }
}

/** The requirements sheet of a session, which every step after the interview needs. */
export function requireSheet(session: Pick<Session, "sheet">): RequirementsSheet {
  if (!session.sheet) throw new InvalidStateError("The requirements sheet is missing.");
  return session.sheet;
}
