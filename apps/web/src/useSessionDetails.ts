import type { Session } from "@quorumind/core";
import { useCallback, useEffect, useState } from "react";
import { FULL_ACCESS } from "./access.tsx";
import { api, type Feedback, type PriceQuote, type SessionAccess, type Share } from "./api.ts";
import { RECONNECT_DELAYS } from "./eventStream.ts";

// What the page of a session knows besides the session itself: its share link, its feedback, its prices and what the
// person may do with it. The events of the session do not carry them, so they are asked for again whenever the
// session reaches a point where they change (a verdict, a revision, an adoption), when the tab is shown again, and
// after a failure, until the server answers.

export interface SessionDetails {
  share: Share | null;
  feedback: Feedback[];
  price: PriceQuote | null;
  /** What the next revision of the verdict costs: known once there is a verdict. */
  revisionPrice: PriceQuote | null;
  providerCosts: boolean;
  access: SessionAccess;
}

/** What changes the details, in one string: a new value asks for them again. */
export function detailsKey(session: Session | null): string | null {
  if (!session) return null;
  const revising = session.revising ? (session.revising.error ? "failed" : "running") : "idle";
  return [session.phase, session.verdict ? "verdict" : "none", session.revisions.length, revising, session.adopted ?? "-"].join("|");
}

export function useSessionDetails(id: string, session: Session | null) {
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);
  const key = detailsKey(session);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `asked` say when to ask again.
  useEffect(() => {
    if (key === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const load = () => {
      timer = null;
      api.session(id).then(
        (body) => {
          if (!live) return;
          setFailed(false);
          setDetails({
            share: body.share,
            feedback: body.feedback,
            price: body.price,
            revisionPrice: body.revisionPrice ?? null,
            providerCosts: body.providerCosts,
            access: body.access ?? FULL_ACCESS,
          });
        },
        () => {
          if (!live) return;
          setFailed(true);
          timer = setTimeout(load, RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)]);
        },
      );
    };
    load();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id, key, asked]);

  // Another tab may have shared it, or made it private, meanwhile.
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") setAsked((count) => count + 1);
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);

  const retry = useCallback(() => setAsked((count) => count + 1), []);
  const update = useCallback(
    (patch: Partial<SessionDetails>) => setDetails((current) => (current ? { ...current, ...patch } : current)),
    [],
  );
  return { details, failed, retry, update };
}
