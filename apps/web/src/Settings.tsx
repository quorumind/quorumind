import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppConfig, api } from "./api.ts";
import { BrandingSettings } from "./components/BrandingSettings.tsx";
import { DownloadIcon } from "./components/Icons.tsx";
import { groupLabel } from "./format.ts";

export function Settings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    api.config().then(setConfig, () => undefined);
  }, []);

  return (
    <div className="narrow stack-lg">
      <h1 className="display">{t("settings.title")}</h1>

      <section className="card stack">
        <h2 className="heading">{t("settings.models")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("settings.modelsLead")}
        </p>
        {config?.localOnly ? <p className="notice">{t("settings.localOnly")}</p> : null}
        {config && config.catalog.length === 0 ? <p className="notice">{t("home.noKey")}</p> : null}
        <ul className="catalog">
          {config?.catalog.map((option) => (
            <li key={`${option.provider}:${option.model}`}>
              <span className="mono">{option.model}</span>
              <span className="muted">{option.maker ? `${option.label} · ${groupLabel(option, t)}` : option.label.split(" · ")[0]}</span>
              {option.local ? <span className="chip local-chip">{t("settings.local")}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <BrandingSettings />

      <section className="card stack">
        <h2 className="heading">{t("settings.data")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {config?.retentionDays ? t("settings.retention", { days: config.retentionDays }) : t("settings.retentionNone")}
        </p>
        <div>
          <a className="button button-secondary" href={api.exportUrl()} download>
            <DownloadIcon />
            {t("settings.export")}
          </a>
        </div>
        <p className="field-hint" style={{ margin: 0 }}>
          {t("settings.deleteHint")}
        </p>
      </section>
    </div>
  );
}
