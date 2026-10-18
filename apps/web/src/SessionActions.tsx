import type { Session } from "@quorumind/core";
import { isWorking } from "@quorumind/core/session";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { useCanEdit } from "./access.tsx";
import { ApiError, api, type Share, type ShareSettings } from "./api.ts";
import { BranchIcon, CheckIcon, ShareIcon, StopIcon, TrashIcon } from "./components/Icons.tsx";
import { ShareOptions } from "./components/ShareOptions.tsx";
import { failureText } from "./errors.ts";

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
  // A member who may only read the session can still start again from it.
  const canEdit = useCanEdit();
  const shareDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const stopDialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = share ? `${window.location.origin}${window.location.pathname}#/shared/${share.token}` : "";
  const working = isWorking(session);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  const apply = (settings: ShareSettings) => run(async () => onShare((await api.share(session.id, settings)).share));

  const fork = () =>
    run(async () => {
      const { session: created } = await api.fork(session.id);
      refresh();
      navigate(`s/${created.id}`);
    });

  return (
    <div className="session-actions">
      {canEdit ? (
        <button type="button" className="button button-secondary" onClick={() => shareDialog.current?.showModal()}>
          <ShareIcon />
          {share ? t("share.shared") : t("share.button")}
        </button>
      ) : null}
      {session.sheet ? (
        <button type="button" className="button button-quiet" onClick={fork} disabled={pending} title={t("session.forkHint")}>
          <BranchIcon />
          {t("session.fork")}
        </button>
      ) : null}
      {canEdit && working ? (
        <button type="button" className="button button-secondary danger" onClick={() => stopDialog.current?.showModal()}>
          <StopIcon />
          {t("session.stop")}
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className="button button-quiet danger"
          onClick={() => deleteDialog.current?.showModal()}
          disabled={working}
          title={working ? t("session.deleteBusy") : undefined}
        >
          <TrashIcon />
          <span className="visually-hidden-mobile">{t("session.delete")}</span>
        </button>
      ) : null}

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
                  // The gallery lists finished sessions anyone can open: not one behind a password.
                  disabled={pending || session.phase !== "complete" || share.hasPassword}
                  onChange={(event) => apply({ public: event.target.checked })}
                />
                <span>
                  {t("share.public")}
                  <span className="field-hint">{t("share.publicHint")}</span>
                </span>
              </label>
            </>
          ) : null}
          <ShareOptions share={share} pending={pending} onApply={apply} />
          {share ? (
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
          ) : null}
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

      <dialog ref={stopDialog} className="dialog" aria-labelledby="stop-title">
        <form method="dialog" className="stack">
          <h2 id="stop-title" className="heading">
            {t("session.stopTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("session.stopLead")}</p>
          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="submit" className="button button-quiet">
              {t("session.stopCancel")}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  try {
                    await api.stop(session.id);
                  } catch (caught) {
                    // It finished on its own in the meantime: there is nothing left to stop.
                    if (!(caught instanceof ApiError && caught.code === "not_running")) throw caught;
                  }
                  stopDialog.current?.close();
                })
              }
            >
              {t("session.stopConfirm")}
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
