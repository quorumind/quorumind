import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessions } from "./App.tsx";
import { authorName } from "./access.tsx";
import type { SessionSummary } from "./api.ts";
import { Segmented } from "./components/Controls.tsx";
import { CrossIcon, DebatesIcon, LockIcon, PlusIcon, RetryIcon } from "./components/Icons.tsx";
import { EmptyState, PageHeading } from "./components/Page.tsx";

// The sessions of the history, on a page of their own: every session the person may read, the latest first, with the
// filter of a shared history and a search by title. The menu leads here rather than listing them.

/** Letters without their accents and case, for a search that finds "Équipe" from "equipe". */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

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
            <span className={`phase-dot phase-${item.phase}`} />
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
  const { sessions, shared, status, refresh } = useSessions();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const title = hosted ? t("host.debates") : t("nav.sessions");
  const start = hosted ? t("host.newDebate") : t("nav.newSession");
  const wanted = folded(query.trim());
  const found = wanted ? sessions.filter((item) => folded(item.idea).includes(wanted)) : sessions;

  return (
    <div className="stack-lg sessions-page">
      <header className="register-head">
        <PageHeading title={title} />
        <a className="button button-primary" href="#/">
          <PlusIcon />
          {start}
        </a>
      </header>
      {sessions.length > 0 || shared ? (
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
      {status === "failed" ? (
        <div className="notice notice-error row" role="alert">
          <span>{t("errors.generic")}</span>
          <button type="button" className="button button-secondary" onClick={refresh}>
            <RetryIcon />
            {t("common.retry")}
          </button>
        </div>
      ) : null}
      {/* What the search found, said once rather than the whole list read out again. */}
      <p className="visually-hidden" role="status">
        {wanted && status === "ready" ? t("sessions.found", { count: found.length }) : ""}
      </p>
      {status === "ready" && found.length === 0 ? (
        wanted ? (
          <EmptyState
            icon={<DebatesIcon />}
            action={
              <button type="button" className="button button-secondary" onClick={() => setQuery("")}>
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
        <ul className="sessions-list" aria-label={title}>
          {found.map((item) => (
            <SessionRow key={item.id} item={item} shared={shared} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
