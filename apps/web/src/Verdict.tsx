import type { Audience, Feasibility, Session, TopicStatus } from "@quorumind/core";
import { rankOptions } from "@quorumind/core/ranking";
import { currentProposals } from "@quorumind/core/session";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCanEdit } from "./access.tsx";
import { api, type Feedback } from "./api.ts";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram.tsx";
import { ExportMenu } from "./components/ExportMenu.tsx";
import { CheckIcon, CrossIcon, DownloadIcon, MapIcon, SparkIcon, WarningIcon } from "./components/Icons.tsx";
import { seatName } from "./Debate.tsx";
import { failureText } from "./errors.ts";
import { formatMoney } from "./format.ts";
import { useFlip } from "./useFlip.ts";

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

const AUDIENCES: Audience[] = ["cto", "executive", "client"];
const STATUSES: TopicStatus[] = ["opposed", "divided", "agreement"];
const VOICES: Record<string, string> = { A: "voice-a", B: "voice-b", C: "voice-c", D: "voice-d", U: "voice-you", devil: "voice-devil" };

function Briefs({ session, readOnly }: { session: Session; readOnly: boolean }) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<Audience | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Writing a new version calls a model: for those who may change the session.
  const canEdit = useCanEdit();
  const available = readOnly || !canEdit ? AUDIENCES.filter((value) => session.briefs[value]) : AUDIENCES;
  if (available.length === 0) return null;
  const brief = audience ? session.briefs[audience] : undefined;

  const write = async (value: Audience) => {
    setPending(true);
    setError(null);
    try {
      await api.brief(session.id, value);
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="stack">
      <div className="row brief-head">
        <h2 className="heading heading-icon">
          <SparkIcon />
          {t("brief.title")}
        </h2>
        <fieldset className="segmented">
          <legend className="visually-hidden">{t("brief.title")}</legend>
          <button type="button" aria-pressed={audience === null} onClick={() => setAudience(null)}>
            {t("brief.full")}
          </button>
          {available.map((value) => (
            <button key={value} type="button" aria-pressed={audience === value} onClick={() => setAudience(value)}>
              {t(`brief.audience.${value}`)}
            </button>
          ))}
        </fieldset>
      </div>
      {audience && brief ? (
        <article className="card brief stack">
          <h3 className="title">{brief.headline}</h3>
          <p style={{ margin: 0 }}>{brief.summary}</p>
          {brief.sections.map((section) => (
            <div key={section.title}>
              <h4>{section.title}</h4>
              <p style={{ margin: 0 }}>{section.body}</p>
            </div>
          ))}
          {brief.nextSteps.length > 0 ? (
            <div>
              <h4>{t("brief.nextSteps")}</h4>
              <ol style={{ margin: 0 }}>
                {brief.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>
      ) : audience ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>{t(`brief.describe.${audience}`)}</p>
          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <button type="button" className="button button-secondary" disabled={pending} onClick={() => write(audience)}>
              {pending ? t("brief.writing") : t("brief.write")}
            </button>
          </div>
        </div>
      ) : (
        <p className="field-hint" style={{ margin: 0 }}>
          {t("brief.hint")}
        </p>
      )}
    </section>
  );
}

function Matrix({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const verdict = session.verdict;
  const priorities = session.sheet?.priorities ?? [];
  const initial = Object.fromEntries(priorities.map((priority) => [priority.criterion, priority.weight]));
  const [weights, setWeights] = useState<Record<string, number>>(initial);
  const ranked = verdict ? rankOptions(verdict, weights) : [];
  const body = useFlip<HTMLTableSectionElement>(ranked.map((option) => option.seat).join());
  if (!verdict) return null;
  const proposals = currentProposals(session);
  const criteria = priorities.map((priority) => priority.criterion);
  const changed = criteria.some((criterion) => weights[criterion] !== initial[criterion]);
  const range = (low: number, high: number, currency: string) =>
    `${formatMoney(low, currency, i18n.language)} – ${formatMoney(high, currency, i18n.language)}`;

  return (
    <section className="stack">
      <div className="row matrix-head">
        <h2 className="heading">{t("verdict.matrix")}</h2>
        {changed ? (
          <button type="button" className="button button-quiet" onClick={() => setWeights(initial)}>
            {t("matrix.reset")}
          </button>
        ) : null}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("matrix.hint")}
      </p>
      <div className="weights">
        {criteria.map((criterion, index) => (
          <label className="weight" key={criterion} htmlFor={`weight-${index}`}>
            <span>{criterion}</span>
            <input
              id={`weight-${index}`}
              type="range"
              min={0}
              max={5}
              step={1}
              value={weights[criterion] ?? 0}
              onChange={(event) => setWeights((current) => ({ ...current, [criterion]: Number(event.target.value) }))}
            />
            <span className="mono" aria-hidden="true">
              {weights[criterion] ?? 0}
            </span>
          </label>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("verdict.option")}</th>
              <th scope="col">{t("matrix.score")}</th>
              <th scope="col">{t("verdict.verdict")}</th>
              {criteria.map((criterion) => (
                <th scope="col" key={criterion}>
                  {criterion}
                </th>
              ))}
              <th scope="col">{t("debate.monthlyCost")}</th>
              <th scope="col">{t("debate.buildCost")}</th>
            </tr>
          </thead>
          <tbody aria-live="polite" ref={body}>
            {ranked.map((rankedOption, index) => {
              const option = verdict.options.find((item) => item.seat === rankedOption.seat);
              const proposal = proposals[rankedOption.seat];
              if (!option) return null;
              return (
                <tr key={option.seat} data-rank={index + 1} data-flip={option.seat}>
                  <th scope="row" className="option-cell">
                    <span className={VOICES[option.seat] ?? ""}>
                      <span className="voice-name">{option.seat}</span>
                    </span>{" "}
                    {option.title}
                  </th>
                  <td>
                    {rankedOption.score === null ? (
                      "–"
                    ) : (
                      <span className="weighted">
                        <span className="weighted-bar">
                          <i style={{ inlineSize: `${(rankedOption.score / 5) * 100}%` }} />
                        </span>
                        <span className="mono">{rankedOption.score.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}</span>
                      </span>
                    )}
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
                  {criteria.map((criterion) => {
                    const score = option.scores.find((item) => item.criterion === criterion)?.score;
                    return <td key={criterion}>{score ? <Score value={score} /> : "–"}</td>;
                  })}
                  <td className="mono nowrap">
                    {proposal ? range(proposal.monthlyCost.low, proposal.monthlyCost.high, proposal.monthlyCost.currency) : "–"}
                  </td>
                  <td className="mono nowrap">
                    {proposal?.buildCost ? range(proposal.buildCost.low, proposal.buildCost.high, proposal.buildCost.currency) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("matrix.estimates")}
      </p>
    </section>
  );
}

function DebateMap({ session }: { session: Session }) {
  const { t } = useTranslation();
  const topics = session.verdict?.topics ?? [];
  if (topics.length === 0) return null;
  const sorted = [...topics].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  return (
    <section className="stack">
      <h2 className="heading heading-icon">
        <MapIcon />
        {t("map.title")}
      </h2>
      <div className="map-legend">
        {STATUSES.map((status) => (
          <span key={status} className={`map-status map-${status}`}>
            {t(`map.${status}`)} · {topics.filter((topic) => topic.status === status).length}
          </span>
        ))}
      </div>
      <div className="map">
        {sorted.map((topic) => (
          <div className={`map-topic map-topic-${topic.status}`} key={topic.topic}>
            <div className="row" style={{ gap: "var(--space-2)" }}>
              <span className={`map-status map-${topic.status}`}>{t(`map.${topic.status}`)}</span>
              <strong>{topic.topic}</strong>
            </div>
            {topic.positions.length > 0 ? (
              <ul className="map-positions">
                {topic.positions.map((item) => (
                  <li key={`${item.seat}-${item.position}`} className={VOICES[item.seat] ?? ""}>
                    {item.seat ? <span className="voice-name">{seatName(item.seat, t)}</span> : null}
                    <span>{item.position}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedbackBox({ session, feedback }: { session: Session; feedback: Feedback[] }) {
  const { t } = useTranslation();
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [kind, setKind] = useState<"rating" | "error">("rating");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(feedback.some((item) => item.kind === "rating"));
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      await api.feedback(session.id, { helpful: kind === "rating" ? helpful : null, kind, comment: comment.trim() });
      setSent(true);
      setComment("");
    } finally {
      setSending(false);
    }
  };

  if (sent && kind === "rating") {
    return (
      <section className="card feedback stack">
        <p style={{ margin: 0 }}>{t("feedback.thanks")}</p>
        <div>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              setKind("error");
              setSent(false);
            }}
          >
            {t("feedback.reportError")}
          </button>
        </div>
      </section>
    );
  }
  if (sent) {
    return (
      <section className="card feedback">
        <p style={{ margin: 0 }}>{t("feedback.errorThanks")}</p>
      </section>
    );
  }
  return (
    <form className="card feedback stack" onSubmit={submit}>
      {kind === "rating" ? (
        <div className="row">
          <span className="title">{t("feedback.question")}</span>
          <fieldset className="segmented">
            <legend className="visually-hidden">{t("feedback.question")}</legend>
            <button type="button" aria-pressed={helpful === true} onClick={() => setHelpful(true)}>
              {t("feedback.yes")}
            </button>
            <button type="button" aria-pressed={helpful === false} onClick={() => setHelpful(false)}>
              {t("feedback.no")}
            </button>
          </fieldset>
        </div>
      ) : (
        <span className="title">{t("feedback.errorTitle")}</span>
      )}
      {kind === "error" || helpful !== null ? (
        <div className="field">
          <label className="field-hint" htmlFor="feedback-comment">
            {kind === "error" ? t("feedback.errorLabel") : t("feedback.commentLabel")}
          </label>
          <textarea
            id="feedback-comment"
            className="textarea"
            rows={2}
            maxLength={2000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      ) : null}
      <div className="row">
        {kind === "error" || helpful !== null ? (
          <button type="submit" className="button button-secondary" disabled={sending || (kind === "error" && !comment.trim())}>
            {t("feedback.send")}
          </button>
        ) : null}
        {kind === "rating" ? (
          <button type="button" className="button button-quiet" onClick={() => setKind("error")}>
            {t("feedback.reportError")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function Verdict({
  session,
  readOnly = false,
  feedback = [],
  reportUrl,
}: {
  session: Session;
  readOnly?: boolean;
  feedback?: Feedback[];
  reportUrl?: string;
}) {
  const { t } = useTranslation();
  const verdict = session.verdict;
  if (!verdict) return null;
  const proposals = currentProposals(session);
  const recommended = verdict.recommendation.seat;
  const recommendedTitle = recommended
    ? recommended === "U"
      ? t("verdict.yourSolution")
      : t("verdict.recommended", { seat: recommended })
    : t("verdict.none");

  return (
    <div className="stack-lg" style={{ marginBlockEnd: "var(--space-12)" }}>
      <section className="verdict-panel">
        <span className="label muted">{t("role.arbiter")}</span>
        <h2 className="display">{recommendedTitle}</h2>
        {recommended && proposals[recommended] ? (
          <p className="title" style={{ margin: 0 }}>
            {proposals[recommended].title}
          </p>
        ) : null}
        <p style={{ margin: 0, maxInlineSize: "70ch" }}>{verdict.recommendation.rationale}</p>
        {session.shortened ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {t("verdict.shortened", { done: session.shortened.rounds, planned: session.rounds })}
          </p>
        ) : null}
        <div className="row">
          {readOnly ? (
            // A shared session only offers its Markdown report: the other exports belong to its owner.
            <a className="button button-secondary" href={reportUrl ?? api.reportUrl(session.id)} download>
              <DownloadIcon />
              {t("verdict.download")}
            </a>
          ) : (
            <ExportMenu
              sessionId={session.id}
              hasVerdict
              briefs={(Object.keys(session.briefs ?? {}) as ("cto" | "executive" | "client")[]).sort()}
            />
          )}
        </div>
      </section>

      <Briefs session={session} readOnly={readOnly} />
      <Matrix session={session} />
      {recommended && proposals[recommended]?.components?.length ? (
        <section className="stack">
          <h2 className="heading">{t("verdict.architecture")}</h2>
          <ArchitectureDiagram
            components={proposals[recommended].components}
            flows={proposals[recommended].flows}
            title={proposals[recommended].title}
          />
        </section>
      ) : null}
      <DebateMap session={session} />

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

      {readOnly ? null : <FeedbackBox session={session} feedback={feedback} />}
    </div>
  );
}
