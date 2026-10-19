import type { Session, Task } from "@quorumind/core";
import { useEffect, useState } from "react";
import { followSession, type StreamEnvironment } from "./eventStream.ts";

/** What a role is writing right now, keyed by `${task}:${seat}`. */
export type LiveSpeech = Record<string, { task: Task; seat: string | null; text: string }>;

export const speechKey = (task: Task, seat: string | null) => `${task}:${seat ?? "-"}`;

/**
 * How often the text being written is shown, in milliseconds. Each streamed token is an event, several roles write
 * at once: the page shows their progress a dozen times a second rather than at every token.
 */
export const SPEECH_FLUSH_MS = 80;

/** The session on screen, kept up to date by its events, and what its roles are writing. */
export function useSession(id: string, environment?: StreamEnvironment) {
  const [session, setSession] = useState<Session | null>(null);
  const [live, setLive] = useState<LiveSpeech>({});
  const [connected, setConnected] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setSession(null);
    setLive({});
    setMissing(false);
    setConnected(true);
    // The latest text of each role, shown at the next flush.
    let pending: LiveSpeech = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = {};
      if (Object.keys(batch).length > 0) setLive((current) => ({ ...current, ...batch }));
    };
    const drop = (key: string) => {
      delete pending[key];
      setLive((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };

    const stop = followSession(
      id,
      {
        onOpen: () => {
          // Nothing is replayed after a reconnection: a role that was writing has finished, or writes again.
          pending = {};
          setLive({});
          setConnected(true);
        },
        onLost: () => setConnected(false),
        onMissing: () => setMissing(true),
        onEvent: (event) => {
          switch (event.type) {
            case "session":
              setConnected(true);
              setSession(event.session);
              break;
            case "speaking": {
              const key = speechKey(event.task, event.seat);
              delete pending[key];
              setLive((current) => ({ ...current, [key]: { task: event.task, seat: event.seat, text: "" } }));
              break;
            }
            case "speech":
              pending[speechKey(event.task, event.seat)] = { task: event.task, seat: event.seat, text: event.text };
              timer ??= setTimeout(flush, SPEECH_FLUSH_MS);
              break;
            case "spoke":
              drop(speechKey(event.task, event.seat));
              break;
          }
        },
      },
      environment,
    );
    return () => {
      stop();
      if (timer !== null) clearTimeout(timer);
    };
  }, [id, environment]);

  return { session, live, connected, missing };
}
