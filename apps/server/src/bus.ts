import type { EngineEvent } from "@quorumind/core";

type Listener = (event: EngineEvent) => void;

/** In-process publish/subscribe of engine events, keyed by session. */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(sessionId: string, event: EngineEvent) {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }

  /** Listens to a session's events. The function it returns stops listening; calling it again does nothing. */
  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    const own = set;
    own.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      own.delete(listener);
      // Another subscriber may have created a new set for this session since: only an empty set of ours goes.
      if (own.size === 0 && this.listeners.get(sessionId) === own) this.listeners.delete(sessionId);
    };
  }

  /** How many listeners a session has, for tests and diagnostics. */
  listenerCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }
}
