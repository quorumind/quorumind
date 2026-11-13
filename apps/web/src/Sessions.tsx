import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessions } from "./App.tsx";
import { authorName } from "./access.tsx";
import { api, type SessionSummary } from "./api.ts";
import { Segmented } from "./components/Controls.tsx";
import { CrossIcon, DebatesIcon, LockIcon, PlusIcon, RetryIcon } from "./components/Icons.tsx";
import { EmptyState, PageHead } from "./components/Page.tsx";
import { ShowMore, useDebounced, usePager } from "./components/ShowMore.tsx";
import { waitsForYou } from "./yourMove.ts";

// The sessions of the history, on a page of their own: every session the person may read, the latest first, with the
// filter of a shared history and a search by title. The menu leads here rather than listing them. The server gives
// them a page at a time ("Show more") and does the search itself, so it reaches the oldest ones too.

const sessionId = (item: SessionSummary) => item.id;

/** In a shared history, whose sessions to list. */
export function HistoryFilter() {
  const { t } = useTranslation();
  const { shared, mine, setMine } = useSessions();
  if (!shared) return null;
  return (
    <Segmented
      className="history-filter"
      legend={t("workspace.filter")}
      options={[
        { key: "everyone", value: false, label: t("workspace.everyone") },
        { key: "mine", value: true, label: t("workspace.mine") },
      ]}
      value={mine}
      onChange={setMine}
    />
  );
}

function SessionRow({ item, shared }: { item: SessionSummary; shared: boolean }) {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(item.updatedAt));
  return (
    <li>
      <a className="sessions-row" href={`#/s/${item.id}`}>
        <span className="sessions-row-main">
          <span className="sessions-row-title" dir="auto">
            {item.private ? (
              <span className="session-private" title={t("workspace.private")}>
                <LockIcon />
                <span className="visually-hidden">{t("workspace.private")}</span>
              </span>
            ) : null}
            {item.idea}
          </span>
          {shared && item.mine === false ? <span className="sessions-row-author">{authorName(item.author, t)}</span> : null}
        </span>
        <span className="sessions-row-meta">
          <span className="chip sessions-phase">
            <span className={`phase-dot phase-${item.phase}`} data-yours={waitsForYou(item) || undefined} />
            {t(`phase.${item.phase}`)}
          </span>
          <time dateTime={item.updatedAt}>{date}</time>
        </span>
      </a>
    </li>
  );
}

/** The page of the sessions. Hosted, they are named debates, as in the host's menu. */
export function Sessions({ hosted }: { hosted: boolean }) {
  const { t } = useTranslation();
  const history = useSessions();
  const { shared, mine, status, refresh } = history;
  const [query, setQuery] = useState("");
  const searchId = useId();
  const list = useRef<HTMLUListElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const title = hosted ? t("host.debates") : t("nav.sessions");
  const start = hosted ? t("host.newDebate") : t("nav.newSession");
  // The search is the server's, asked once the person paused; without one, the history the menu already holds.
  const wanted = query.trim();
  const settled = useDebounced(wanted);
  // Clearing the field brings the list back at once; typing waits for the pause.
  const typed = wanted !== "" && settled !== "";
  const searchPage = useCallback(
    (before: string | null) =>
      api.sessions({ mine, q: settled, before }).then((body) => ({ items: body.sessions, next: body.next ?? null })),
    [mine, settled],
  );
  const results = usePager(typed ? searchPage : null, sessionId);
  // Until the first answer of a search, and between typing and the next one, the page still shows what it had.
  const searching = typed && results.items !== null;
  // A failed first answer is not "still loading": the notice says so, and the list left on screen is no longer busy.
  const pending = wanted !== settled || (typed && !searching && !results.failed);
  const pager = searching ? results : history;
  const found = searching ? (results.items ?? []) : history.sessions;
  const ready = searching ? !results.refreshing : status === "ready";
  const failed = typed ? results.failed : status === "failed";

  // A search that went on and found nothing at the end replaces the button the person pressed: the focus goes to the
  // way out of it, not to the top of the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs once per load of the search.
  useEffect(() => {
    if (!searching || !results.loaded || results.next || (results.items?.length ?? 0) > 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) clear.current?.focus();
  }, [results.loaded]);

  return (
    <div className="stack-lg sessions-page">
      <PageHead
        title={title}
        action={
          <a className="button button-primary" href="#/">
            <PlusIcon />
            {start}
          </a>
        }
      />
      {history.sessions.length > 0 || shared || searching ? (
        <div className="sessions-toolbar">
          <div className="field sessions-search">
            <label className="visually-hidden" htmlFor={searchId}>
              {t("sessions.search")}
            </label>
            <input
              id={searchId}
              className="input"
              type="search"
              placeholder={t("sessions.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <HistoryFilter />
        </div>
      ) : null}
      {failed ? (
        <div className="notice notice-error row" role="alert">
          <span>{t("errors.generic")}</span>
          <button type="button" className="button button-secondary" onClick={typed ? results.reload : refresh}>
            <RetryIcon />
            {t("common.retry")}
          </button>
        </div>
      ) : null}
      {/* What the search found, said once rather than the whole list read out again. */}
      <p className="visually-hidden" role="status">
        {searching && ready && !pending ? t(pager.next ? "sessions.foundMore" : "sessions.found", { count: found.length }) : ""}
      </p>
      {/* A search that stopped before the end of a long history has no match yet but goes on: no "nothing" then. */}
      {ready && found.length === 0 && !pending && !pager.next ? (
        searching ? (
          <EmptyState
            icon={<DebatesIcon />}
            action={
              <button ref={clear} type="button" className="button button-secondary" onClick={() => setQuery("")}>
                <CrossIcon />
                {t("sessions.clear")}
              </button>
            }
          >
            {t("sessions.noMatch")}
          </EmptyState>
        ) : (
          <EmptyState
            icon={<DebatesIcon />}
            action={
              <a className="button button-primary" href="#/">
                <PlusIcon />
                {start}
              </a>
            }
          >
            {t("nav.noSessions")}
          </EmptyState>
        )
      ) : null}
      {found.length > 0 ? (
        <ul className="sessions-list" aria-label={title} aria-busy={pending || (searching && results.refreshing) || undefined} ref={list}>
          {found.map((item) => (
            <SessionRow key={item.id} item={item} shared={shared} />
          ))}
        </ul>
      ) : null}
      {/* One button for the list, with or without entries yet, so that it survives the first ones coming and keeps the focus. */}
      {found.length > 0 || (searching && ready && pager.next) ? (
        <ShowMore key={searching ? "search" : "history"} pager={pager} list={list} announce={!searching} />
      ) : null}
    </div>
  );
}
