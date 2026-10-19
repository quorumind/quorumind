import type { EngineEvent } from "@quorumind/core";
import { describe, expect, it, vi } from "vitest";
import { followSession, RECONNECT_DELAYS, type StreamEnvironment } from "./eventStream.ts";

/** An EventSource the test drives: open it, send it events, fail it. */
class FakeSource {
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(event: EngineEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  /** A network error: the browser retries by itself. */
  drop() {
    this.readyState = 0;
    this.onerror?.();
  }
  /** An HTTP error (a 502 from a proxy): the source is closed for good. */
  fail() {
    this.readyState = 2;
    this.onerror?.();
  }
  close() {
    this.readyState = 2;
    this.closed = true;
  }
}

function setup(status: number | null = 502) {
  const sources: FakeSource[] = [];
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  let wake: () => void = () => undefined;
  const environment: StreamEnvironment = {
    createSource: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
    status: vi.fn(async () => status),
    setTimeout: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    onWake: (callback) => {
      wake = callback;
      return () => {
        wake = () => undefined;
      };
    },
  };
  const handlers = { onEvent: vi.fn(), onOpen: vi.fn(), onLost: vi.fn(), onMissing: vi.fn() };
  const stop = followSession("s1", handlers, environment);
  const runTimer = () => {
    const timer = timers.filter((item) => !item.cleared).at(-1);
    if (!timer) throw new Error("No timer");
    timer.cleared = true;
    timer.callback();
  };
  return { sources, timers, handlers, environment, stop, runTimer, wake: () => wake() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the live events of a session", () => {
  it("passes the events on once the stream is open", () => {
    const { sources, handlers } = setup();
    expect(sources[0]?.url).toBe("/api/sessions/s1/events");
    sources[0]?.open();
    sources[0]?.send({ type: "speaking", sessionId: "s1", task: "proposal", seat: "A" } as EngineEvent);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "speaking", seat: "A" }));
  });

  it("lets the browser retry after a network error, and says it is reconnecting", () => {
    const { sources, handlers, timers } = setup();
    sources[0]?.open();
    sources[0]?.drop();
    expect(handlers.onLost).toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    expect(timers).toHaveLength(0);
    // The browser reconnected: the page starts again from the snapshot the server sends.
    sources[0]?.open();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });

  it("opens a new stream after an HTTP error, waiting longer each time", async () => {
    const { sources, handlers, timers, runTimer } = setup(502);
    sources[0]?.open();
    sources[0]?.fail();
    await flush();
    expect(sources[0]?.closed).toBe(true);
    expect(handlers.onLost).toHaveBeenCalled();
    expect(timers.map((timer) => timer.ms)).toEqual([RECONNECT_DELAYS[0]]);

    runTimer();
    expect(sources).toHaveLength(2);
    sources[1]?.fail();
    await flush();
    runTimer();
    sources[2]?.fail();
    await flush();
    expect(timers.map((timer) => timer.ms)).toEqual(RECONNECT_DELAYS.slice(0, 3));

    // The server answers again: the delays start over.
    runTimer();
    sources[3]?.open();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
    sources[3]?.fail();
    await flush();
    expect(timers.at(-1)?.ms).toBe(RECONNECT_DELAYS[0]);
  });

  it("stops when the session does not exist any more", async () => {
    const { sources, handlers, timers } = setup(404);
    sources[0]?.fail();
    await flush();
    expect(handlers.onMissing).toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });

  it("keeps trying while the server cannot be reached at all", async () => {
    const { sources, timers } = setup(null);
    sources[0]?.fail();
    await flush();
    expect(timers).toHaveLength(1);
  });

  it("reconnects at once when the browser is back online", async () => {
    const { sources, timers, wake } = setup(502);
    sources[0]?.fail();
    await flush();
    wake();
    expect(timers[0]?.cleared).toBe(true);
    expect(sources).toHaveLength(2);
  });

  it("closes everything when the page leaves", async () => {
    const { sources, timers, stop } = setup(502);
    sources[0]?.fail();
    await flush();
    stop();
    expect(timers[0]?.cleared).toBe(true);
    // A late answer of the status check starts nothing.
    expect(sources).toHaveLength(1);
  });
});
