import type { EngineEvent } from "@quorumind/core";

type Listener = (event: EngineEvent) => void;

/** In-process publish/subscribe of engine events, keyed by session. */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(sessionId: string, event: EngineEvent) {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }
}
