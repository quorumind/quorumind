export const CONTEXT_ERROR_CODES = [
  "unsupported_type",
  "too_large",
  "empty",
  "scanned",
  "encrypted",
  "fetch_failed",
  "blocked_address",
  "not_found",
  "rate_limited",
  "too_many_imports",
] as const;

export type ContextErrorCode = (typeof CONTEXT_ERROR_CODES)[number];

/** Why a document could not be imported. The code is stable: the interface translates it. */
export class ContextError extends Error {
  readonly code: ContextErrorCode;
  constructor(code: ContextErrorCode, message: string) {
    super(message);
    this.name = "ContextError";
    this.code = code;
  }

  /** The person sent something unusable (400 or 413), the source could not deliver it (422), or imports are throttled (429). */
  get status(): 400 | 413 | 422 | 429 {
    switch (this.code) {
      case "unsupported_type":
      case "blocked_address":
        return 400;
      case "too_large":
        return 413;
      case "too_many_imports":
        return 429;
      default:
        return 422;
    }
  }
}
