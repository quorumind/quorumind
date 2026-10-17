import type { EngineEvent, Session, Task } from "@quorumind/core";
import { useEffect, useState } from "react";

/** What a role is writing right now, keyed by `${task}:${seat}`. */
export type LiveSpeech = Record<string, { task: Task; seat: string | null; text: string }>;

export const speechKey = (task: Task, seat: string | null) => `${task}:${seat ?? "-"}`;

export function useSession(id: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [live, setLive] = useState<LiveSpeech>({});
  const [connected, setConnected] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setSession(null);
    setLive({});
    setMissing(false);
    const source = new EventSource(`/api/sessions/${id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as EngineEvent;
      setConnected(true);
      switch (event.type) {
        case "session":
          setSession(structuredClone(event.session));
          break;
        case "speaking":
          setLive((current) => ({ ...current, [speechKey(event.task, event.seat)]: { task: event.task, seat: event.seat, text: "" } }));
          break;
        case "speech":
          setLive((current) => ({
            ...current,
            [speechKey(event.task, event.seat)]: { task: event.task, seat: event.seat, text: event.text },
          }));
          break;
        case "spoke":
          setLive((current) => {
            const next = { ...current };
            delete next[speechKey(event.task, event.seat)];
            return next;
          });
          break;
      }
    };
    source.onerror = () => {
      setConnected(false);
      // EventSource reconnects by itself; a 404 means the session does not exist.
      fetch(`/api/sessions/${id}`).then(
        (response) => {
          if (response.status === 404) {
            setMissing(true);
            source.close();
          }
        },
        () => undefined,
      );
    };
    return () => source.close();
  }, [id]);

  return { session, live, connected, missing };
}
