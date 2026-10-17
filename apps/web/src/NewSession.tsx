import type { Locale } from "@quorumind/core/locales";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { type AppConfig, api } from "./api.ts";
import { ArrowIcon, PlayIcon } from "./components/Icons.tsx";
import { formatUsd } from "./format.ts";

export function NewSession() {
  const { t, i18n } = useTranslation();
  const { refresh } = useSessions();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [idea, setIdea] = useState("");
  const [rounds, setRounds] = useState(1);
  const [budget, setBudget] = useState("");
  const [pending, setPending] = useState<"live" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(setConfig, () => setError(t("error.request")));
  }, [t]);

  const start = async (demo: boolean) => {
    setPending(demo ? "demo" : "live");
    setError(null);
    try {
      const budgetUsd = budget.trim() ? Number(budget) : null;
      const { session } = await api.create({
        locale: i18n.language as Locale,
        idea: demo ? "" : idea.trim(),
        demo,
        rounds,
        budgetUsd: budgetUsd && budgetUsd > 0 ? budgetUsd : null,
      });
      refresh();
      navigate(`s/${session.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("error.request"));
      setPending(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (config?.live && idea.trim()) start(false);
  };

  const live = config?.live ?? null;

  return (
    <div className="narrow stack-lg new-session-page">
      <div className="stack">
        <h1 className="display">{t("home.newTitle")}</h1>
        <p className="lead" style={{ margin: 0 }}>
          {t("home.newLead")}
        </p>
      </div>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="idea">
            {t("home.ideaLabel")}
          </label>
          <textarea
            id="idea"
            className="textarea"
            rows={4}
            maxLength={4000}
            placeholder={t("home.ideaPlaceholder")}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            disabled={!live}
          />
        </div>
        <div className="options">
          <div className="field">
            <label className="field-hint" htmlFor="rounds">
              {t("home.rounds")}
            </label>
            <select id="rounds" className="select" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>
              {[1, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-hint" htmlFor="budget">
              {t("home.budget")}
            </label>
            <input
              id="budget"
              className="input"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              placeholder={t("home.budgetNone")}
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </div>
        </div>
        {live?.estimateUsd ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {t("home.estimate", {
              low: formatUsd(live.estimateUsd.low * rounds, i18n.language),
              high: formatUsd(live.estimateUsd.high * rounds, i18n.language),
            })}{" "}
            {t("home.lineup", {
              seats: Object.values(live.lineup.seats)
                .map((seat) => seat.model)
                .join(" · "),
              arbiter: live.lineup.arbiter.model,
            })}
          </p>
        ) : null}
        {config && !live ? <p className="notice">{t("home.noKey")}</p> : null}
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <button type="submit" className="button button-primary" disabled={!live || !idea.trim() || pending !== null}>
            {t("home.start")}
            <ArrowIcon />
          </button>
        </div>
      </form>

      <div className="demo-line">
        <button type="button" className="button button-quiet" onClick={() => start(true)} disabled={pending !== null}>
          <PlayIcon />
          {t("home.demo")}
        </button>
        <span className="field-hint">{t("home.demoHint")}</span>
      </div>
    </div>
  );
}
