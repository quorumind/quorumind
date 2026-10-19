import { useTranslation } from "react-i18next";
import { RetryIcon } from "./Icons.tsx";

/** Saved settings that could not be loaded: their form stays disabled, so that saving cannot erase them. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="notice notice-error row" role="alert">
      <span>{t("settings.loadFailed")}</span>
      <button type="button" className="button button-secondary" onClick={onRetry}>
        <RetryIcon />
        {t("common.retry")}
      </button>
    </div>
  );
}
