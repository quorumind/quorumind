import type { EngineEvent } from "@quorumind/core";
import { describe, expect, it } from "vitest";
import { EventBus } from "./bus.ts";

const event: EngineEvent = { type: "speaking", task: "interview", seat: null };

describe("event bus", () => {
  it("delivers a session's events to its listeners only", () => {
    const bus = new EventBus();
    const a: EngineEvent[] = [];
    const b: EngineEvent[] = [];
    bus.subscribe("s1", (received) => a.push(received));
    bus.subscribe("s2", (received) => b.push(received));
    bus.publish("s1", event);
    expect(a).toEqual([event]);
    expect(b).toEqual([]);
    bus.publish("nobody", event);
  });

  it("stops delivering once unsubscribed, and forgets sessions nobody listens to", () => {
    const bus = new EventBus();
    const received: EngineEvent[] = [];
    const unsubscribe = bus.subscribe("s1", (item) => received.push(item));
    const other = bus.subscribe("s1", () => {});
    unsubscribe();
    bus.publish("s1", event);
    expect(received).toEqual([]);
    expect(bus.listenerCount("s1")).toBe(1);
    other();
    expect(bus.listenerCount("s1")).toBe(0);
  });

  it("ignores a second unsubscribe, even after someone else subscribed to the same session", () => {
    const bus = new EventBus();
    const first = bus.subscribe("s1", () => {});
    first();
    const received: EngineEvent[] = [];
    bus.subscribe("s1", (item) => received.push(item));
    // The event stream calls it on abort and again when its loop ends.
    first();
    first();
    bus.publish("s1", event);
    expect(received).toEqual([event]);
    expect(bus.listenerCount("s1")).toBe(1);
  });

  it("keeps a listener registered twice under two subscriptions", () => {
    const bus = new EventBus();
    const received: EngineEvent[] = [];
    const listener = (item: EngineEvent) => received.push(item);
    const first = bus.subscribe("s1", listener);
    bus.subscribe("s2", listener);
    first();
    bus.publish("s2", event);
    expect(received).toEqual([event]);
  });
});
