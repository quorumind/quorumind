import type { Session } from "@quorumind/core";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { api, type Share } from "./api.ts";
import { BranchIcon, CheckIcon, ShareIcon, TrashIcon } from "./components/Icons.tsx";

/** Share, start again from this session, delete: the actions on a session's header. */
export function SessionActions({
  session,
  share,
  onShare,
}: {
  session: Session;
  share: Share | null;
  onShare: (share: Share | null) => void;
}) {
  const { t } = useTranslation();
  const { refresh } = useSessions();
  const shareDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = share ? `${window.location.origin}${window.location.pathname}#/shared/${share.token}` : "";
  const working = session.phase === "interview" || session.phase === "debating";

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error.request"));
    } finally {
      setPending(false);
    }
  };

  const fork = () =>
    run(async () => {
      const { session: created } = await api.fork(session.id);
      refresh();
      navigate(`s/${created.id}`);
    });

  return (
    <div className="session-actions">
      <button type="button" className="button button-secondary" onClick={() => shareDialog.current?.showModal()}>
        <ShareIcon />
        {share ? t("share.shared") : t("share.button")}
      </button>
      {session.sheet ? (
        <button type="button" className="button button-quiet" onClick={fork} disabled={pending} title={t("session.forkHint")}>
          <BranchIcon />
          {t("session.fork")}
        </button>
      ) : null}
      <button type="button" className="button button-quiet danger" onClick={() => deleteDialog.current?.showModal()} disabled={working}>
        <TrashIcon />
        <span className="visually-hidden-mobile">{t("session.delete")}</span>
      </button>

      <dialog ref={shareDialog} className="dialog" aria-labelledby="share-title">
        <form method="dialog" className="stack">
          <h2 id="share-title" className="heading">
            {t("share.title")}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {t("share.lead")}
          </p>
          {share ? (
            <>
              <div className="copy-row">
                <input
                  className="input mono"
                  readOnly
                  value={link}
                  aria-label={t("share.link")}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? (
                    <span className="copied">
                      <CheckIcon />
                      {t("share.copied")}
                    </span>
                  ) : (
                    t("share.copy")
                  )}
                </button>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={share.public}
                  disabled={pending || session.phase !== "complete"}
                  onChange={(event) => run(async () => onShare((await api.share(session.id, event.target.checked)).share))}
                />
                <span>
                  {t("share.public")}
                  <span className="field-hint">{t("share.publicHint")}</span>
                </span>
              </label>
              <div className="row">
                <button
                  type="button"
                  className="button button-quiet danger"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      await api.unshare(session.id);
                      onShare(null);
                    })
                  }
                >
                  {t("share.stop")}
                </button>
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                className="button button-primary"
                disabled={pending}
                onClick={() => run(async () => onShare((await api.share(session.id, false)).share))}
              >
                {t("share.create")}
              </button>
            </div>
          )}
          <p className="field-hint" style={{ margin: 0 }}>
            {t("share.privacy")}
          </p>
          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="submit" className="button button-quiet">
              {t("common.close")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={deleteDialog} className="dialog" aria-labelledby="delete-title">
        <form method="dialog" className="stack">
          <h2 id="delete-title" className="heading">
            {t("session.deleteTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("session.deleteLead")}</p>
          <div className="dialog-actions">
            <button type="submit" className="button button-quiet">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  await api.remove(session.id);
                  deleteDialog.current?.close();
                  refresh();
                  navigate("");
                })
              }
            >
              {t("session.deleteConfirm")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
