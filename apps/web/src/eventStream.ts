import type { EngineEvent } from "@quorumind/core";

// The live events of a session, kept alive. An EventSource retries by itself after a network error, but an HTTP error
// (a 502 while the server restarts behind a proxy) closes it for good: then a new one is opened, after a growing delay,
// until the server answers again or says the session is gone.

/** The delays before each new attempt, in milliseconds; the last one repeats. */
export const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

// EventSource.CLOSED, spelt out: the constant is not there outside a browser.
const CLOSED = 2;

export interface StreamHandlers {
  onEvent(event: EngineEvent): void;
  /**
   * The stream is open, again or for the first time. The server sends the session as it is now and never replays the
   * events missed meanwhile: what was being written when the connection dropped is stale.
   */
  onOpen(): void;
  /** The connection dropped: the page says it is reconnecting. */
  onLost(): void;
  /** The session does not exist (any more): no new attempt. */
  onMissing(): void;
}

/** What the stream needs from the browser, given by the tests. */
export interface StreamEnvironment {
  createSource(url: string): EventSource;
  /** The HTTP status of the session's own address, or null when the server cannot be reached. */
  status(url: string): Promise<number | null>;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Calls back when the browser is online again or the tab is shown again; returns how to stop. */
  onWake(callback: () => void): () => void;
}

const browser: StreamEnvironment = {
  createSource: (url) => new EventSource(url),
  status: (url) =>
    fetch(url).then(
      (response) => response.status,
      () => null,
    ),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  onWake: (callback) => {
    const visible = () => {
      if (document.visibilityState === "visible") callback();
    };
    window.addEventListener("online", callback);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", callback);
      document.removeEventListener("visibilitychange", visible);
    };
  },
};

/** Follows the events of a session until the returned function is called. */
export function followSession(id: string, handlers: StreamHandlers, environment: StreamEnvironment = browser): () => void {
  const eventsUrl = `/api/sessions/${id}/events`;
  let source: EventSource | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let open = false;
  let stopped = false;

  const connect = () => {
    timer = null;
    if (stopped) return;
    const current = environment.createSource(eventsUrl);
    source = current;
    current.onopen = () => {
      if (source !== current) return;
      attempt = 0;
      open = true;
      handlers.onOpen();
    };
    current.onmessage = (message) => {
      if (source !== current) return;
      handlers.onEvent(JSON.parse(message.data) as EngineEvent);
    };
    current.onerror = () => {
      if (source !== current) return;
      if (open) handlers.onLost();
      open = false;
      // Still connecting: the browser retries by itself after a network error.
      if (current.readyState !== CLOSED) return;
      current.close();
      source = null;
      void environment.status(`/api/sessions/${id}`).then((status) => {
        if (stopped || source !== null || timer !== null) return;
        if (status === 404) {
          stopped = true;
          handlers.onMissing();
          return;
        }
        handlers.onLost();
        retryLater();
      });
    };
  };

  const retryLater = () => {
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 1000;
    attempt++;
    timer = environment.setTimeout(connect, delay);
  };

  // Back online, or back to the tab: no need to wait for the next attempt.
  const stopWaking = environment.onWake(() => {
    if (stopped || open) return;
    if (timer !== null) environment.clearTimeout(timer);
    source?.close();
    source = null;
    connect();
  });

  connect();
  return () => {
    stopped = true;
    stopWaking();
    if (timer !== null) environment.clearTimeout(timer);
    source?.close();
    source = null;
  };
}
