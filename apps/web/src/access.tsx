import type { TFunction } from "i18next";
import { createContext, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessions } from "./App.tsx";
import { type Author, api, type SessionAccess } from "./api.ts";
import { LockIcon } from "./components/Icons.tsx";

/** A self-hosted server sends no access, or a full one: the single local user does everything. */
export const FULL_ACCESS: SessionAccess = { mine: true, canEdit: true, shared: false, private: false };

/** What the person may do with the session on screen. */
export const AccessContext = createContext<SessionAccess>(FULL_ACCESS);

/** Whether the person may change the session on screen (answer, confirm, resume, share, delete), or only read it. */
export const useCanEdit = () => useContext(AccessContext).canEdit;

/** How a workspace's history names the author of a session someone else started. */
export function authorName(author: Author | null | undefined, t: TFunction): string {
  return author ? (author.name ?? author.email ?? t("workspace.formerMember")) : t("workspace.formerMember");
}

/**
 * Under the title of a workspace's session: who started it and who sees it. Its author can make it private, or
 * share it with the workspace again; the other members are told they can read it only.
 */
export function AccessLine({ id, access, onChange }: { id: string; access: SessionAccess; onChange: (access: SessionAccess) => void }) {
  const { t } = useTranslation();
  const { refresh } = useSessions();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!access.shared) return null;

  const toggle = async () => {
    setPending(true);
    setFailed(false);
    try {
      onChange((await api.setPrivate(id, !access.private)).access);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack access">
      <div className="row access-line">
        {access.private ? (
          <span className="chip label">
            <LockIcon />
            {t("workspace.private")}
          </span>
        ) : null}
        <span className="field-hint">
          {access.mine
            ? t(access.private ? "workspace.privateHint" : "workspace.sharedHint")
            : t("workspace.startedBy", { name: authorName(access.author, t) })}
        </span>
        {access.mine ? (
          <button type="button" className="button button-quiet" onClick={toggle} disabled={pending}>
            {access.private ? null : <LockIcon />}
            {t(access.private ? "workspace.makeShared" : "workspace.makePrivate")}
          </button>
        ) : null}
      </div>
      {access.canEdit ? null : <p className="notice">{t("workspace.readOnly")}</p>}
      {failed ? (
        <p className="notice notice-error" role="alert">
          {t("error.request")}
        </p>
      ) : null}
    </div>
  );
}
