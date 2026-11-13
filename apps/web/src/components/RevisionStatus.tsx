import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mark } from "./Logo.tsx";

/** How long a sent revision may go unseen by the session before the form is given back. */
export const REVISION_SILENCE_MS = 20_000;

/**
 * Whether the session's live feed is up, for the forms of the page: a revision that runs while it is down may end
 * without the page hearing of it. The session page provides it; elsewhere the feed is taken as up.
 */
export const FeedConnected = createContext(true);

/** The id of the status line at the top of the verdict, where the revision's progress is told. */
export const REVISION_PROGRESS_ID = "revision-progress";

/**
 * What a form that asks for a revision says once it was sent: the work is on, here is where it shows. The live
 * region is always in the page and its content comes and goes, which is what makes a screen reader announce it.
 * `following` (the server has begun the revision) adds the way to the progress at the top of the page.
 */
export function RevisionStatus({
  working,
  stalled = false,
  scenario = false,
  following,
}: {
  working: boolean;
  /** The server has said nothing for a while: the form is usable again and the work may still be going on. */
  stalled?: boolean;
  scenario?: boolean;
  following: boolean;
}) {
  const { t } = useTranslation();
  const follow = () => {
    const target = document.getElementById(REVISION_PROGRESS_ID);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  };
  return (
    // Once the page's own progress line (at the top) is there, it is the one that is announced: not the same text twice.
    <div role="status" aria-live={following ? "off" : undefined}>
      {stalled && !working ? (
        <p className="notice" style={{ margin: 0 }}>
          {t("revision.background")}
        </p>
      ) : null}
      {working ? (
        <div className="notice revision-working revision-here" style={{ margin: 0 }}>
          <Mark busy />
          <span>{scenario ? t("scenario.working") : t("revision.working")}</span>
          {following ? (
            <button type="button" className="button button-quiet" onClick={follow}>
              {t("revision.seeProgress")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Keeps what the person wrote on screen while the revision runs and clears it once the revision is over (it began and
 * ended, it failed, or a new revision appeared), so the form never looks emptied with nothing happening. `submitted` is called
 * when the request was accepted; `reset` empties the form; `draft` is what the form holds, in any form that changes
 * when it does. `locked`: the form waits for a revision, its own or one already running.
 *
 * When the page hears nothing for a while (the revision never showed, or the feed dropped while it ran), the form is
 * given back (`stalled`) and stays usable until the revision is over. What the person writes in it meanwhile is their
 * next request: the end of the earlier revision does not wipe it, it empties only the text that was sent.
 */
export function useClearAfterRevision({
  running,
  failed,
  count,
  draft,
  reset,
}: {
  running: boolean;
  /** The revision stopped on an error, which the page shows with its own way to try again. */
  failed: boolean;
  count: number;
  draft: string;
  reset: () => void;
}) {
  const connected = useContext(FeedConnected);
  const [waiting, setWaiting] = useState(false);
  // The session never showed the revision, or stopped saying anything: the form is given back, the text kept, and the
  // status says the work may go on.
  const [stalled, setStalled] = useState(false);
  const began = useRef(false);
  const countAtSubmit = useRef(count);
  const failedAtSubmit = useRef(failed);
  const sent = useRef(draft);
  const current = useRef(draft);
  current.current = draft;
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    if (!waiting && !stalled) return;
    if (running) began.current = true;
    if ((began.current && !running) || (failed && !failedAtSubmit.current) || count > countAtSubmit.current) {
      began.current = false;
      setWaiting(false);
      setStalled(false);
      if (current.current === sent.current) latest.current();
    }
  }, [running, failed, count, waiting, stalled]);
  // The revision may never have shown, or the feed may have dropped while it ran (the page then hears neither its
  // progress nor its end): do not keep the form locked for ever. While it runs with the feed up, its end will come.
  useEffect(() => {
    if (!waiting || (running && connected)) return;
    const timer = setTimeout(() => {
      setWaiting(false);
      setStalled(true);
    }, REVISION_SILENCE_MS);
    return () => clearTimeout(timer);
  }, [waiting, running, connected]);
  return {
    waiting,
    stalled,
    locked: waiting || (running && !stalled),
    submitted: () => {
      setStalled(false);
      countAtSubmit.current = count;
      failedAtSubmit.current = failed;
      sent.current = current.current;
      began.current = running;
      setWaiting(true);
    },
  };
}
