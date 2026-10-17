import type { Locale } from "@quorumind/core/locales";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate } from "./App.tsx";
import { type AppConfig, api, type SessionSummary } from "./api.ts";
import { ArrowIcon } from "./components/Icons.tsx";
import { Hemicycle } from "./components/Logo.tsx";
import { formatUsd } from "./format.ts";

export function Home() {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [idea, setIdea] = useState("");
  const [rounds, setRounds] = useState(1);
  const [budget, setBudget] = useState("");
  const [pending, setPending] = useState<"live" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(setConfig, () => setError(t("error.request")));
    api.sessions().then(
      (body) => setRecent(body.sessions),
      () => undefined,
    );
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
  const describe = (participant: { provider: string; model: string }) => `${participant.model}`;

  return (
    <div className="stack-lg">
      <section className="hero">
        <div className="hero-grid">
          <div className="stack">
            <h1 className="display-xl">{t("home.title")}</h1>
            <p className="lead">{t("home.lead")}</p>
            <form className="card start-card" onSubmit={onSubmit}>
              <div className="field">
                <label className="field-label" htmlFor="idea">
                  {t("home.ideaLabel")}
                </label>
                <textarea
                  id="idea"
                  className="textarea"
                  rows={3}
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
                <p className="field-hint">
                  {t("home.estimate", {
                    low: formatUsd(live.estimateUsd.low * rounds, i18n.language),
                    high: formatUsd(live.estimateUsd.high * rounds, i18n.language),
                  })}{" "}
                  {t("home.lineup", {
                    seats: Object.values(live.lineup.seats).map(describe).join(" · "),
                    arbiter: describe(live.lineup.arbiter),
                  })}
                </p>
              ) : null}
              {config && !live ? <p className="notice">{t("home.noKey")}</p> : null}
              {error ? (
                <p className="notice notice-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="row">
                <button type="submit" className="button button-primary" disabled={!live || !idea.trim() || pending !== null}>
                  {t("home.start")}
                  <ArrowIcon />
                </button>
                <button
                  type="button"
                  className={`button ${live ? "button-secondary" : "button-primary"}`}
                  onClick={() => start(true)}
                  disabled={pending !== null}
                >
                  {t("home.demo")}
                </button>
                <span className="field-hint">{t("home.demoHint")}</span>
              </div>
            </form>
          </div>
          <Hemicycle />
        </div>
      </section>

      <section className="steps" aria-label={t("app.tagline")}>
        {(["Interview", "Debate", "Verdict"] as const).map((step) => (
          <div className="step stack" key={step}>
            <h2 className="title">{t(`home.step${step}Title`)}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {t(`home.step${step}Body`)}
            </p>
          </div>
        ))}
      </section>

      {recent.length > 0 ? (
        <section className="stack">
          <h2 className="heading">{t("home.recent")}</h2>
          <div className="recent">
            {recent.slice(0, 8).map((item) => (
              <a key={item.id} href={`#/s/${item.id}`}>
                <span>{item.idea}</span>
                <span className="muted">{t(`phase.${item.phase}`)}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
