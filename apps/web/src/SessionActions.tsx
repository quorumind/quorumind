import type { Session } from "@quorumind/core";
import { isWorking } from "@quorumind/core/session";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { useCanEdit } from "./access.tsx";
import { ApiError, api, type Share, type ShareSettings } from "./api.ts";
import { CopyField } from "./components/CopyField.tsx";
import { Dialog, useDialog } from "./components/Dialog.tsx";
import { BranchIcon, ShareIcon, StopIcon, TrashIcon } from "./components/Icons.tsx";
import { ShareOptions } from "./components/ShareOptions.tsx";
import { failureText } from "./errors.ts";

type Action = "share" | "fork" | "stop" | "delete";

function ErrorNotice({ error }: { error: string | null }) {
  return error ? (
    <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
      {error}
    </p>
  ) : null;
}

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
  const shareDialog = useDialog();
  const deleteDialog = useDialog();
  const stopDialog = useDialog();
  const [pending, setPending] = useState<Action | null>(null);
  // Each action has its own error, shown where the action is: a failed fork next to its button, a failed deletion in
  // its dialog.
  const [errors, setErrors] = useState<Partial<Record<Action, string>>>({});
  const link = share ? `${window.location.origin}${window.location.pathname}#/shared/${share.token}` : "";
  const working = isWorking(session);

  const run = async (action: Action, work: () => Promise<void>) => {
    setPending(action);
    setErrors((current) => ({ ...current, [action]: undefined }));
    try {
      await work();
    } catch (caught) {
      setErrors((current) => ({ ...current, [action]: failureText(t, caught) }));
    } finally {
      setPending(null);
    }
  };
  const clear = (action: Action) => () => setErrors((current) => ({ ...current, [action]: undefined }));

  const apply = (settings: ShareSettings) => run("share", async () => onShare((await api.share(session.id, settings)).share));

  const fork = () =>
    run("fork", async () => {
      const { session: created } = await api.fork(session.id);
      refresh();
      navigate(`s/${created.id}`);
    });

  return (
    <div className="session-actions">
      {canEdit ? (
        <button type="button" className="button button-secondary" onClick={shareDialog.open}>
          <ShareIcon />
          {share ? t("share.shared") : t("share.button")}
        </button>
      ) : null}
      {session.sheet ? (
        <button type="button" className="button button-quiet" onClick={fork} disabled={pending !== null} title={t("session.forkHint")}>
          <BranchIcon />
          {t("session.fork")}
        </button>
      ) : null}
      {canEdit && working ? (
        <button type="button" className="button button-secondary danger" onClick={stopDialog.open}>
          <StopIcon />
          {t("session.stop")}
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          className="button button-quiet danger"
          onClick={deleteDialog.open}
          disabled={working}
          title={working ? t("session.deleteBusy") : undefined}
        >
          <TrashIcon />
          <span className="visually-hidden-mobile">{t("session.delete")}</span>
        </button>
      ) : null}
      {errors.fork ? (
        <div className="session-actions-error">
          <ErrorNotice error={errors.fork} />
        </div>
      ) : null}

      <Dialog dialog={shareDialog} labelledBy="share-title" onClose={clear("share")}>
        {/* Not a form: Enter in a field applies that field, it never closes the dialog. */}
        <div className="stack">
          <h2 id="share-title" className="heading">
            {t("share.title")}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {t("share.lead")}
          </p>
          {share ? (
            <>
              <CopyField value={link} label={t("share.link")} copy={t("share.copy")} copied={t("share.copied")} />
              <label className="check">
                <input
                  type="checkbox"
                  checked={share.public}
                  // The gallery lists finished sessions anyone can open: not one behind a password.
                  disabled={pending !== null || session.phase !== "complete" || share.hasPassword}
                  onChange={(event) => apply({ public: event.target.checked })}
                />
                <span>
                  {t("share.public")}
                  <span className="field-hint">{t("share.publicHint")}</span>
                </span>
              </label>
            </>
          ) : null}
          <ShareOptions share={share} pending={pending !== null} onApply={apply} />
          {share ? (
            <div className="row">
              <button
                type="button"
                className="button button-quiet danger"
                disabled={pending !== null}
                onClick={() =>
                  run("share", async () => {
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
          <ErrorNotice error={errors.share ?? null} />
          <div className="dialog-actions">
            <button type="button" className="button button-quiet" onClick={shareDialog.close}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog dialog={stopDialog} labelledBy="stop-title" onClose={clear("stop")}>
        <div className="stack">
          <h2 id="stop-title" className="heading">
            {t("session.stopTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("session.stopLead")}</p>
          <ErrorNotice error={errors.stop ?? null} />
          <div className="dialog-actions">
            <button type="button" className="button button-quiet" onClick={stopDialog.close}>
              {t("session.stopCancel")}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={pending !== null}
              onClick={() =>
                run("stop", async () => {
                  try {
                    await api.stop(session.id);
                  } catch (caught) {
                    // It finished on its own in the meantime: there is nothing left to stop.
                    if (!(caught instanceof ApiError && caught.code === "not_running")) throw caught;
                  }
                  stopDialog.close();
                })
              }
            >
              {t("session.stopConfirm")}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog dialog={deleteDialog} labelledBy="delete-title" onClose={clear("delete")}>
        <div className="stack">
          <h2 id="delete-title" className="heading">
            {t("session.deleteTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("session.deleteLead")}</p>
          <ErrorNotice error={errors.delete ?? null} />
          <div className="dialog-actions">
            <button type="button" className="button button-quiet" onClick={deleteDialog.close}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={pending !== null}
              onClick={() =>
                run("delete", async () => {
                  await api.remove(session.id);
                  deleteDialog.close();
                  refresh();
                  navigate("");
                })
              }
            >
              {t("session.deleteConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
