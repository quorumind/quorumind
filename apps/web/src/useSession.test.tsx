/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { EngineEvent } from "@quorumind/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StreamEnvironment } from "./eventStream.ts";
import { demoSession } from "./test/sessions.ts";
import { SPEECH_FLUSH_MS, useSession } from "./useSession.ts";

/** A stream the test drives through the handlers the hook gives it. */
function fakeStream() {
  const sources: {
    onopen: (() => void) | null;
    onmessage: ((message: { data: string }) => void) | null;
    onerror: (() => void) | null;
    readyState: number;
  }[] = [];
  const environment: StreamEnvironment = {
    createSource: () => {
      const source = { onopen: null, onmessage: null, onerror: null, readyState: 0, close() {} };
      sources.push(source);
      return source as unknown as EventSource;
    },
    status: async () => 502,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as number),
    onWake: () => () => undefined,
  };
  const current = () => sources.at(-1) as (typeof sources)[number];
  const send = (event: Partial<EngineEvent>) => act(() => current().onmessage?.({ data: JSON.stringify(event) }));
  return { environment, sources, current, send } as const;
}

describe("useSession", () => {
  it("shows what a role writes, a few times a second rather than at every token", async () => {
    const stream = fakeStream();
    const { result } = renderHook(() => useSession("s1", stream.environment));
    act(() => stream.current().onopen?.());
    stream.send({ type: "speaking", task: "proposal", seat: "A" });
    expect(result.current.live["proposal:A"]?.text).toBe("");
    stream.send({ type: "speech", task: "proposal", seat: "A", text: "He" });
    stream.send({ type: "speech", task: "proposal", seat: "A", text: "Hello" });
    expect(result.current.live["proposal:A"]?.text).toBe("");
    await waitFor(() => expect(result.current.live["proposal:A"]?.text).toBe("Hello"), { timeout: SPEECH_FLUSH_MS * 10 });
    stream.send({ type: "spoke", task: "proposal", seat: "A" });
    expect(result.current.live).toEqual({});
  });

  it("leaves no ghost writing bubble after a reconnection", async () => {
    const session = await demoSession("interview");
    const stream = fakeStream();
    const { result } = renderHook(() => useSession("s1", stream.environment));
    act(() => stream.current().onopen?.());
    stream.send({ type: "session", session } as EngineEvent);
    stream.send({ type: "speaking", task: "proposal", seat: "B" });
    expect(Object.keys(result.current.live)).toEqual(["proposal:B"]);

    // The connection drops while B writes; its "spoke" is lost.
    act(() => {
      stream.current().readyState = 0;
      stream.current().onerror?.();
    });
    expect(result.current.connected).toBe(false);
    act(() => stream.current().onopen?.());
    stream.send({ type: "session", session } as EngineEvent);
    expect(result.current.live).toEqual({});
    expect(result.current.connected).toBe(true);
    expect(result.current.session?.id).toBe(session.id);
  });

  it("drops the text of a role that finished before it was shown", async () => {
    const stream = fakeStream();
    const { result } = renderHook(() => useSession("s1", stream.environment));
    act(() => stream.current().onopen?.());
    stream.send({ type: "speaking", task: "critique", seat: "A" });
    stream.send({ type: "speech", task: "critique", seat: "A", text: "Late" });
    stream.send({ type: "spoke", task: "critique", seat: "A" });
    await new Promise((resolve) => setTimeout(resolve, SPEECH_FLUSH_MS * 2));
    expect(result.current.live).toEqual({});
  });

  it("recovers from an HTTP error on the stream with a new connection", async () => {
    const stream = fakeStream();
    const { result } = renderHook(() => useSession("s1", stream.environment));
    act(() => stream.current().onopen?.());
    act(() => {
      stream.current().readyState = 2;
      stream.current().onerror?.();
    });
    await waitFor(() => expect(stream.sources).toHaveLength(2), { timeout: 3000 });
    expect(result.current.connected).toBe(false);
    act(() => stream.current().onopen?.());
    expect(result.current.connected).toBe(true);
  });
});
