import type { Feasibility, Session } from "@quorumind/core";
import { currentProposals } from "@quorumind/core/session";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { CheckIcon, CrossIcon, DownloadIcon, WarningIcon } from "./components/Icons.tsx";

function FeasibilityChip({ value }: { value: Feasibility }) {
  const { t } = useTranslation();
  const icon = value === "feasible" ? <CheckIcon /> : value === "conditional" ? <WarningIcon /> : <CrossIcon />;
  return (
    <span className={`feasibility feasibility-${value}`}>
      {icon}
      {t(`feasibility.${value}`)}
    </span>
  );
}

function Score({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <span className="score" role="img" aria-label={t("verdict.scoreOutOf", { score: value })}>
      {[1, 2, 3, 4, 5].map((step) => (
        <i key={step} data-on={step <= value} />
      ))}
      <span className="mono" style={{ marginInlineStart: 6 }}>
        {value}
      </span>
    </span>
  );
}

export function Verdict({ session }: { session: Session }) {
  const { t } = useTranslation();
  const verdict = session.verdict;
  if (!verdict) return null;
  const proposals = currentProposals(session);
  const criteria = session.sheet?.priorities.map((priority) => priority.criterion) ?? [];
  const recommended = verdict.recommendation.seat;

  return (
    <div className="stack-lg" style={{ marginBlockEnd: "var(--space-12)" }}>
      <section className="verdict-panel">
        <span className="label muted">{t("role.arbiter")}</span>
        <h2 className="display">{recommended ? t("verdict.recommended", { seat: recommended }) : t("verdict.none")}</h2>
        {recommended && proposals[recommended] ? (
          <p className="title" style={{ margin: 0 }}>
            {proposals[recommended].title}
          </p>
        ) : null}
        <p style={{ margin: 0, maxInlineSize: "70ch" }}>{verdict.recommendation.rationale}</p>
        <div>
          <a className="button button-secondary" href={api.reportUrl(session.id)} download>
            <DownloadIcon />
            {t("verdict.download")}
          </a>
        </div>
      </section>

      <section className="stack">
        <h2 className="heading">{t("verdict.matrix")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("verdict.option")}</th>
                <th scope="col">{t("verdict.verdict")}</th>
                {criteria.map((criterion) => (
                  <th scope="col" key={criterion}>
                    {criterion}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {verdict.options.map((option) => (
                <tr key={option.seat}>
                  <th scope="row" style={{ color: "var(--ink)", fontSize: 15 }}>
                    <span className={option.seat === "A" ? "voice-a" : option.seat === "B" ? "voice-b" : ""}>
                      <span className="voice-name">{option.seat}</span>
                    </span>{" "}
                    {option.title}
                  </th>
                  <td>
                    <div className="stack" style={{ gap: "var(--space-2)" }}>
                      <FeasibilityChip value={option.feasibility} />
                      <span className="field-hint">{option.reason}</span>
                      {option.conditions.length > 0 ? (
                        <span className="field-hint">
                          {t("verdict.conditions")}: {option.conditions.join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {criteria.map((criterion) => {
                    const score = option.scores.find((item) => item.criterion === criterion)?.score;
                    return <td key={criterion}>{score ? <Score value={score} /> : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        {verdict.consensus.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.consensus")}</h2>
            <ul style={{ margin: 0 }}>
              {verdict.consensus.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {verdict.disagreements.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.disagreements")}</h2>
            {verdict.disagreements.map((disagreement) => (
              <div className="positions" key={disagreement.topic}>
                <strong>{disagreement.topic}</strong>
                {disagreement.positions.map((position) => (
                  <span className="muted" key={position}>
                    {position}
                  </span>
                ))}
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {verdict.risks.length > 0 ? (
        <section className="stack">
          <h2 className="heading">{t("verdict.risks")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("verdict.risks")}</th>
                  <th scope="col">{t("verdict.likelihood")}</th>
                  <th scope="col">{t("verdict.impact")}</th>
                  <th scope="col">{t("verdict.mitigation")}</th>
                </tr>
              </thead>
              <tbody>
                {verdict.risks.map((risk) => (
                  <tr key={risk.risk}>
                    <td>{risk.risk}</td>
                    <td>{t(`level.${risk.likelihood}`)}</td>
                    <td>{t(`level.${risk.impact}`)}</td>
                    <td>{risk.mitigation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="two-col">
        {verdict.roadmap.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.roadmap")}</h2>
            <ol className="roadmap">
              {verdict.roadmap.map((phase) => (
                <li key={phase.phase}>
                  <div>
                    <strong>{phase.phase}</strong>
                    <div>{phase.content}</div>
                    <div className="field-hint">
                      {t("verdict.exit")}: {phase.exitCriterion}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {verdict.claims.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.claims")}</h2>
            {verdict.claims.map((claim) => (
              <div className="claim" key={claim.claim}>
                <span>{claim.claim}</span>
                <span
                  className={`chip ${claim.confidence === "verified" ? "" : claim.confidence === "estimated" ? "severity-major" : "severity-minor"}`}
                >
                  {t(`confidence.${claim.confidence}`)}
                </span>
              </div>
            ))}
            {verdict.openQuestions.length > 0 ? (
              <>
                <h3 className="title">{t("verdict.openQuestions")}</h3>
                <ul style={{ margin: 0 }}>
                  {verdict.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
