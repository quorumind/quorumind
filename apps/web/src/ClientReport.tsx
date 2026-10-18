import type { ClientDeliverable } from "@quorumind/core";
import { useTranslation } from "react-i18next";
import { DownloadIcon, SparkIcon } from "./components/Icons.tsx";
import { FeasibilityChip, Score } from "./Verdict.tsx";

/**
 * The decision as a client reads it, through a "client" share link: the recommendation, the options and their
 * scores, the risks, the roadmap, the open questions and the version written for a client. Nothing of the debate.
 */
export function ClientReport({ deliverable, reportUrl }: { deliverable: ClientDeliverable; reportUrl: string }) {
  const { t, i18n } = useTranslation();
  const recommendation = deliverable.recommendation;
  if (!deliverable.complete || !recommendation) {
    return (
      <div className="narrow stack">
        {deliverable.title ? <h1 className="display">{deliverable.title}</h1> : null}
        <p className="notice">{t("share.notReady")}</p>
      </div>
    );
  }
  const seat = recommendation.seat;
  const headline = seat ? (seat === "U" ? t("verdict.yourSolution") : t("verdict.recommended", { seat })) : t("verdict.none");
  const brief = deliverable.brief;
  const criteria = deliverable.criteria;

  return (
    <div className="stack-lg" style={{ marginBlockEnd: "var(--space-12)" }}>
      {deliverable.title ? <h1 className="display">{deliverable.title}</h1> : null}
      <section className="verdict-panel">
        <span className="label muted">{t("role.arbiter")}</span>
        <h2 className="display">{headline}</h2>
        {recommendation.title ? (
          <p className="title" style={{ margin: 0 }}>
            {recommendation.title}
          </p>
        ) : null}
        <p style={{ margin: 0, maxInlineSize: "70ch" }}>{recommendation.rationale}</p>
        {deliverable.summary ? <p style={{ margin: 0, maxInlineSize: "70ch" }}>{deliverable.summary}</p> : null}
        <div className="row">
          <a className="button button-secondary" href={reportUrl} download>
            <DownloadIcon />
            {t("verdict.download")}
          </a>
        </div>
      </section>

      {brief ? (
        <article className="card brief stack">
          <h2 className="heading heading-icon">
            <SparkIcon />
            {brief.headline}
          </h2>
          <p style={{ margin: 0 }}>{brief.summary}</p>
          {brief.sections.map((section) => (
            <div key={section.title}>
              <h3 className="title">{section.title}</h3>
              <p style={{ margin: 0 }}>{section.body}</p>
            </div>
          ))}
          {brief.nextSteps.length > 0 ? (
            <div>
              <h3 className="title">{t("brief.nextSteps")}</h3>
              <ol style={{ margin: 0 }}>
                {brief.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>
      ) : null}

      {deliverable.options.length > 0 ? (
        <section className="stack">
          <h2 className="heading">{t("verdict.matrix")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("verdict.option")}</th>
                  <th scope="col">{t("matrix.score")}</th>
                  <th scope="col">{t("verdict.verdict")}</th>
                  {criteria.map((item) => (
                    <th scope="col" key={item.criterion}>
                      {item.criterion}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliverable.options.map((option) => (
                  <tr key={option.seat}>
                    <th scope="row" className="option-cell">
                      <span className="voice-name">{option.seat}</span> {option.title}
                    </th>
                    <td className="mono">
                      {option.weightedScore === null
                        ? "–"
                        : option.weightedScore.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
                    </td>
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
                    {criteria.map((item) => {
                      const score = option.scores.find((entry) => entry.criterion === item.criterion)?.score;
                      return <td key={item.criterion}>{score ? <Score value={score} /> : "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {deliverable.risks.length > 0 ? (
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
                {deliverable.risks.map((risk) => (
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
        {deliverable.roadmap.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.roadmap")}</h2>
            <ol className="roadmap">
              {deliverable.roadmap.map((phase) => (
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
        {deliverable.openQuestions.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.openQuestions")}</h2>
            <ul style={{ margin: 0 }}>
              {deliverable.openQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
