import { isLocale } from "@quorumind/core/locales";
import { localeCurrency } from "@quorumind/core/profile";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppConfig, api } from "./api.ts";
import { BrandingSettings } from "./components/BrandingSettings.tsx";
import { DownloadIcon, ExternalIcon } from "./components/Icons.tsx";
import { PageHeading } from "./components/Page.tsx";
import { ProfileSettings } from "./components/ProfileSettings.tsx";
import { groupLabel } from "./format.ts";

export function Settings() {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    api.config().then(setConfig, () => undefined);
  }, []);

  return (
    <div className="narrow stack-lg">
      <PageHeading title={t("settings.title")} />

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

      {config?.profileSettings === false ? (
        <section className="card stack">
          <h2 className="heading">{t("profile.title")}</h2>
          {config.profilePage ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {t("profile.managedLead")}
              </p>
              {config.profilePage.canEdit ? (
                <div>
                  <a className="button button-secondary" href={config.profilePage.url}>
                    {t("profile.open")}
                    <ExternalIcon />
                  </a>
                </div>
              ) : (
                <p className="field-hint" style={{ margin: 0 }}>
                  {t("profile.managedReadOnly")}
                </p>
              )}
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {t("profile.managed")}
            </p>
          )}
        </section>
      ) : config ? (
        <ProfileSettings defaultCurrency={localeCurrency(isLocale(i18n.language) ? i18n.language : "en")} />
      ) : null}

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
