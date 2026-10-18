import type { z } from "zod";

// Every error the API answers is { error, message, params? }: `error` is a stable code the interface translates,
// `params` the values its message needs, and `message` the English explanation for API users and logs.

/** The body of a 400 for a request that does not match its schema: the first field at fault names the problem. */
export function invalidRequest(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join(".") || null;
  return {
    error: "invalid_request",
    message: field ? `The field "${field}" is invalid: ${issue?.message ?? "invalid value"}.` : "The request is invalid.",
    ...(field ? { params: { field } } : {}),
    issues: error.issues,
  };
}
