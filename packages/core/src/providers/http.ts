// Helpers shared by the providers that talk to their API with plain `fetch`.

import { ProviderError, type ProviderErrorOptions } from "./types.ts";

export type FetchLike = typeof globalThis.fetch;

/**
 * Yields the body line by line as it streams in, without the line terminators. `onData` is called for every piece
 * received, keep-alive comments included.
 */
export async function* readLines(body: ReadableStream<Uint8Array>, onData?: () => void): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    onData?.();
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer.replace(/\r$/, "");
}

/** Reads an error response body, preferring the API's own message. */
export async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    if (message) return message;
  } catch {
    // Not JSON: fall back to the raw text.
  }
  return text.trim().slice(0, 500) || response.statusText || `HTTP ${response.status}`;
}

export function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
}

/**
 * How long a call may take: it fails when nothing at all arrives for `idleMs` (a stalled connection, or a stream that
 * stopped), or when it has not ended after `totalMs` (keep-alive comments keep a stuck upstream "alive").
 */
export interface Timeouts {
  idleMs: number;
  totalMs: number;
}

/** Cloud APIs: long enough for a model that thinks before it streams anything. */
export const CLOUD_TIMEOUTS: Timeouts = { idleMs: 5 * 60_000, totalMs: 20 * 60_000 };
/** A model on the premises: it may load from disk and read a long prompt on a CPU before it streams anything. */
export const LOCAL_TIMEOUTS: Timeouts = { idleMs: 10 * 60_000, totalMs: 60 * 60_000 };

/**
 * A watch over one call: its signal aborts when the caller's does, or when the call stalls or runs too long. `touch`
 * is called on every piece of data received; `expired` tells a call that timed out from one the caller cancelled.
 */
export interface Watch {
  signal: AbortSignal;
  touch(): void;
  expired(): "idle" | "total" | null;
  /** Stops the timers: call it once the call is over, whatever its outcome. */
  done(): void;
}

export function watch(caller: AbortSignal | undefined, timeouts: Timeouts): Watch {
  const controller = new AbortController();
  let expired: "idle" | "total" | null = null;
  const expire = (why: "idle" | "total") => () => {
    expired = why;
    controller.abort(new Error(why === "idle" ? "The call stalled." : "The call took too long."));
  };
  let idle = setTimeout(expire("idle"), timeouts.idleMs);
  const total = setTimeout(expire("total"), timeouts.totalMs);
  return {
    signal: caller ? AbortSignal.any([caller, controller.signal]) : controller.signal,
    touch() {
      if (expired) return;
      clearTimeout(idle);
      idle = setTimeout(expire("idle"), timeouts.idleMs);
    },
    expired: () => (caller?.aborted ? null : expired),
    done() {
      clearTimeout(idle);
      clearTimeout(total);
    },
  };
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

/** Why a watched call timed out, in English, for the error the engine retries. */
export function timeoutMessage(api: string, expired: "idle" | "total", timeouts: Timeouts): string {
  return expired === "idle"
    ? `${api} sent nothing for ${seconds(timeouts.idleMs)}: the call stalled.`
    : `${api} did not finish the answer within ${seconds(timeouts.totalMs)}.`;
}

/**
 * The error of a watched call that failed before or while streaming: timed out (retryable), cancelled by the caller,
 * or cut for another reason (retryable, with `interrupted` as its message).
 */
export function callFailure(
  error: unknown,
  call: Watch,
  caller: AbortSignal | undefined,
  context: { api: string; timeouts: Timeouts; interrupted: string; billed?: ProviderErrorOptions },
): ProviderError {
  const billed = context.billed ?? {};
  const expired = call.expired();
  if (expired) {
    return new ProviderError(timeoutMessage(context.api, expired, context.timeouts), true, {
      cause: error,
      code: "provider_unavailable",
      ...billed,
    });
  }
  if (isAbort(error, caller)) return new ProviderError("The request was cancelled.", false, { cause: error, ...billed });
  return new ProviderError(context.interrupted, true, { cause: error, code: "provider_unavailable", ...billed });
}

/** How long a response asks to wait before trying again (Retry-After, in seconds or as a date; retry-after-ms), if it says. */
export function retryAfterMs(headers: Headers | null | undefined, now = Date.now()): number | undefined {
  const exact = Number(headers?.get("retry-after-ms"));
  if (headers?.get("retry-after-ms") && Number.isFinite(exact) && exact >= 0) return exact;
  const value = headers?.get("retry-after")?.trim();
  if (!value) return undefined;
  const delay = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
